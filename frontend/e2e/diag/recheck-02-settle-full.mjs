// DIAGNOSIS ONLY — finish paying the SERVED order in full via the "Full amount" control,
// then check whether the order auto-closes and loyalty accrues.
import { launch, login, shot, goodGoto, buttons, makeLog, PERSONAS, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("02-settle-full-log");
const ORDER_ID = process.argv[2];
const PHONE = process.argv[3];

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();
  page.on("response", (r) => {
    const u = r.url();
    if (/\/api\/v1\/(pos|crm)\//.test(u) && r.status() >= 400) {
      say(`   HTTP ${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
    }
  });

  if (!(await login(page, PERSONAS.cashier, say))) return finish(browser);

  // What IS the [role=alert] that fires on every POS/CRM load? Audit it, don't assume.
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  say("ALERT ELEMENTS ON /app/pos:", JSON.stringify(alerts));

  await goodGoto(page, `${BASE}/app/pos/orders/${ORDER_ID}/charge`, say);
  say("BEFORE >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 700));
  await shot(page, "10-charge-before", say);

  // Click the product's own "Full amount" affordance rather than typing a number.
  const full = page.locator('button:has-text("Full amount")');
  say("   'Full amount' present:", await full.count());
  if (await full.count()) { await full.first().click(); await page.waitForTimeout(1500); }
  await shot(page, "11-full-amount-clicked", say);
  say("AFTER FULL AMOUNT >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 700));

  const rec = page.locator('button:has-text("Record Payment")');
  if (await rec.count()) {
    say("   Record Payment disabled:", await rec.first().isDisabled());
    await rec.first().click();
    await page.waitForTimeout(9000);
  }
  await shot(page, "12-after-full-payment", say);
  const after = await page.locator("body").innerText();
  say("AFTER PAY >>>", after.replace(/\n/g, " | ").slice(0, 1100));
  say("   says fully paid:", /fully paid|Remaining balance\s*Rs\s*0\.00|Paid/i.test(after));

  // Let the ORDER_CLOSED event propagate to crm-service.
  await page.waitForTimeout(10000);
  await goodGoto(page, `${BASE}/app/crm`, say);
  const sb = page.locator('input[aria-label="Search customers"], input[placeholder*="earch" i]');
  if (await sb.count() && PHONE) { await sb.first().fill(PHONE); await page.waitForTimeout(3500); }
  const row = page.locator("table tbody tr, ul li button").first();
  if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(3000); }
  await shot(page, "13-crm-final", say);
  say("CRM FINAL >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1300));

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
