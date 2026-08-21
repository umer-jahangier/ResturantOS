// DIAGNOSIS ONLY — bump the diag ticket in the kitchen so the paid order CLOSES,
// then check whether loyalty points actually accrued for the attached diner.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty");
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const ORDER_NO = process.env.DIAG_ORDER_NO || "ORD-20260812-0007";
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
  await page.waitForTimeout(4000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();

  // Kitchen bumps the ticket.
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  say("kitchen login:", await login(page, "kitchen@terrace.local", "Terrace#Kitchen1"));
  await page.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await shot(page, "close-1-kds");
  const stations = await page.locator("a[href*='/app/kitchen/']").allTextContents();
  say("KDS stations:", JSON.stringify(stations.slice(0, 10)));
  const link = page.locator("a[href*='/app/kitchen/']").first();
  if (await link.count()) { await link.click(); await page.waitForTimeout(6000); }
  await shot(page, "close-2-station");
  let body = await page.locator("body").innerText();
  say("STATION has diag order?", body.includes(ORDER_NO));
  say("STATION >>>", body.replace(/\n/g, " | ").slice(0, 1200));

  // Find the ticket card and bump it.
  const card = page.locator(`:has-text("${ORDER_NO}")`).last();
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const bump = page.locator("button").filter({ hasText: /bump|ready|complete|done|serve/i });
    say("bump-ish buttons:", JSON.stringify((await bump.allTextContents()).slice(0, 12)));
  }

  await ctx.close();

  // Manager: mark items served via order management, which is the other close path.
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p2 = await ctx2.newPage();
  p2.on("response", (r) => { if (r.status() >= 400 && /api\/v1/.test(r.url())) say(`   HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  say("manager login:", await login(p2, "manager@terrace.local", "Terrace#Manager1"));
  await p2.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(5000);
  const om = p2.locator('button:has-text("Order Management"), a:has-text("Order Management")');
  if (await om.count()) { await om.first().click(); await p2.waitForTimeout(4000); }
  await shot(p2, "close-3-order-mgmt");
  const ordLink = p2.locator(`text=${ORDER_NO}`).first();
  if (await ordLink.count()) { await ordLink.click(); await p2.waitForTimeout(4000); }
  await shot(p2, "close-4-order-detail");
  const t2 = await p2.locator("body").innerText();
  say("ORDER DETAIL >>>", t2.replace(/\n/g, " | ").slice(0, 1800));
  const served = p2.locator("button").filter({ hasText: /serve|served|deliver|mark/i });
  say("serve buttons:", JSON.stringify(await served.allTextContents()));
  if (await served.count()) {
    for (let i = 0; i < await served.count(); i++) {
      await served.nth(i).click().catch(() => {});
      await p2.waitForTimeout(2500);
    }
  }
  await p2.waitForTimeout(4000);
  await shot(p2, "close-5-after-serve");
  say("AFTER SERVE >>>", (await p2.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1400));

  await p2.waitForTimeout(10000);
  await p2.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(4000);
  const sb = p2.locator('input[aria-label="Search customers"], input[placeholder*="earch" i]');
  if (await sb.count()) { await sb.first().fill(PHONE); await p2.waitForTimeout(3500); }
  await shot(p2, "close-6-loyalty-final");
  say("LOYALTY FINAL >>>", (await p2.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));

  await ctx2.close();
  await browser.close();
  writeFileSync(`${OUT}/close-log.txt`, log.join("\n"));
}
main().catch((e) => { console.error(e); writeFileSync(`${OUT}/close-log.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
