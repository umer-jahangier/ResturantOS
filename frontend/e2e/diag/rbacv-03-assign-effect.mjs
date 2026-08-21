/*
 * PROBE 3 — the (d) WORKS verdict, attacked behaviourally.
 *
 * The prior report proved the assignment PERSISTS (row survives a reload, row present in auth_db).
 * It never proved the assignment DOES ANYTHING. This project's whole failure mode is "structurally
 * present, behaviourally absent", so the real question is: after an admin grants CASHIER on the
 * Rooftop branch, does waiter@terrace.local actually gain the 8 permissions CASHIER carries that
 * WAITER does not (pos.till.open, pos.till.close, pos.order.close, crm.customer.view, …)?
 *
 * Baseline is taken as the waiter BEFORE the grant, so the comparison is against that user's real
 * starting authority and not against an assumption.
 *
 * Restores state at the end: DELETE /api/v1/users/{id}/branch-roles?branchId=…&roleCode=CASHIER.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, login, open, shot, sniffToken, api, apiLogin, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "assign-role-behavioural-effect", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 700));
};

/** Everything a persona can see/do that we can measure cheaply from the browser. */
async function measureWaiter(page, label) {
  const nav = await page.locator("nav").innerText().catch(() => "");
  const prof = await open(page, "/app/profile");
  const permCount = (prof.body.match(/Permissions\s+(\d+)/) ?? [])[1] ?? null;
  const tills = await open(page, "/app/pos/tills");
  const crm = await open(page, "/app/crm");
  const m = {
    navHasTill: /till/i.test(nav),
    navHasCustomers: /customers/i.test(nav),
    profilePermissionCount: permCount,
    tillsDenied: tills.denied,
    tillsNotFound: tills.notFound,
    crmDenied: crm.denied,
    branchesInSwitcher: await page
      .locator("nav, header")
      .innerText()
      .then((t) => t.replace(/\s+/g, " ").slice(0, 200))
      .catch(() => ""),
  };
  log(`waiter-measure-${label}`, m);
  return m;
}

async function main() {
  const browser = await chromium.launch();

  // ---------- baseline: what the waiter can do today ----------
  const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wpage = await wctx.newPage();
  const wtok = sniffToken(wpage);
  await login(wpage, "waiter");
  await wpage.waitForTimeout(1500);
  const beforeClaims = jwtClaims(wtok.value ?? "");
  log("waiter-jwt-BEFORE", {
    branch: beforeClaims?.branch_id,
    roles: beforeClaims?.roles,
    permCount: beforeClaims?.permissions?.length,
    hasTillOpen: (beforeClaims?.permissions ?? []).includes("pos.till.open"),
  });
  const before = await measureWaiter(wpage, "BEFORE");
  await shot(wpage, "03-waiter-nav-before");

  // ---------- the admin action, driven in the browser as OWNER ----------
  const octx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const opage = await octx.newPage();
  const otok = sniffToken(opage);
  await login(opage, "owner");
  await open(opage, "/app/users");
  await opage.waitForTimeout(2500);

  await opage.locator("button").filter({ hasText: "waiter@terrace.local" }).first().click();
  await opage.waitForTimeout(3000);
  const panel = await opage.locator("body").innerText();
  const idx = panel.indexOf("Roles by branch");
  log("detail-panel-before", panel.slice(Math.max(0, idx - 500), idx + 900).replace(/\s+/g, " "));

  // enumerate EVERY control the panel offers — is there really no revoke?
  const panelButtons = await opage
    .locator('[data-testid*="detail"], aside, [role="dialog"], main')
    .last()
    .locator("button")
    .allInnerTexts()
    .catch(() => []);
  log("panel-buttons", panelButtons.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean));
  await shot(opage, "03-owner-user-detail-before");

  await opage.locator("button").filter({ hasText: /assign role/i }).first().click();
  await opage.waitForTimeout(2000);
  const dlg = opage.locator('[role="dialog"]');
  const box = await dlg.first().boundingBox().catch(() => null);
  log("assign-dialog-size", box);
  const selects = dlg.locator("select");
  log("assign-dialog-selects", await selects.count());
  log("assign-dialog-checkboxes", await dlg.locator('input[type="checkbox"]').count());
  // enumerate every option in both selects — what CAN be picked?
  log("branch-options", await selects.nth(0).locator("option").allInnerTexts().catch(() => []));
  log("role-options", await selects.nth(1).locator("option").allInnerTexts().catch(() => []));

  await selects.nth(0).selectOption({ label: "Floating Terrace — Rooftop" });
  await opage.waitForTimeout(500);
  await selects.nth(1).selectOption({ label: "Cashier" });
  await opage.waitForTimeout(800);
  await shot(opage, "03-assign-dialog-filled");
  await dlg.locator("button").filter({ hasText: /^Assign role$/ }).first().click();
  await opage.waitForTimeout(4500);

  const after = await opage.locator("body").innerText();
  const i2 = after.indexOf("Roles by branch");
  log("detail-panel-after-assign", after.slice(Math.max(0, i2 - 200), i2 + 700).replace(/\s+/g, " "));
  await shot(opage, "03-owner-user-detail-after");

  // ---------- THE TEST: sign the waiter in fresh and see if anything changed ----------
  const w2ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const w2page = await w2ctx.newPage();
  const w2tok = sniffToken(w2page);
  await login(w2page, "waiter");
  await w2page.waitForTimeout(1500);
  const afterClaims = jwtClaims(w2tok.value ?? "");
  log("waiter-jwt-AFTER-default-branch", {
    branch: afterClaims?.branch_id,
    roles: afterClaims?.roles,
    permCount: afterClaims?.permissions?.length,
    hasTillOpen: (afterClaims?.permissions ?? []).includes("pos.till.open"),
  });
  const afterDefault = await measureWaiter(w2page, "AFTER-default-branch");
  await shot(w2page, "03-waiter-nav-after");

  // Can the waiter even REACH the Rooftop branch where the new role lives?
  const branchesResp = await api(w2tok.value, "/api/v1/branches/mine");
  log("waiter-branches-mine", branchesResp);

  // Try to switch branch in the UI — is there a branch switcher offering Rooftop?
  const switcher = w2page.locator('[data-testid*="branch"], button').filter({ hasText: /Floating Terrace/i });
  log("branch-switcher-candidates", await switcher.allInnerTexts().catch(() => []));
  const rooftopOption = w2page.getByText("Rooftop", { exact: false });
  log("rooftop-visible-to-waiter-in-ui", await rooftopOption.count());

  writeFileSync(`${SHOTS}/03-assign-effect.json`, JSON.stringify({ ...out, before, afterDefault }, null, 2));

  // ---------- RESTORE ----------
  const owner = await apiLogin({
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    tenantSlug: "floating-terrace",
    totpEmail: "owner@terrace.local",
  });
  const users = await fetch("http://localhost:8080/api/v1/users?size=100", {
    headers: { Authorization: `Bearer ${owner.token}` },
  }).then((r) => r.json());
  const list = users?.data?.content ?? users?.data ?? [];
  const waiter = (Array.isArray(list) ? list : []).find((u) => u.email === "waiter@terrace.local");
  const branches = await fetch("http://localhost:8080/api/v1/branches", {
    headers: { Authorization: `Bearer ${owner.token}` },
  }).then((r) => r.json());
  const blist = branches?.data?.content ?? branches?.data ?? [];
  const rooftop = (Array.isArray(blist) ? blist : []).find((b) => /rooftop/i.test(b.name ?? ""));
  log("restore-ids", { waiter: waiter?.id, rooftop: rooftop?.id });
  if (waiter?.id && rooftop?.id) {
    const del = await api(
      owner.token,
      `/api/v1/users/${waiter.id}/branch-roles?branchId=${rooftop.id}&roleCode=CASHIER`,
      { method: "DELETE" },
    );
    log("RESTORE-delete", del);
  }

  writeFileSync(`${SHOTS}/03-assign-effect.json`, JSON.stringify({ ...out, before, afterDefault }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/03-assign-effect.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
