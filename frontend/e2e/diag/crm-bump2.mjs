// DIAGNOSIS ONLY — walk the diag ticket all the way through the KDS state machine,
// then re-read loyalty. Proves whether the accrual half of the loop can ever fire from the UI.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty");
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const ORDER_NO = process.env.DIAG_ORDER_NO;
const PHONE = process.env.DIAG_PHONE;
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); say("   shot:", n + ".png"); };

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace");
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1050 } });
  const page = await ctx.newPage();
  page.on("response", (r) => { if (r.status() >= 400 && /api\/v1/.test(r.url())) say(`   HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  say("kitchen login:", await login(page, "kitchen@terrace.local", "Terrace#Kitchen1"));

  await page.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.locator(`text=${ORDER_NO}`).first().click();
  await page.waitForTimeout(3500);

  for (let step = 0; step < 6; step++) {
    const btns = page.locator("button").filter({ hasText: /Move to|Ready|Bump|Complete|Serve/i });
    const labels = await btns.allTextContents();
    say(`step ${step}: buttons ${JSON.stringify(labels)} url=${page.url()}`);
    if (!labels.length) break;
    await btns.first().click().catch(() => {});
    await page.waitForTimeout(3500);
  }
  await shot(page, "bump2-final-ticket");
  say("FINAL TICKET >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 900));
  await ctx.close();

  await new Promise((r) => setTimeout(r, 8000));
  const c2 = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const p2 = await c2.newPage();
  await login(p2, "cashier@terrace.local", "Terrace#Cashier1");
  await p2.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(4500);
  const sb = p2.locator('input[aria-label="Search customers"], input[placeholder*="earch" i]');
  if (await sb.count()) { await sb.first().fill(PHONE); await p2.waitForTimeout(3500); }
  const row = p2.locator("table tbody tr, ul li button").first();
  if (await row.count()) { await row.click().catch(() => {}); await p2.waitForTimeout(2500); }
  await shot(p2, "bump2-loyalty-final");
  say("LOYALTY FINAL >>>", (await p2.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1100));
  await c2.close();
  await browser.close();
  writeFileSync(`${OUT}/bump2-log.txt`, log.join("\n"));
}
main().catch((e) => { console.error(e); writeFileSync(`${OUT}/bump2-log.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
