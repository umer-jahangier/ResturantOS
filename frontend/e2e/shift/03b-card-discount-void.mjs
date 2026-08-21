/*
 * SHIFT STEP 3b — card, discount, and the two voids.
 *
 *  b. Settle the takeaway check by CARD.
 *  c. Hunt for a discount anywhere a cashier or manager could reach one.
 *  d. Void an UNPAID check (a third order, rung and parked).
 *  e. Try to void the PAID check, then read its payment rows either way.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE } from "./lib.mjs";

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
async function findOrder(page, no) {
  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4000);
  await page.locator("[data-testid=order-management-search]").first().fill(no);
  await page.waitForTimeout(4000);
  return page.evaluate((n) => {
    const t = document.body.innerText;
    const i = t.indexOf(n);
    const btn = document.querySelector('[data-testid^="open-order-"]');
    return {
      rowText: i >= 0 ? t.slice(Math.max(0, i - 30), i + 260).replace(/\s+/g, " ") : null,
      orderId: btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null,
    };
  }, no);
}

const cash = await newPage(browser);
await signIn(cash);

// ── 3b. CARD ──────────────────────────────────────────────────────────────────
log("\n=== 3b. settle the takeaway check by CARD ===");
const f2 = await findOrder(cash, st.order2No);
log("  order 2:", JSON.stringify(f2));
saveState({ order2Id: f2.orderId });
await go(cash, `/app/pos/orders/${f2.orderId}/charge`, { waitMs: 6000 });
await cash.locator('select[aria-label="Payment method"]').first().selectOption("CARD");
await cash.waitForTimeout(700);
const cardShape = await cash.evaluate(() => ({
  tenderedVisible: !!document.querySelector('[aria-label="Tendered (Rs)"]'),
  refVisible: !!document.querySelector('[aria-label="Reference number"]'),
  denoms: document.querySelectorAll('[data-testid^="denom-"]').length,
}));
log("  CARD row shape:", JSON.stringify(cardShape));
await cash.locator("[data-testid=fill-full-amount-button]").first().click();
await cash.waitForTimeout(500);
await cash.locator('[aria-label="Reference number"]').first().fill("VISA-4411");
await shot(cash, "03d-card-tender");
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(6000);
await shot(cash, "03e-after-card-payment");
const card = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
  rows: Array.from(document.querySelectorAll("[data-testid=payment-history-rows] > *")).map((n) => n.innerText.replace(/\s+/g, " ").trim()),
  raw: document.body.innerText.replace(/\s+/g, " ").slice(0, 620),
}));
log("  after CARD:", JSON.stringify(card, null, 1));
const pay2 = await apiGet(cash, `/api/v1/pos/orders/${f2.orderId}/payments`);
log("  payments:", JSON.stringify(pay2.body).slice(0, 600));
saveState({ order2Payments: pay2.body, order2Screen: card });

// ── 3c. discount hunt ─────────────────────────────────────────────────────────
log("\n=== 3c. is there ANY way to give a discount? ===");
const discountHunt = {};
for (const [name, route] of [
  ["charge-page", `/app/pos/orders/${st.order1Id}/charge`],
  ["pos-terminal", "/app/pos"],
]) {
  await go(cash, route, { waitMs: 6000 });
  discountHunt[name] = await cash.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button,a,label,input,select,[role=menuitem]"));
    return all
      .map((n) => (n.textContent || n.getAttribute("aria-label") || "").trim())
      .filter((x) => x && /discount|comp\b|promo|voucher|coupon|off\b|percent|%/i.test(x))
      .slice(0, 20);
  });
  log(`  ${name}:`, JSON.stringify(discountHunt[name]));
}
// the drawer's own action list
await go(cash, "/app/pos", { waitMs: 6000 });
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(4000);
const anyOpen = cash.locator('[data-testid^="open-order-"]').first();
if (await anyOpen.count()) {
  await anyOpen.click();
  await cash.waitForTimeout(3000);
  discountHunt.drawer = await cash.evaluate(() => {
    const d = document.querySelector("[data-testid=order-table-detail-drawer]");
    if (!d) return null;
    return {
      buttons: Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean),
      hasDiscountWord: /discount|comp\b/i.test(d.innerText),
    };
  });
  log("  drawer actions:", JSON.stringify(discountHunt.drawer));
  await shot(cash, "03f-drawer-actions");
}
// Does the endpoint exist, and would this persona be allowed?
const discApi = await apiSend(cash, "POST", `/api/v1/pos/orders/${st.order1Id}/discounts`, {
  discountType: "PERCENT",
  value: "10",
  reason: "shift walkthrough",
});
log("  POST /orders/{id}/discounts as cashier →", discApi.status, JSON.stringify(discApi.body).slice(0, 300));
discountHunt.apiAsCashier = { status: discApi.status, body: discApi.body };
saveState({ discountHunt });

// as the MANAGER, who would actually authorise a comp
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, "/app/pos", { waitMs: 6000 });
const discApiMgr = await apiSend(mgr, "POST", `/api/v1/pos/orders/${st.order1Id}/discounts`, {
  discountType: "PERCENT",
  value: "10",
  reason: "shift walkthrough",
});
log("  POST /orders/{id}/discounts as manager →", discApiMgr.status, JSON.stringify(discApiMgr.body).slice(0, 300));
saveState({ discountApiManager: { status: discApiMgr.status, body: discApiMgr.body } });

await browser.close();
log("\nstep 3b done");
