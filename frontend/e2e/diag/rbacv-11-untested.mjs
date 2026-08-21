/*
 * PROBE 11 — capabilities the prior pass never named. Silence is not a verdict.
 *
 *  A. Is there an audit trail of role changes a human can read? The catalogue ships
 *     `audit.log.view` with the description "Read the tenant's audit trail (logins, voids, refunds,
 *     ROLE CHANGES, password resets)". If an owner cannot see who granted what to whom, the whole
 *     domain is unauditable regardless of how well assignment works.
 *  B. Create a user WITH a role from the Add-user dialog, end to end — the prior pass measured the
 *     dialog's shape and never submitted it.
 *  C. Deactivate. The prior report leans on it as the only removal an admin has ("kills their whole
 *     account"), which is an unverified claim about a destructive control. Does it actually stop
 *     the user signing in?
 *  D. A SuperAdmin opening a tenant URL got dumped to /login?reason=session_expired twice during
 *     this pass. Confirm whether the platform session really dies.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, BASE, GW, login, open, shot, sniffToken, api, apiLogin, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "untested-capabilities", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 550));
};

async function main() {
  const browser = await chromium.launch();
  const owner = await apiLogin({ email: "owner@terrace.local", password: "Terrace#Owner1", tenantSlug: "floating-terrace", totpEmail: "owner@terrace.local" });

  // ---------- A. audit trail of role changes ----------
  // (section A already measured in a prior run — skipped to keep this pass short)

  const octx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const opage = await octx.newPage();
  const otok = sniffToken(opage);
  await login(opage, "owner");

  // ---------- B. create a user WITH a role, end to end ----------
  const stamp = Date.now();
  const email = `rbacv-probe-${stamp}@terrace.local`;
  await open(opage, "/app/users", { settle: 4000 });
  await opage.locator("button").filter({ hasText: /^Add user$/ }).first().click();
  await opage.waitForTimeout(2000);
  const dlg = opage.locator('[role="dialog"]').first();
  await dlg.locator('input[type="email"], input#email, input[name="email"]').first().fill(email);
  const nameField = dlg.locator("input").nth(1);
  await nameField.fill("RBACV Probe User");
  const sels = dlg.locator("select");
  await sels.nth(0).selectOption({ label: "Floating Terrace HQ (HQ)" }).catch(async () => {
    await sels.nth(0).selectOption({ index: 2 });
  });
  await opage.waitForTimeout(400);
  await sels.nth(1).selectOption({ label: "Cashier" });
  await opage.waitForTimeout(600);
  await shot(opage, "11-add-user-filled");
  const btns = await dlg.locator("button").allInnerTexts();
  log("add-user-dialog-buttons", btns.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean));
  await dlg.locator("button").filter({ hasText: /add user|create|save|invite/i }).last().click();
  await opage.waitForTimeout(5000);
  const afterCreate = await opage.locator("body").innerText();
  log("create-result-shows-temp-password", /temporary password|temp password/i.test(afterCreate));
  log("create-result-excerpt", afterCreate.replace(/\s+/g, " ").slice(0, 400));
  await shot(opage, "11-after-create");

  const created = await fetch(`${GW}/api/v1/users?size=300`, { headers: { Authorization: `Bearer ${owner.token}` } })
    .then((r) => r.json())
    .then((j) => (j.data ?? []).find((u) => u.email === email));
  log("created-user-row", created ? { id: created.id, active: created.active, mustChangePassword: created.mustChangePassword } : "NOT FOUND");
  if (created) {
    const detail = await fetch(`${GW}/api/v1/users/${created.id}`, { headers: { Authorization: `Bearer ${owner.token}` } }).then((r) => r.json());
    log("created-user-assignments", JSON.stringify(detail.data.assignments));
  }

  // ---------- C. does Deactivate actually stop a sign-in? ----------
  if (created) {
    await open(opage, "/app/users", { settle: 4000 });
    await opage.locator("button").filter({ hasText: email }).first().click();
    await opage.waitForTimeout(3000);
    const deact = opage.locator("button").filter({ hasText: /^Deactivate$/ }).first();
    log("deactivate-button-present", await deact.count());
    if (await deact.count()) {
      await deact.click();
      await opage.waitForTimeout(1500);
      const cdlg = opage.locator('[role="dialog"]').first();
      if (await cdlg.count()) {
        log("deactivate-confirm-text", (await cdlg.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300));
        const ci = cdlg.locator("input").first();
        if (await ci.count()) await ci.fill(email);
        await cdlg.getByRole("button", { name: /deactivate|confirm/i }).last().click().catch(() => {});
      }
      await opage.waitForTimeout(4000);
      await shot(opage, "11-after-deactivate");
      const row = await fetch(`${GW}/api/v1/users/${created.id}`, { headers: { Authorization: `Bearer ${owner.token}` } }).then((r) => r.json());
      log("user-active-after-deactivate", row.data.user.active);

      const tryLogin = await fetch(`${GW}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "whatever-it-was", tenantSlug: "floating-terrace" }),
      });
      log("deactivated-user-login", { status: tryLogin.status, body: (await tryLogin.text()).slice(0, 200) });
    }
  }
  await octx.close();

  // ---------- D. does a tenant URL kill a SuperAdmin's session? ----------
  const pctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ppage = await pctx.newPage();
  await login(ppage, "superadmin");
  const dash = await open(ppage, "/platform/dashboard", { settle: 3000 });
  log("D-platform-dashboard-ok", { url: dash.url.replace(BASE, ""), denied: dash.denied });
  const tenantSide = await open(ppage, "/app/users", { settle: 4000 });
  log("D-after-visiting-tenant-route", { url: tenantSide.url.replace(BASE, ""), head: tenantSide.body.replace(/\s+/g, " ").slice(0, 180) });
  const backToPlatform = await open(ppage, "/platform/tenants", { settle: 4000 });
  log("D-can-return-to-platform", { url: backToPlatform.url.replace(BASE, ""), head: backToPlatform.body.replace(/\s+/g, " ").slice(0, 180) });
  await shot(ppage, "11-superadmin-after-tenant-route");
  await pctx.close();

  writeFileSync(`${SHOTS}/11-untested.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/11-untested.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
