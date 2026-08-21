/* DAY 2 — step 4: MONEY. Cash with change on the discounted dine-in check; a manager's
 * 10% on a clean take-away check settled by card; then a void attempt on a PAID check. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const B = S.branchId;
const browser = await newBrowser();

async function bill(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const g = (re) => re.exec(t)?.[1] ?? null;
    return {
      subtotal: g(/Subtotal (Rs [\d,]+\.\d\d)/), discounts: g(/Discounts (-?Rs ?[\d,]+\.\d\d)/),
      service: g(/Service charge \([\d.]+%\) (Rs [\d,]+\.\d\d)/), taxes: g(/Taxes (Rs [\d,]+\.\d\d)/),
      total: g(/Total (Rs [\d,]+\.\d\d)/), remaining: g(/Remaining balance (Rs [\d,]+\.\d\d)/),
      changeDue: document.querySelector("[data-testid=change-due-value]")?.innerText.trim() ?? null,
      changeDataPaisa: document.querySelector("[data-testid=change-due-value]")?.getAttribute("data-paisa") ?? null,
      history: document.querySelector("[data-testid=payment-history-rows]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
      paidChip: document.querySelector("[data-testid=paid-chip]")?.innerText.trim() ?? null,
    };
  });
}
const cashLogin = async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(NEW.slug);
  await page.locator('input[name="email"]').first().fill(NEW.email);
  await page.locator('input[name="password"]').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
};

// ── 4a. CASH with change ─────────────────────────────────────────────────────
log("\n=== 4a. cash with change on", S.order1.no, "===");
const cash = await newPage(browser);
await cashLogin(cash);
await go(cash, `/app/pos/orders/${S.order1.id}/charge`, { waitMs: 8000 });
const b0 = await bill(cash);
log("  bill:", JSON.stringify(b0));
await cash.getByRole("button", { name: /^CASH$/ }).first().click().catch(() => {});
await cash.waitForTimeout(600);
await cash.locator("[data-testid=fill-full-amount-button]").click();
await cash.waitForTimeout(900);
const tendered = cash.locator("input").filter({ hasNot: cash.locator("x") });
// tendered box: labelled "Tendered (Rs)"
const tenderedBox = cash.getByLabel(/Tendered/i).first();
await tenderedBox.fill("3000");
await cash.waitForTimeout(1200);
const preview = await bill(cash);
log("  BEFORE RECORDING — change due:", preview.changeDue, "data-paisa:", preview.changeDataPaisa);
await shot(cash, "04a-cash-tender-preview");
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(6000);
await shot(cash, "04b-cash-recorded");
const afterCash = await bill(cash);
log("  AFTER RECORDING:", JSON.stringify(afterCash));
const err = await cash.evaluate(() => document.querySelector("[data-testid=record-payment-error]")?.innerText.trim() ?? null);
log("  record error:", err);

// the payment rows, on the cashier's own bearer
const pays = await apiGet(cash, `/api/v1/pos/orders/${S.order1.id}/payments?branchId=${B}`);
log("  order_payments:", JSON.stringify(pays.body).slice(0, 700));

// did a bill print at TENDER (not at close)?
const jobs = await apiGet(cash, `/api/v1/pos/orders/${S.order1.id}/print-jobs?branchId=${B}`);
log("  print-jobs:", JSON.stringify(jobs.body).slice(0, 800));
const strip = await cash.evaluate(() => document.querySelector("[data-testid=bill-issued-strip]")?.innerText.replace(/\s+/g, " ").trim() ?? null);
log("  bill-issued strip:", strip);
saveState({ cashSettle: { b0, preview, afterCash, payments: pays.body, printJobs: jobs.body, strip } });
await browser.close();
