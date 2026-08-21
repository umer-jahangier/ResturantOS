/*
 * F11 RE-OPEN, step 3 — is the handed-over drawer a WORKING drawer, does it PERSIST, and is a
 * cashier refused when they try to do the manager's job?
 *
 * A CASH tender is refused with 409 NO_OPEN_TILL when the cashier has no drawer, so settling one
 * is itself proof the drawer is theirs and live.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  BASE,
  newBrowser,
  newPage,
  go,
  shot,
  apiGet,
  apiSend,
  tokenOf,
  claims,
  tillStrip,
  OUT,
  log,
} from "./lib.mjs";

const j = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const out = { ...j };
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

const browser = await newBrowser();
const cash = await newPage(browser);

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${email}`);
  log(`  ✓ signed in as ${email}`);
}

await signIn(cash, j.newCashier.email, j.newCashierPassword);
const tok = await tokenOf(cash);
const hc = claims(tok);

// ── PERSISTENCE: a fresh browser session, a fresh load ───────────────────────
let t = await go(cash, "/app/pos", { waitMs: 8000 });
note("posTrouble", t);
note("stripOnFreshSession", await tillStrip(cash));
await shot(cash, "20-fresh-session-strip");

// ── ring a takeaway check ────────────────────────────────────────────────────
log("\n=== the cashier rings a check against the drawer they were handed ===");
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(800);
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 30000 });

// Another agent's modifier catalogue went live mid-run: some dishes now open a modifier
// dialog on tap. Add the dish through it when it appears, cancel it when it blocks.
async function addTile(i) {
  await tiles.nth(i).click();
  await cash.waitForTimeout(1200);
  const dlg = cash.locator("[data-testid=modifier-dialog]");
  if (await dlg.count()) {
    const add = cash.locator("[data-testid=modifier-dialog-add]");
    if ((await add.count()) && (await add.first().isEnabled())) {
      await add.first().click();
    } else {
      await cash.getByRole("button", { name: /^Cancel$/ }).first().click();
    }
    await cash.waitForTimeout(1200);
  }
}
await addTile(0);
await addTile(1);
await cash.waitForTimeout(800);
await shot(cash, "21-cart");
await cash.getByRole("button", { name: /Send to Kitchen/i }).first().click();
await cash.waitForTimeout(7000);
await shot(cash, "22-fired");
const orderNo = await cash.evaluate(() => {
  const m = document.body.innerText.match(/ORD-\d{8}-\d+/);
  return m ? m[0] : null;
});
note("orderNo", orderNo);

await go(cash, "/app/pos", { waitMs: 6000 });
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(4500);
await cash.locator("[data-testid=order-management-search]").first().fill(orderNo);
await cash.waitForTimeout(4500);
const orderId = await cash.evaluate(
  () =>
    document
      .querySelector('[data-testid^="open-order-"]')
      ?.getAttribute("data-testid")
      ?.replace("open-order-", "") ?? null,
);
note("orderId", orderId);

// ── settle it in CASH ────────────────────────────────────────────────────────
await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
const fill = cash.locator("[data-testid=fill-full-amount-button]");
if (await fill.count()) {
  await fill.first().click();
  await cash.waitForTimeout(800);
}
const amountVal = await cash.locator('[aria-label="Amount (Rs)"]').first().inputValue();
note("billAmountRupees", amountVal);
const tenderRupees = String(Math.ceil(Number(amountVal) / 100) * 100);
const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
if (await tendered.count()) {
  await tendered.fill(tenderRupees);
  await cash.waitForTimeout(1200);
}
note("tenderedRupees", tenderRupees);
note(
  "changeOnScreen",
  await cash.evaluate(() => {
    const m = document.body.innerText.match(/Change[^0-9-]*(-?Rs[\s ]*[\d,]+\.\d{2})/i);
    return m ? m[1].replace(/\s+/g, " ") : null;
  }),
);
await shot(cash, "23-charge-cash");
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(8000);
await shot(cash, "24-after-payment");
note(
  "recordPaymentError",
  await cash.evaluate(
    () => document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
  ),
);

const pays = await apiGet(cash, `/api/v1/pos/orders/${orderId}/payments`, tok);
note("paymentRows", JSON.stringify(pays.body?.data ?? pays.body).slice(0, 500));

await go(cash, "/app/pos", { waitMs: 8000 });
await shot(cash, "25-strip-after-settle");
note("stripAfterSettle", await tillStrip(cash));

// ── the cashier tries to do the manager's job ────────────────────────────────
log("\n=== the cashier tries to open a drawer for the MANAGER ===");
t = await go(cash, "/app/pos/tills", { waitMs: 6000, allowTrouble: true });
note("cashierAtTillReview", t);
await shot(cash, "26-cashier-till-review");
note(
  "openDrawerButtonForCashier",
  await cash.locator("[data-testid=open-drawer-for-cashier-button]").count(),
);
const roster = await apiGet(cash, `/api/v1/pos/tills/cashiers?branchId=${hc.branch_id}`, tok);
note("cashierRosterStatus", roster.status);

const refusal = await apiSend(
  cash,
  "POST",
  "/api/v1/pos/tills",
  { branchId: hc.branch_id, openingFloatPaisa: 500000, cashierId: j.managerUserId },
  tok,
);
note("refusalStatus", refusal.status);
note("refusalTitle", refusal.body?.title ?? null);
note("refusalDetail", refusal.body?.detail ?? null);

// Nothing was created for the manager by that attempt.
const mgrTills = await apiGet(
  cash,
  `/api/v1/pos/tills?cashierId=${j.managerUserId}&status=OPEN`,
  tok,
);
note("managerOpenTillsAfterAttempt", JSON.stringify(mgrTills.body?.data ?? mgrTills.body).slice(0, 300));

writeFileSync(`${OUT}/journal.json`, JSON.stringify(out, null, 2));
log("\nstep 3 done");
await browser.close();
