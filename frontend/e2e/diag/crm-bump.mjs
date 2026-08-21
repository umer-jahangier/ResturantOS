// DIAGNOSIS ONLY — bump the diag ticket on the KDS so the paid order transitions to CLOSED,
// then re-read loyalty. This is the last link in "does the loyalty loop close at all".
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
  await page.waitForTimeout(7000);
  await shot(page, "bump-1-board");
  let body = await page.locator("body").innerText();
  say("board has diag ticket?", body.includes(ORDER_NO));
  say("BOARD >>>", body.replace(/\n/g, " | ").slice(0, 2000));

  const el = page.locator(`text=${ORDER_NO}`);
  say("ticket matches:", await el.count());
  if (await el.count()) {
    await el.first().scrollIntoViewIfNeeded().catch(() => {});
    await el.first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, "bump-2-ticket-open");
    say("TICKET >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));
    const btns = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim()).filter(Boolean));
    say("TICKET BUTTONS >>>", JSON.stringify(btns.slice(0, 40)));
    for (const label of [/^Start/i, /^Ready/i, /^Bump/i, /^Complete/i, /^Serve/i, /^Mark served/i]) {
      const b = page.locator("button").filter({ hasText: label });
      if (await b.count()) { say("   clicking", (await b.first().textContent()).trim()); await b.first().click().catch(() => {}); await page.waitForTimeout(3000); }
    }
    await shot(page, "bump-3-after");
  }
  await ctx.close();

  // Re-read loyalty as the cashier (manager permissions went flaky mid-session).
  const c2 = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const p2 = await c2.newPage();
  await login(p2, "cashier@terrace.local", "Terrace#Cashier1");
  await p2.waitForTimeout(10000);
  await p2.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(4500);
  const sb = p2.locator('input[aria-label="Search customers"], input[placeholder*="earch" i]');
  if (await sb.count()) { await sb.first().fill(PHONE); await p2.waitForTimeout(3500); }
  await shot(p2, "bump-4-loyalty");
  say("LOYALTY >>>", (await p2.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1000));
  await c2.close();

  await browser.close();
  writeFileSync(`${OUT}/bump-log.txt`, log.join("\n"));
}
main().catch((e) => { console.error(e); writeFileSync(`${OUT}/bump-log.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
