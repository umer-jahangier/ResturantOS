// DIAGNOSIS ONLY — finish settling the diag order in full, then check loyalty accrual.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty");
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const ORDER = process.env.DIAG_ORDER;
const PHONE = process.env.DIAG_PHONE;

const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); say("   shot:", n + ".png"); };

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace");
  await page.locator('input[name="email"], input#email').first().fill("cashier@terrace.local");
  await page.locator('input[name="password"], input#password').first().fill("Terrace#Cashier1");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("response", (r) => { if (r.status() >= 400 && /api\/v1/.test(r.url())) say(`   HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  say("login:", await login(page));

  await page.goto(`${BASE}/app/pos/orders/${ORDER}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await shot(page, "settle-1-before");

  const full = page.locator('button:has-text("Full amount")');
  say("Full amount button:", await full.count());
  if (await full.count()) { await full.first().click(); await page.waitForTimeout(1200); }
  const cash = page.locator('button', { hasText: /^CASH$/ });
  if (await cash.count()) { await cash.first().click().catch(() => {}); await page.waitForTimeout(800); }
  if (await full.count()) { await full.first().click().catch(() => {}); await page.waitForTimeout(1200); }
  await shot(page, "settle-2-tender-set");
  say("TENDER >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 900));

  const rec = page.locator('button:has-text("Record Payment")');
  if (await rec.count() && !(await rec.first().isDisabled())) {
    await rec.first().click();
    await page.waitForTimeout(8000);
  } else { say("   !! Record Payment unavailable/disabled"); }
  await shot(page, "settle-3-after");
  const t = await page.locator("body").innerText();
  say("AFTER >>>", t.replace(/\n/g, " | ").slice(0, 1400));

  // give the ORDER_CLOSED consumer time
  await page.waitForTimeout(12000);
  await page.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const sb = page.locator('input[aria-label="Search customers"], input[placeholder*="earch" i]');
  if (await sb.count()) { await sb.first().fill(PHONE); await page.waitForTimeout(3500); }
  await shot(page, "settle-4-loyalty-check");
  say("LOYALTY AFTER FULL SETTLEMENT >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));

  await ctx.close(); await browser.close();
  writeFileSync(`${OUT}/settle-log.txt`, log.join("\n"));
}
main().catch((e) => { console.error(e); writeFileSync(`${OUT}/settle-log.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
