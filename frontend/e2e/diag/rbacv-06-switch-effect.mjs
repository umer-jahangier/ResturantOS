/*
 * PROBE 6 — the decisive test of the (d) WORKS verdict.
 *
 * The grant is already in place (CASHIER on Rooftop for waiter@terrace.local). Probe 5 proved the
 * branch switcher DOES render once a second branch role exists. What remains unproven is the only
 * thing that matters to the grantee: does switching to Rooftop actually hand them the CASHIER
 * permissions, or is the switcher a dropdown that changes a label and nothing else?
 *
 * Probe 5 also tripped a session expiry on the very first navigation after the switcher appeared.
 * That is recorded here too, with the timeline, because a role grant that logs the user out is a
 * finding in its own right.
 *
 * Cleans the grant up at the end.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, BASE, login, open, shot, sniffToken, api, apiLogin, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "branch-switch-actually-grants", steps: [] };
const t0 = Date.now();
const log = (k, v) => {
  const e = { t: Date.now() - t0, k, v };
  out.steps.push(e);
  console.log(`[+${Math.round(e.t / 1000)}s ${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 600));
};

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const tok = sniffToken(page);
  const loginPageHits = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame() && f.url().includes("/login")) loginPageHits.push({ t: Date.now() - t0, url: f.url() });
  });

  await login(page, "waiter");
  await open(page, "/app/dashboard", { settle: 4000 });
  const c0 = jwtClaims(tok.value ?? "");
  log("jwt-at-HQ", { branch: c0?.branch_id, roles: c0?.roles, perms: c0?.permissions?.length, exp: c0?.exp, iat: c0?.iat, ttlSec: c0?.exp - c0?.iat });

  const trigger = page.getByRole("button", { name: /switch branch/i }).first();
  log("switcher-present", await trigger.count());
  await shot(page, "06-dashboard-with-switcher");

  await trigger.click();
  await page.waitForTimeout(1500);
  const items = await page.locator('[role="menuitem"]').allInnerTexts().catch(() => []);
  log("menu-items", items);
  await shot(page, "06-menu-open");

  const roof = page.locator('[role="menuitem"]').filter({ hasText: /Rooftop/i }).first();
  log("rooftop-option-present", await roof.count());
  await roof.click();
  await page.waitForTimeout(9000);
  log("url-after-switch", page.url());
  await shot(page, "06-after-switch");

  const c1 = jwtClaims(tok.value ?? "");
  log("jwt-after-switch", {
    branch: c1?.branch_id,
    roles: c1?.roles,
    perms: c1?.permissions?.length,
    hasTillOpen: (c1?.permissions ?? []).includes("pos.till.open"),
    hasTillReview: (c1?.permissions ?? []).includes("pos.till.review"),
    hasCrmView: (c1?.permissions ?? []).includes("crm.customer.view"),
    hasOrderClose: (c1?.permissions ?? []).includes("pos.order.close"),
  });

  const body = await page.locator("body").innerText().catch(() => "");
  log("page-after-switch", body.replace(/\s+/g, " ").slice(0, 300));

  const sidebarText = await page.locator('[data-slot="sidebar"]').innerText().catch(() => "");
  log("sidebar-after-switch", sidebarText.replace(/\s+/g, " ").slice(0, 300));

  // The CASHIER-only capabilities: CRM (crm.customer.view) and till open/close.
  const crm = await open(page, "/app/crm", { settle: 6000 });
  log("crm-at-rooftop", { denied: crm.denied, head: crm.body.replace(/\s+/g, " ").slice(0, 220) });
  await shot(page, "06-crm-at-rooftop");

  const prof = await open(page, "/app/profile", { settle: 6000 });
  log("profile-perm-count-at-rooftop", (prof.body.match(/Permissions\s+(\d+)/) ?? [])[1] ?? null);
  log("profile-roles-line", (prof.body.match(/Roles?[\s\S]{0,80}/) ?? [""])[0].replace(/\s+/g, " "));
  await shot(page, "06-profile-at-rooftop");

  const pos = await open(page, "/app/pos", { settle: 6000 });
  log("pos-at-rooftop", { denied: pos.denied, alerts: pos.alerts.slice(0, 2) });

  log("login-redirects-observed", loginPageHits);

  // ---------- RESTORE ----------
  const owner = await apiLogin({
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    tenantSlug: "floating-terrace",
    totpEmail: "owner@terrace.local",
  });
  const H = { Authorization: `Bearer ${owner.token}` };
  const users = await fetch("http://localhost:8080/api/v1/users?size=200", { headers: H }).then((r) => r.json());
  const waiter = (users.data ?? []).find((u) => u.email === "waiter@terrace.local");
  const branches = await fetch("http://localhost:8080/api/v1/branches", { headers: H }).then((r) => r.json());
  const rooftop = (branches.data ?? []).find((b) => /rooftop/i.test(b.name ?? ""));
  const del = await api(owner.token, `/api/v1/users/${waiter.id}/branch-roles?branchId=${rooftop.id}&roleCode=CASHIER`, { method: "DELETE" });
  log("RESTORE-delete", del);
  const after = await fetch(`http://localhost:8080/api/v1/users/${waiter.id}`, { headers: H }).then((r) => r.json());
  log("RESTORE-assignments", JSON.stringify(after.data.assignments));

  writeFileSync(`${SHOTS}/06-switch-effect.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/06-switch-effect.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
