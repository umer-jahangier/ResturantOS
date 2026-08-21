/*
 * SHIFT STEP 3 — MONEY.
 *
 *  a. Settle the dine-in check in CASH with a note bigger than the bill; read change due.
 *  b. Settle the takeaway check by CARD.
 *  c. Try to give a discount.
 *  d. Void an UNPAID check.  e. Try to void a PAID one, and read the payment rows after.
 *
 * Every figure is read off the screen the cashier is looking at AND off
 * `GET /orders/{id}/payments` on the same persona's bearer, so a screen that agrees with
 * itself but not with the ledger cannot pass.
 */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE, money } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(NEW.email);
  await page.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  log("  ✓", NEW.email);
}

/** Open Order Management, search for a number, return {orderId, rowText}. */
async function findOrder(page, no) {
  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4000);
  const search = page.locator("[data-testid=order-management-search]");
  await search.first().fill(no);
  await page.waitForTimeout(4000);
  return page.evaluate((n) => {
    const t = document.body.innerText;
    const i = t.indexOf(n);
    const btn = document.querySelector('[data-testid^="open-order-"]');
    return {
      rowText: i >= 0 ? t.slice(Math.max(0, i - 30), i + 240).replace(/\s+/g, " ") : null,
      orderId: btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null,
    };
  }, no);
}

const cash = await newPage(browser);
await signIn(cash);

// ── 3a. CASH with change ──────────────────────────────────────────────────────
log("\n=== 3a. settle the dine-in check in CASH, with change ===");
const f1 = await findOrder(cash, st.order1No);
log("  order 1:", JSON.stringify(f1));
saveState({ order1Id: f1.orderId });
await go(cash, `/app/pos/orders/${f1.orderId}/charge`, { waitMs: 6000 });
await shot(cash, "03a-charge-page-order1");

const chargeProbe = async (p) =>
  p.evaluate(() => {
    const t = document.body.innerText;
    const g = (re) => re.exec(t)?.[1] ?? null;
    return {
      heading: document.querySelector("h1")?.textContent?.trim() ?? null,
      total: g(/Total\s*\n?\s*(Rs [\d,]+\.\d\d)/),
      balance: g(/(?:Remaining )?[Bb]alance[^\n]*\n?\s*(Rs [\d,]+\.\d\d)/),
      methodOptions: Array.from(document.querySelectorAll('select[aria-label="Payment method"] option')).map((o) => o.textContent.trim()),
      amountLabel: document.querySelector('[aria-label="Amount (Rs)"]')?.getAttribute("aria-label") ?? null,
      amountPlaceholder: document.querySelector('[aria-label="Amount (Rs)"]')?.getAttribute("placeholder") ?? null,
      tenderedPresent: !!document.querySelector('[aria-label="Tendered (Rs)"]'),
      changeDue: document.querySelector("[data-testid=change-due-value]")?.textContent?.trim() ?? null,
      denoms: Array.from(document.querySelectorAll('[data-testid^="denom-"]')).map((b) => b.textContent.trim()),
      discountControls: Array.from(document.querySelectorAll("button,a"))
        .map((n) => (n.textContent || "").trim())
        .filter((x) => /discount|comp|promo|voucher|coupon/i.test(x)),
      tipControls: Array.from(document.querySelectorAll("button,input,label"))
        .map((n) => (n.textContent || n.getAttribute("aria-label") || "").trim())
        .filter((x) => /tip|service charge/i.test(x)),
      raw: t.replace(/\s+/g, " ").slice(0, 700),
    };
  });

let cp = await chargeProbe(cash);
log("  charge page:", JSON.stringify(cp, null, 1));
saveState({ chargePage1: cp });

// CASH, exact bill, tendered 2000
const amount = cash.locator('[aria-label="Amount (Rs)"]').first();
const fill = cash.locator("[data-testid=fill-full-amount-button]");
if (await fill.count()) {
  await fill.first().click();
  await cash.waitForTimeout(600);
}
const amountVal = await amount.inputValue();
log("  amount field after 'fill full amount':", amountVal);
const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
log("  tendered field present:", await tendered.count());
if (await tendered.count()) {
  await tendered.fill("2000");
  await cash.waitForTimeout(900);
}
const beforePay = await cash.evaluate(() => ({
  change: document.querySelector("[data-testid=change-due-value]")?.textContent?.trim() ?? null,
  changePaisa: document.querySelector("[data-testid=change-due-value]")?.getAttribute("data-paisa") ?? null,
  short: document.querySelector("[data-testid=tender-short-message]")?.textContent?.trim() ?? null,
  balanceAfter: document.querySelector("[data-testid=balance-after-tender-value]")?.textContent?.trim() ?? null,
  tenderTotal: document.querySelector("[data-testid=tender-total-value]")?.textContent?.trim() ?? null,
}));
log("  before pressing Record payment:", JSON.stringify(beforePay));
await shot(cash, "03b-cash-tendered-change-due");

await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(6000);
await shot(cash, "03c-after-cash-payment");
const afterPay = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
  rows: Array.from(document.querySelectorAll("[data-testid=payment-history-rows] > *")).map((n) => n.innerText.replace(/\s+/g, " ").trim()),
  paid: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
  closeBtn: (() => {
    const b = document.querySelector("[data-testid=close-order-button]");
    return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
  })(),
  blocked: document.querySelector("[data-testid=payment-blocked-message]")?.textContent?.trim() ?? null,
  raw: document.body.innerText.replace(/\s+/g, " ").slice(0, 800),
}));
log("  after payment:", JSON.stringify(afterPay, null, 1));
saveState({ order1Payment: afterPay });

const pay1 = await apiGet(cash, `/api/v1/pos/orders/${f1.orderId}/payments`);
log("  GET payments:", JSON.stringify(pay1.body).slice(0, 900));
saveState({ order1PaymentsApi: pay1.body });

await browser.close();
log("\nstep 3a done");
