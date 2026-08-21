/*
 * PROBE 9 — the remaining verdicts, attacked from the angles the prior pass did not use.
 *
 *  - MISSING role screens: re-probed as OWNER *and* as SUPERADMIN, because a vendor-only role
 *    builder on the /platform side would make a "no role screen anywhere" headline wrong.
 *  - Revoke: the prior pass enumerated buttons with a selector that scraped the whole user LIST.
 *    Enumerate the detail panel specifically, and look for a control on the role row itself.
 *  - Permission catalogue: does ANY screen render a permission code or description?
 *  - TENANT_ADMIN: the prior pass only opened the dropdown. Complete an assignment as admin.
 *  - The Add-user dialog: does creating a user let you pick a role, and does it stick?
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, BASE, login, open, shot, sniffToken, api, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "remaining-verdicts-sweep", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 550));
};

const TENANT_ROUTES = [
  "/app/roles", "/app/settings/roles", "/app/admin/roles", "/app/permissions",
  "/app/settings/permissions", "/app/settings/features", "/app/settings/users",
  "/app/settings/security", "/app/admin", "/app/rbac",
];
const PLATFORM_ROUTES = [
  "/platform/roles", "/platform/permissions", "/platform/settings",
  "/platform/dashboard", "/platform/tenants",
];

async function routeSweep(page, routes, who) {
  const rows = [];
  for (const r of routes) {
    const res = await open(page, r, { settle: 2500 });
    const row = {
      route: r,
      landedOn: res.url.replace(BASE, ""),
      notFound: res.notFound,
      denied: res.denied,
      failed: res.failed,
      h1: (res.body.split("\n").find((l) => l.trim().length > 2) ?? "").slice(0, 70),
    };
    rows.push(row);
    console.log(`   ${who} ${r} -> ${row.notFound ? "404" : row.denied ? "DENIED" : row.failed ? "ERROR" : "renders"}`);
  }
  log(`routes-as-${who}`, rows);
  return rows;
}

async function main() {
  const browser = await chromium.launch();

  // ---------- SUPERADMIN: is there a vendor-side role builder? ----------
  const pctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ppage = await pctx.newPage();
  await login(ppage, "superadmin");
  await routeSweep(ppage, PLATFORM_ROUTES, "SUPERADMIN");
  await routeSweep(ppage, ["/app/roles", "/app/users"], "SUPERADMIN-tenant-side");
  const pnav = await ppage.locator("nav, aside").first().innerText().catch(() => "");
  log("superadmin-nav", pnav.replace(/\s+/g, " ").slice(0, 400));
  await shot(ppage, "09-superadmin-nav");
  await pctx.close();

  // ---------- OWNER: routes, detail panel controls, permission surfaces ----------
  const octx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const opage = await octx.newPage();
  const otok = sniffToken(opage);
  await login(opage, "owner");
  await routeSweep(opage, TENANT_ROUTES, "OWNER");

  const oc = jwtClaims(otok.value ?? "");
  log("owner-jwt", { roles: oc?.roles, perms: oc?.permissions?.length, hasRbacManage: (oc?.permissions ?? []).includes("rbac.manage") });

  // sidebar: is there any Roles/Permissions entry?
  await open(opage, "/app/dashboard", { settle: 3000 });
  const sidebar = await opage.locator('[data-slot="sidebar"]').innerText().catch(() => "");
  log("owner-sidebar-full", sidebar.replace(/\s+/g, " "));
  log("sidebar-mentions-roles-or-permissions", /\brole|permission/i.test(sidebar));
  await shot(opage, "09-owner-sidebar");

  // user detail panel — enumerate ONLY the panel, and hunt for a revoke affordance
  await open(opage, "/app/users", { settle: 4000 });
  await opage.locator("button").filter({ hasText: "cashier@terrace.local" }).first().click();
  await opage.waitForTimeout(3500);
  const panel = opage.locator("main div").filter({ hasText: /Roles by branch/ }).last();
  const panelText = (await panel.innerText().catch(() => "")).replace(/\s+/g, " ");
  log("detail-panel-text", panelText.slice(0, 900));
  const panelBtns = (await panel.locator("button").allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  log("detail-panel-buttons", panelBtns);
  log("panel-has-remove-or-revoke", panelBtns.some((t) => /remove|revoke|unassign|delete|×/i.test(t)));
  // any icon-only control on the role row?
  const roleRowBtns = await panel.locator('[class*="role"], li, tr').locator("button").count().catch(() => 0);
  log("controls-on-role-rows", roleRowBtns);
  await shot(opage, "09-owner-cashier-detail");

  // does ANY visible text anywhere name a permission code or describe one?
  const permCodeRe = /rbac\.manage|pos\.order\.|finance\.period|crm\.customer\.|audit\.log\.view|hr\.payroll/;
  log("detail-panel-names-permission-codes", permCodeRe.test(panelText));

  const prof = await open(opage, "/app/profile", { settle: 4000 });
  log("profile-names-permission-codes", permCodeRe.test(prof.body));
  log("profile-permission-line", (prof.body.match(/Permissions[\s\S]{0,120}/) ?? [""])[0].replace(/\s+/g, " "));
  await shot(opage, "09-owner-profile");

  // the assign dialog for a user who already holds a role at that branch — can it be cleared?
  await open(opage, "/app/users", { settle: 4000 });
  await opage.locator("button").filter({ hasText: "cashier@terrace.local" }).first().click();
  await opage.waitForTimeout(3000);
  await opage.locator("button").filter({ hasText: /assign role/i }).first().click();
  await opage.waitForTimeout(2000);
  const dlg = opage.locator('[role="dialog"]').first();
  log("assign-dialog-text", (await dlg.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
  const roleSel = dlg.locator("select").nth(1);
  log("assign-role-options", await roleSel.locator("option").allInnerTexts().catch(() => []));
  log("assign-has-empty-option-to-clear", (await roleSel.locator("option").allInnerTexts().catch(() => [])).some((t) => /no role|none|remove|clear/i.test(t)));
  await opage.keyboard.press("Escape");
  await opage.waitForTimeout(800);

  // Add-user dialog — role at creation time
  const addBtn = opage.locator("button").filter({ hasText: /^Add user$/ }).first();
  if (await addBtn.count()) {
    await addBtn.click();
    await opage.waitForTimeout(2000);
    const adlg = opage.locator('[role="dialog"]').first();
    const abox = await adlg.boundingBox().catch(() => null);
    log("add-user-dialog", {
      size: abox,
      selects: await adlg.locator("select").count(),
      checkboxes: await adlg.locator('input[type="checkbox"]').count(),
      text: (await adlg.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400),
    });
    await shot(opage, "09-add-user-dialog");
    await opage.keyboard.press("Escape");
  }
  await octx.close();

  // ---------- TENANT_ADMIN: can it actually COMPLETE an assignment? ----------
  const actx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const apage = await actx.newPage();
  const atok = sniffToken(apage);
  await login(apage, "admin");
  const ac = jwtClaims(atok.value ?? "");
  log("admin-jwt", { roles: ac?.roles, perms: ac?.permissions?.length, hasRbacManage: (ac?.permissions ?? []).includes("rbac.manage"), hasUserManage: (ac?.permissions ?? []).includes("rbac.user.manage") });
  await routeSweep(apage, ["/app/users", "/app/roles", "/app/settings"], "TENANT_ADMIN");

  await open(apage, "/app/users", { settle: 4000 });
  await apage.locator("button").filter({ hasText: "waiter@terrace.local" }).first().click();
  await apage.waitForTimeout(3000);
  const aAssign = apage.locator("button").filter({ hasText: /assign role/i }).first();
  log("admin-sees-assign-button", await aAssign.count());
  if (await aAssign.count()) {
    await aAssign.click();
    await apage.waitForTimeout(2000);
    const adlg = apage.locator('[role="dialog"]').first();
    const sels = adlg.locator("select");
    log("admin-role-options", await sels.nth(1).locator("option").allInnerTexts().catch(() => []));
    log("admin-withheld-notice", (await adlg.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
    await shot(apage, "09-admin-assign-dialog");
    // COMPLETE it: grant KITCHEN_STAFF on Rooftop, verify, then remove
    await sels.nth(0).selectOption({ label: "Floating Terrace — Rooftop" });
    await apage.waitForTimeout(400);
    await sels.nth(1).selectOption({ label: "Kitchen Staff" });
    await apage.waitForTimeout(600);
    await adlg.locator("button").filter({ hasText: /^Assign role$/ }).first().click();
    await apage.waitForTimeout(4500);
    const after = await apage.locator("body").innerText();
    const i = after.indexOf("Roles by branch");
    log("admin-assignment-result", after.slice(Math.max(0, i - 100), i + 500).replace(/\s+/g, " "));
    log("admin-assignment-succeeded", /KITCHEN_STAFF/i.test(after.slice(i, i + 600)));
    await shot(apage, "09-admin-after-assign");

    // clean up through the admin's OWN token so this also tests whether admin may revoke
    const users = await api(atok.value, "/api/v1/users?size=200");
    const waiter = (JSON.parse(users.body.length > 490 ? "{}" : users.body).data ?? []).find?.((u) => u.email === "waiter@terrace.local");
    const uresp = await fetch("http://localhost:8080/api/v1/users?size=200", { headers: { Authorization: `Bearer ${atok.value}` } }).then((r) => r.json());
    const w = (uresp.data ?? []).find((u) => u.email === "waiter@terrace.local");
    const del = await api(atok.value, `/api/v1/users/${w.id}/branch-roles?branchId=c2d74ade-7ff8-4167-8cd0-131bfbdf4fba&roleCode=KITCHEN_STAFF`, { method: "DELETE" });
    log("admin-revoke-via-api", del);
  }
  await actx.close();

  writeFileSync(`${SHOTS}/09-sweep.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/09-sweep.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
