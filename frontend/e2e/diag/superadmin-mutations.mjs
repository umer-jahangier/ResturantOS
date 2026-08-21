/**
 * DIAGNOSIS ONLY — can a platform operator actually DO the job?
 * Drives real mutations: onboard a tenant, change its tier, toggle a module,
 * suspend, reactivate, delete. Records exactly where it stops working.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const PLATFORM = { email: "superadmin@softxlogic.com", password: "Test@123!" };
const STAMP = Date.now().toString().slice(-6);
const NEW_BRAND = `Diag Bistro ${STAMP}`;

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); note("  [shot]", n); };

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('input#email, input[name="email"]').first().fill(PLATFORM.email);
  await page.locator('input#password, input[name="password"]').first().fill(PLATFORM.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/platform") || u.includes("/api/v1/auth"))
      api.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "")}`);
  });

  await login(page);
  note("landed:", page.url());

  // ---------- 1. ONBOARD A NEW RESTAURANT ----------
  note("\n=== 1. Onboard a brand-new restaurant through the UI ===");
  await page.locator('nav[aria-label="Platform"] a[href="/platform/tenants"]').click();
  await page.waitForTimeout(3000);
  await page.locator("main button", { hasText: /create tenant/i }).first().click();
  await page.waitForTimeout(1200);
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.locator("#brand-name").fill(NEW_BRAND);
  await dlg.locator("#admin-email").fill(`owner+${STAMP}@diag.local`);
  await dlg.locator("select#tier").selectOption("STARTER");
  await shot(page, "10-create-filled");
  await dlg.locator("button", { hasText: /^create tenant$/i }).click();
  await page.waitForTimeout(7000);
  note("URL after create:", page.url());
  note("post-create main text:\n" + (await page.locator("main").innerText()).slice(0, 2500));
  await shot(page, "11-after-create");

  // Did the operator receive credentials for the new admin?
  const bodyTxt = await page.locator("body").innerText();
  for (const probe of ["password", "Password", "temporary", "Temporary", "invite", "Invite", "email sent"]) {
    if (bodyTxt.includes(probe)) note(`  credential hint present: "${probe}"`);
  }

  // ---------- 2. FIND IT AND OPEN DETAIL ----------
  note("\n=== 2. Open the new tenant ===");
  if (!page.url().match(/\/platform\/tenants\/[0-9a-f-]{36}/)) {
    await page.locator('nav[aria-label="Platform"] a[href="/platform/tenants"]').click();
    await page.waitForTimeout(3000);
    const row = page.locator("main a", { hasText: NEW_BRAND }).first();
    if (await row.count()) { await row.click(); await page.waitForTimeout(3500); }
    else note("!! new tenant NOT visible in list");
  }
  const tenantUrl = page.url();
  note("tenant detail URL:", tenantUrl);
  const detail = await page.locator("main").innerText();
  note("detail (first 2500):\n" + detail.slice(0, 2500));
  await shot(page, "12-new-tenant-detail");

  // ---------- 3. BILLING / SUBSCRIPTION STATE ----------
  note("\n=== 3. Billing & subscription state ===");
  for (const w of ["Trial", "trial", "Past due", "past-due", "PAST_DUE", "Invoice", "invoice",
                   "Billing", "billing", "Payment", "MRR", "Renewal", "renew", "Card", "Price", "$", "PKR"]) {
    if (detail.includes(w)) note(`  billing token present: "${w}"`);
  }
  note("  (absence of all of the above = no billing state in the console)");

  // ---------- 4. CHANGE TIER ----------
  note("\n=== 4. Change subscription tier ===");
  const tierBtn = page.locator("main button", { hasText: /^Move to /i }).first();
  if (await tierBtn.count()) {
    note("tier control:", await tierBtn.innerText());
    await tierBtn.click();
    await page.waitForTimeout(1500);
    const d = page.locator('[role="dialog"]').first();
    if (await d.count()) { note("tier dialog:\n" + (await d.innerText()).slice(0, 900)); await shot(page, "13-tier-dialog");
      const confirm = d.locator("button", { hasText: /confirm|move|change|yes/i }).last();
      if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(4000); } }
    else { await page.waitForTimeout(3000); }
    note("after tier change:\n" + (await page.locator("main").innerText()).slice(0, 700));
    await shot(page, "14-after-tier-change");
  } else note("!! no tier control");

  // ---------- 5. TOGGLE A MODULE ----------
  note("\n=== 5. Toggle a per-tenant module ===");
  const rowFor = (code) => page.locator("main tr", { hasText: code }).first();
  const crm = rowFor("FEATURE_CRM");
  if (await crm.count()) {
    note("FEATURE_CRM row before:", (await crm.innerText()).replace(/\n+/g, " | "));
    const toggle = crm.locator("button").first();
    const label = await toggle.innerText();
    await toggle.click();
    await page.waitForTimeout(3500);
    const crm2 = rowFor("FEATURE_CRM");
    note(`clicked "${label}" — FEATURE_CRM row after:`, (await crm2.innerText()).replace(/\n+/g, " | "));
    await shot(page, "15-feature-toggled");
    // revert-to-tier control?
    const revert = crm2.locator("button", { hasText: /revert|reset|inherit|clear/i });
    note("revert-to-tier control on row:", (await revert.count()) ? await revert.first().innerText() : "ABSENT");
  } else note("!! no FEATURE_CRM row");

  // ---------- 6. IMPERSONATE ----------
  note("\n=== 6. Impersonate this tenant for support ===");
  const imp = page.locator("main button, main a", { hasText: /impersonat|sign in as|support access|view as/i });
  note("impersonate control count:", await imp.count());

  // ---------- 7. TENANT USERS / PASSWORD RESET ----------
  note("\n=== 7. Tenant user management from the console ===");
  const usr = page.locator("main button, main a", { hasText: /user|reset password|invite/i });
  const usrTxt = await usr.allInnerTexts();
  note("user-management controls on tenant detail:", JSON.stringify(usrTxt));

  // ---------- 8. SUSPEND ----------
  note("\n=== 8. Suspend the tenant ===");
  const susp = page.locator("main button", { hasText: /^suspend$/i }).first();
  if (await susp.count()) {
    await susp.click();
    await page.waitForTimeout(1500);
    const d = page.locator('[role="dialog"]').first();
    note("suspend dialog box:", JSON.stringify(await d.boundingBox().catch(() => null)));
    note("suspend dialog text:\n" + (await d.innerText().catch(() => "(none)")).slice(0, 1200));
    await shot(page, "16-suspend-dialog");
    const fields = await d.locator("input, textarea, select").evaluateAll((e) => e.map((x) => `${x.tagName}:${x.id || x.name}`));
    note("suspend dialog fields (reason?):", JSON.stringify(fields));
    // type confirmation if required
    const txt = d.locator("input[type=text], input:not([type])").first();
    if (await txt.count()) {
      const ph = await txt.getAttribute("placeholder");
      note("confirm input placeholder:", ph);
      if (ph) await txt.fill(ph);
    }
    const go = d.locator("button", { hasText: /suspend/i }).last();
    await go.click().catch(() => note("suspend confirm click failed"));
    await page.waitForTimeout(4500);
    note("after suspend:\n" + (await page.locator("main").innerText()).slice(0, 600));
    await shot(page, "17-after-suspend");
  } else note("!! no suspend control");

  // ---------- 9. REACTIVATE ----------
  note("\n=== 9. Reactivate ===");
  const react = page.locator("main button", { hasText: /reactivate|resume|unsuspend/i }).first();
  if (await react.count()) {
    await react.click(); await page.waitForTimeout(1500);
    const d = page.locator('[role="dialog"]').first();
    if (await d.count()) {
      const t = d.locator("input[type=text], input:not([type])").first();
      if (await t.count()) { const ph = await t.getAttribute("placeholder"); if (ph) await t.fill(ph); }
      await d.locator("button", { hasText: /reactivate|resume|confirm/i }).last().click().catch(() => {});
    }
    await page.waitForTimeout(4000);
    note("after reactivate:\n" + (await page.locator("main").innerText()).slice(0, 500));
    await shot(page, "18-after-reactivate");
  } else note("!! no reactivate control visible");

  // ---------- 10. DELETE ----------
  note("\n=== 10. Delete / purge the tenant ===");
  const del = page.locator("main button", { hasText: /delete|purge|cancel tenant|terminate/i });
  note("delete-ish controls:", JSON.stringify(await del.allInnerTexts()));

  // ---------- 11. PLATFORM-WIDE surfaces ----------
  note("\n=== 11. Platform-wide health / audit / users / settings routes ===");
  for (const r of ["/platform/audit", "/platform/health", "/platform/users", "/platform/settings",
                   "/platform/billing", "/platform/plans", "/platform/usage", "/platform/impersonate"]) {
    const resp = await page.goto(BASE + r, { waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForTimeout(1800);
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160);
    note(`  ${r} -> HTTP ${resp ? resp.status() : "?"} | url=${page.url().replace(BASE, "")} | ${t}`);
  }

  writeFileSync(`${OUT}/mutations-log.txt`, log.join("\n"));
  writeFileSync(`${OUT}/mutations-api.txt`, api.join("\n"));
  note("\n=== API ===\n" + api.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); writeFileSync(`${OUT}/mutations-log.txt`, log.join("\n") + "\nFATAL " + e.message + "\n" + e.stack); process.exit(1); });
