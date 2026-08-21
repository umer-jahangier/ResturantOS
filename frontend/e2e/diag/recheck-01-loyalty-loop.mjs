// DIAGNOSIS ONLY — the decisive test: does loyalty accrue when the order is ACTUALLY
// driven to SERVED (via the "Mark Served" control in the POS order panel) and then paid?
// The prior audit settled first and never marked lines served, so the order never closed.
import { launch, login, shot, goodGoto, buttons, makeLog, PERSONAS, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("01-loyalty-loop-log");
const PHONE = "0300" + Math.floor(1000000 + Math.random() * 8999999);
const NAME = "Recheck Loyalty " + PHONE.slice(-4);

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();
  page.on("response", (r) => {
    const u = r.url();
    if (/\/api\/v1\/(pos|crm)\//.test(u) && r.status() >= 400) {
      say(`   HTTP ${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
    }
  });

  say("=== RECHECK: full loyalty loop WITH Mark Served ===");
  say("phone:", PHONE, "name:", NAME);
  if (!(await login(page, PERSONAS.cashier, say))) return finish(browser);

  // ---- 1. Ring an item ----
  await goodGoto(page, `${BASE}/app/pos`, say);
  const item = page.locator("button", { hasText: "Chicken Karahi" });
  if (!(await item.count())) { say("!! no Chicken Karahi button on the POS"); return finish(browser); }
  await item.first().click();
  await page.waitForTimeout(2000);
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.count()) {
    const box = await dlg.first().boundingBox();
    say("   modifier dialog box:", JSON.stringify(box));
    const add = dlg.locator("button").filter({ hasText: /^(Add|Add to order|Confirm|Done|Save)/i });
    if (await add.count()) await add.last().click().catch(() => {});
    await page.waitForTimeout(1800);
  }
  await shot(page, "01-cart", say);

  // ---- 2. Attach a NEW customer by phone (re-drives the prior agent's WORKS claim) ----
  const addCust = page.locator('button:has-text("Add customer")');
  say("   'Add customer' present:", await addCust.count());
  if (await addCust.count()) {
    await addCust.first().click();
    await page.waitForTimeout(900);
    await page.locator('input[aria-label="Search for a customer"]').fill(PHONE);
    await page.waitForTimeout(2500);
    const nameField = page.locator('input[aria-label="New customer name"]');
    if (await nameField.count()) {
      await nameField.fill(NAME);
      await page.waitForTimeout(500);
      const enrol = page.locator("button", { hasText: /^Enrol/ });
      if (await enrol.count()) { await enrol.first().click(); await page.waitForTimeout(4000); }
    } else say("   !! no enrolment field for a full phone number");
  }
  await shot(page, "02-customer-attached", say);
  const afterAttach = await page.locator("body").innerText();
  say("   cart shows phone:", afterAttach.includes(PHONE), "| shows pts:", /\d+\s*pts/.test(afterAttach));

  // ---- 3. Send to kitchen (lines must be fired before they can be served) ----
  const send = page.locator('button:has-text("Send to Kitchen")');
  if (await send.count() && !(await send.first().isDisabled())) {
    await send.first().click();
    await page.waitForTimeout(6000);
    say("   sent to kitchen");
  }
  await shot(page, "03-sent-to-kitchen", say);
  say("   BUTTONS after send:", JSON.stringify(await buttons(page)));

  // ---- 4. THE STEP THE PRIOR AUDIT NEVER TOOK: Mark Served ----
  let markServed = page.locator('button:has-text("Mark Served")');
  say("   'Mark Served' buttons visible:", await markServed.count());
  let served = 0;
  for (let i = 0; i < 8; i++) {
    markServed = page.locator('button:has-text("Mark Served")');
    if (!(await markServed.count())) break;
    await markServed.first().click().catch(() => {});
    await page.waitForTimeout(3000);
    served++;
  }
  say("   lines marked served:", served);
  await shot(page, "04-after-mark-served", say);
  const afterServe = await page.locator("body").innerText();
  say("   AFTER SERVE >>>", afterServe.replace(/\n/g, " | ").slice(0, 900));

  // ---- 5. Charge in full ----
  const charge = page.locator('button:has-text("Charge Now")');
  if (await charge.count() && !(await charge.first().isDisabled())) {
    await charge.first().click();
    await page.waitForTimeout(5500);
    say("   charge url:", page.url());
    const ctxt = await page.locator("body").innerText();
    say("   CHARGE SCREEN >>>", ctxt.replace(/\n/g, " | ").slice(0, 1000));
    say("   redemption control on charge screen?", /redeem|apply points|use points|reward/i.test(ctxt));
    say("   CHARGE BUTTONS:", JSON.stringify(await buttons(page)));
    await shot(page, "05-charge", say);

    const cash = page.locator("button", { hasText: /^Cash$/i });
    if (await cash.count()) { await cash.first().click(); await page.waitForTimeout(1200); }
    const amt = page.locator('input[type="number"], input[inputmode="decimal"]');
    if (await amt.count()) { await amt.first().fill("5000"); await page.waitForTimeout(700); }
    const pay = page.locator("button").filter({ hasText: /Record Payment|Take payment|Settle|Complete|Pay|Confirm/i });
    say("   settle buttons:", JSON.stringify(await pay.allTextContents()));
    if (await pay.count()) { await pay.last().click(); await page.waitForTimeout(8000); }
    await shot(page, "06-after-payment", say);
    say("   AFTER PAY >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1000));
  } else say("   !! Charge Now unavailable/disabled");

  // ---- 6. Did points accrue? ----
  await page.waitForTimeout(8000);
  await goodGoto(page, `${BASE}/app/crm`, say);
  const sb = page.locator('input[aria-label="Search customers"], input[placeholder*="earch" i]');
  if (await sb.count()) { await sb.first().fill(PHONE); await page.waitForTimeout(3500); }
  await shot(page, "07-crm-after", say);
  const crm = await page.locator("body").innerText();
  say("   CRM >>>", crm.replace(/\n/g, " | ").slice(0, 1200));
  const row = page.locator("table tbody tr, ul li button").first();
  if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(3000); }
  await shot(page, "08-crm-detail", say);
  say("   CRM DETAIL >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1400));

  say("PHONE_USED=" + PHONE);
  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
