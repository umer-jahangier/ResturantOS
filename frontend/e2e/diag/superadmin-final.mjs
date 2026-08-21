/**
 * DIAGNOSIS ONLY — precise re-test: module toggle (enable/disable/revert),
 * suspend with phrase+reason, reactivate, delete.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const PLATFORM = { email: "superadmin@softxlogic.com", password: "Test@123!" };
const TARGET = /^Diag Bistro /;

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); note("  [shot]", n); };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/platform")) api.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "")}`);
  });
  const since = () => { const n = api.length; return () => api.slice(n); };

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('input[name="email"], input#email, input[type="email"]').first().fill(PLATFORM.email);
  await page.locator('input[name="password"], input#password, input[type="password"]').first().fill(PLATFORM.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);

  await page.locator('nav[aria-label="Platform"] a[href="/platform/tenants"]').click();
  await page.waitForTimeout(3500);
  await page.locator("main a", { hasText: TARGET }).first().click();
  await page.waitForTimeout(4000);
  const brand = (await page.locator("main h1").first().innerText()).trim();
  note("tenant:", brand, "| url:", page.url());

  const row = (code) => page.locator("main tr", { hasText: code }).first();
  const rowState = async (code) => (await row(code).innerText()).replace(/\s*\n+\s*/g, " | ");

  // ---------- 1. ENABLE a module not in tier ----------
  note("\n=== 1. ENABLE a module (grant an override) ===");
  // find an "Enable" row
  const enableBtn = page.locator("main tr button", { hasText: /^Enable$/ }).first();
  let code = "n/a";
  if (await enableBtn.count()) {
    const tr = page.locator("main tr").filter({ has: page.locator('button:text-is("Enable")') }).first();
    code = (await tr.innerText()).split(/\s/)[0];
    note("target module:", code, "| before:", await rowState(code));
    const cap = since();
    await tr.locator('button:text-is("Enable")').click();
    await page.waitForTimeout(4000);
    note("network:", JSON.stringify(cap()));
    note("after ENABLE:", await rowState(code));
    await shot(page, "30-module-enabled");
  } else note("!! no Enable button present");

  // ---------- 2. REVERT the override ----------
  note("\n=== 2. REVERT the override back to tier default ===");
  if (code !== "n/a") {
    const rev = row(code).locator(`[data-testid="feature-revert-${code}"]`);
    if (await rev.count()) {
      const cap = since();
      await rev.click();
      await page.waitForTimeout(4000);
      note("network:", JSON.stringify(cap()));
      note("after REVERT:", await rowState(code));
      await shot(page, "31-module-reverted");
    } else note("!! no revert control on the overridden row");
  }

  // ---------- 3. DISABLE a module (type-to-confirm) ----------
  note("\n=== 3. DISABLE FEATURE_CRM (type-the-tenant-name confirm) ===");
  note("before:", await rowState("FEATURE_CRM"));
  const dis = row("FEATURE_CRM").locator('button:text-is("Disable")');
  if (await dis.count()) {
    await dis.click();
    await page.waitForTimeout(1800);
    const d = page.locator('[role="dialog"]').first();
    note("dialog box:", JSON.stringify(await d.boundingBox().catch(() => null)));
    note("dialog text:\n" + (await d.innerText()).slice(0, 900));
    await shot(page, "32-disable-confirm");
    const phrase = d.locator("#confirm-phrase");
    if (await phrase.count()) await phrase.fill(brand);
    const reason = d.locator("#confirm-reason");
    if (await reason.count()) await reason.fill("Diagnostic audit — verifying the module toggle actually persists.");
    await page.waitForTimeout(600);
    const go = d.locator("button", { hasText: /disable module/i }).last();
    note("confirm enabled?", await go.isEnabled());
    const cap = since();
    await go.click();
    await page.waitForTimeout(4500);
    note("network:", JSON.stringify(cap()));
    note("after DISABLE:", await rowState("FEATURE_CRM"));
    await shot(page, "33-module-disabled");
  }

  // ---------- 4. SUSPEND ----------
  note("\n=== 4. SUSPEND with phrase + reason ===");
  await page.locator("main button", { hasText: /^Suspend$/ }).first().click();
  await page.waitForTimeout(1800);
  {
    const d = page.locator('[role="dialog"]').first();
    await d.locator("#confirm-phrase").fill(brand);
    await d.locator("#confirm-reason").fill("Diagnostic audit — non-payment simulation.");
    await page.waitForTimeout(600);
    const go = d.locator("button", { hasText: /suspend tenant/i }).last();
    note("confirm enabled?", await go.isEnabled());
    const cap = since();
    await go.click();
    await page.waitForTimeout(5000);
    note("network:", JSON.stringify(cap()));
    note("status region:\n" + (await page.locator("main").innerText()).slice(0, 320));
    await shot(page, "34-after-suspend");
    const ctrls = [...new Set(await page.locator("main button").allInnerTexts())];
    note("controls after suspend:", JSON.stringify(ctrls));
  }

  // ---------- 5. REACTIVATE ----------
  note("\n=== 5. REACTIVATE ===");
  const re = page.locator("main button", { hasText: /reactivate|resume|unsuspend/i }).first();
  if (await re.count()) {
    await re.click(); await page.waitForTimeout(1800);
    const d = page.locator('[role="dialog"]');
    if (await d.count()) {
      const p2 = d.first().locator("#confirm-phrase");
      if (await p2.count()) await p2.fill(brand);
      const r2 = d.first().locator("#confirm-reason");
      if (await r2.count()) await r2.fill("Diagnostic audit — restoring.");
      await page.waitForTimeout(500);
      await d.first().locator("button", { hasText: /reactivat|resume/i }).last().click().catch((e) => note("fail", e.message.slice(0,60)));
    }
    const cap = since();
    await page.waitForTimeout(5000);
    note("network:", JSON.stringify(cap()));
    note("status:\n" + (await page.locator("main").innerText()).slice(0, 260));
    await shot(page, "35-after-reactivate");
  } else note("!! NO reactivate control while suspended");

  // ---------- 6. DELETE ----------
  note("\n=== 6. DELETE / cancel ===");
  const ctrls = [...new Set(await page.locator("main button, main a").allInnerTexts())].map(s=>s.replace(/\s+/g," ").trim());
  note("every control now:", JSON.stringify(ctrls));
  note("delete control present:", ctrls.some((t) => /delete|purge|terminate|cancel tenant/i.test(t)));

  writeFileSync(`${OUT}/final-log.txt`, log.join("\n"));
  writeFileSync(`${OUT}/final-api.txt`, api.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); writeFileSync(`${OUT}/final-log.txt`, log.join("\n") + "\nFATAL " + e.message); process.exit(1); });
