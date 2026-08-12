/*
 * F11 PROOF, part 2 — the handed-over drawer is a WORKING drawer, and a cashier cannot
 * open one for anybody else.
 *
 *  5. The new cashier rings a takeaway check and settles it in CASH against the drawer the
 *     manager opened. Cash settlement REQUIRES an open till (`409 NO_OPEN_TILL` otherwise), so a
 *     successful cash tender is itself proof the drawer is theirs and live.
 *  6. The same cashier tries to open a drawer for a different, named user — from the UI (the
 *     control must not be there) and over HTTP on their OWN bearer (the server must refuse, by
 *     name).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, newBrowser, newPage, go, shot, apiGet, apiSend, tokenOf, OUT, log } from "./lib.mjs";

const journal = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const NEW = journal.newCashier;
const out = { ...journal };
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

const browser = await newBrowser();

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${email}`);
  log(`  ✓ signed in as ${email}`);
}

const cash = await newPage(browser);
await signIn(cash, NEW.email, NEW.newPassword);
const tok = await tokenOf(cash);

// ── 5. ring a check and settle it in CASH against the handed-over drawer ─────
log("\n=== 5. the cashier rings and settles against the drawer they were handed ===");
let t = await go(cash, "/app/pos", { waitMs: 7000 });
log("  /app/pos trouble:", JSON.stringify(t));

await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(600);
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 25000 });
await tiles.nth(0).click();
await cash.waitForTimeout(300);
await tiles.nth(1).click();
await cash.waitForTimeout(900);
await shot(cash, "08-cashier-cart");

await cash.getByRole("button", { name: /Send to Kitchen/i }).first().click();
await cash.waitForTimeout(6000);
await shot(cash, "09-cashier-fired");
const orderNo = await cash.evaluate(() => {
  const m = document.body.innerText.match(/ORD-\d{8}-\d+/);
  return m ? m[0] : null;
});
note("orderNo", orderNo);

// Find it in Order Management and open the charge page.
await go(cash, "/app/pos", { waitMs: 6000 });
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(4000);
await cash.locator("[data-testid=order-management-search]").first().fill(orderNo);
await cash.waitForTimeout(4000);
const orderId = await cash.evaluate(
  () =>
    document.querySelector('[data-testid^="open-order-"]')?.getAttribute("data-testid")
      ?.replace("open-order-", "") ?? null,
);
note("orderId", orderId);

await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 6000 });
const fill = cash.locator("[data-testid=fill-full-amount-button]");
if (await fill.count()) {
  await fill.first().click();
  await cash.waitForTimeout(700);
}
const amountVal = await cash.locator('[aria-label="Amount (Rs)"]').first().inputValue();
note("billAmount", amountVal);
const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
if (await tendered.count()) {
  await tendered.fill(String(Math.ceil(Number(amountVal) / 100) * 100));
  await cash.waitForTimeout(900);
}
await shot(cash, "10-charge-page-cash");
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "11-after-cash-payment");
note("paymentError", await cash.evaluate(
  () => document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
));

// The server's own payment rows, on the cashier's bearer.
const pays = await apiGet(cash, `/api/v1/pos/orders/${orderId}/payments`, tok);
note("paymentRows", JSON.stringify(pays.body?.data ?? pays.body).slice(0, 400));

// The drawer the manager opened now carries that cash.
await go(cash, "/app/pos", { waitMs: 7000 });
await shot(cash, "12-cashier-till-strip-after-settle");
note("cashierStripAfterSettle", await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  return b ? b.parentElement.innerText.replace(/\s+/g, " ").trim() : "(no open till)";
}));

// ── 6. the cashier tries to open a drawer for somebody else ─────────────────
log("\n=== 6. the cashier tries to open a drawer for the MANAGER ===");

// (a) The screen: Till Review is not theirs, and the control is not on it.
t = await go(cash, "/app/pos/tills", { waitMs: 5000, allowTrouble: true });
note("cashierAtTillReview", JSON.stringify(t));
await shot(cash, "13-cashier-till-review-denied");
note("openDrawerButtonForCashier", await cash.locator("[data-testid=open-drawer-for-cashier-button]").count());
note("eligibleCashierListForCashier", (await apiGet(cash, `/api/v1/pos/tills/cashiers?branchId=${journal.cashierBranchId}`, tok)).status);

// (b) The server, on the cashier's OWN bearer — no injected token, no manager anywhere.
const refusal = await apiSend(cash, "POST", "/api/v1/pos/tills", {
  branchId: journal.cashierBranchId,
  openingFloatPaisa: 500000,
  cashierId: journal.managerUserId,
}, tok);
note("refusalStatus", refusal.status);
note("refusalTitle", refusal.body?.title ?? refusal.body?.error?.code ?? null);
note("refusalDetail", refusal.body?.detail ?? refusal.body?.error?.message ?? null);

// Nothing was created for the manager by that attempt.
const mgrTills = await apiGet(cash, `/api/v1/pos/tills?cashierId=${journal.managerUserId}&status=OPEN`, tok);
note("managerTillsAfterAttempt", JSON.stringify(mgrTills.body?.data ?? mgrTills.body).slice(0, 300));

writeFileSync(`${OUT}/journal.json`, JSON.stringify(out, null, 2));
log("\nstep 3 done");
await browser.close();
