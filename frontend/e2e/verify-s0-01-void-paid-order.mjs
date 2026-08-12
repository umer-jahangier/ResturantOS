/*
 * S0-01 — "Void succeeds on a fully-paid order and the cash payment row survives".
 *
 * Drives the manager's REAL click path in Chromium, end to end, on the running stack:
 *
 *   1. sign in as manager@terrace.local (no TOTP)
 *   2. /app/pos -> ring one item -> Send to Kitchen
 *   3. Order Management -> Open the order -> CHARGE NOW -> CASH for the full amount
 *   4. back to Order Management -> Open the same order
 *      ASSERT: no usable "Void order" trigger, and a stated reason in its place
 *      ASSERT: a "Refund order" trigger IS present
 *   5. click Refund -> type a reason -> Confirm Refund
 *      ASSERT: the order reads REFUNDED
 *   6. GET /api/v1/pos/orders/{id}/payments THROUGH THE SAME BROWSER SESSION
 *      ASSERT: the original CASH row AND a reversing REFUND row
 *   7. POST /api/v1/pos/orders/{id}/void with the SAME live session on a second paid order
 *      ASSERT: 4xx, not 200
 *
 *   node e2e/verify-s0-01-void-paid-order.mjs after
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "run";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-01");
const BASE = "http://localhost:3000";

const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

mkdirSync(OUT, { recursive: true });
const results = {};
let step = 0;

/*
 * branchId is required on GET /orders/{id} and is NOT hardcoded here: it is sniffed off the
 * app's OWN requests, so this harness cannot drift from whichever branch the persona is
 * actually signed in to (a wrong id would 404 and read as a missing order).
 */
let BRANCH_ID = null;
/*
 * The manager's LIVE access token, lifted off the app's own outbound requests. The token lives
 * in JS memory (api-client injects it from `getSession()`), never in a cookie, so a raw fetch
 * without it is a 401 that would read as "the endpoint refused" for entirely the wrong reason.
 * Sniffing it is also exactly what the gap asks for: the direct-API attempt below is made with
 * the manager's real, live JWT — the same credential the button uses.
 */
let BEARER = null;
function watchSession(page) {
  page.on("request", (req) => {
    const m = req.url().match(/[?&]branchId=([0-9a-f-]{36})/i);
    if (m) BRANCH_ID = m[1];
    if (req.url().startsWith("http://localhost:8080/")) {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ")) BEARER = auth;
    }
  });
}
async function orderOverSession(page, orderId) {
  if (!BRANCH_ID) throw new Error("never observed a branchId on the app's own traffic");
  return page.evaluate(
    async ([id, branch, bearer]) => {
      const r = await fetch(`http://localhost:8080/api/v1/pos/orders/${id}?branchId=${branch}`, {
        credentials: "include",
        headers: { Authorization: bearer },
      });
      return (await r.json())?.data;
    },
    [orderId, BRANCH_ID, BEARER],
  );
}

async function shot(page, name) {
  step += 1;
  const file = `${LABEL}-${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  console.log("    shot:", file);
}

function must(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log("    ok:", message);
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

/**
 * Error states masquerade as empty states. Before believing anything about what is or is
 * not on screen, say out loud whether the page is in a failure state.
 */
async function pageHealth(page) {
  return page.evaluate(() => {
    const t = (n) => (n.textContent || "").trim();
    return {
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(t).filter(Boolean),
      couldntLoad: /Couldn.t load|SERVICE_UNAVAILABLE|Access denied/i.test(document.body.innerText),
    };
  });
}

async function openOrdersTab(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  await page.waitForTimeout(2500);
}

/** Rings one item on the terminal and fires it. Returns the order number on screen. */
async function ringAndFire(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 20000 });
  await tiles.nth(0).click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(4000);
  const orderNo = await page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d+/);
    return m ? m[0] : null;
  });
  if (!orderNo) throw new Error("no order number visible after Send to Kitchen");
  return orderNo;
}

/** Opens `orderNo` from Order Management and returns its orderId (from the Open button testid). */
async function openFromOrderManagement(page, orderNo) {
  await openOrdersTab(page);
  const health = await pageHealth(page);
  if (health.couldntLoad || health.alerts.length) {
    console.log("    retrying — order management came up in an error state:", health);
    await page.locator('[data-testid="order-management-refresh"]').click();
    await page.waitForTimeout(3000);
  }
  // Order Management pages at 20 rows and this tenant already has dozens of orders today, so
  // "the row is not on screen" is a paging fact, not a missing order. Search for it by number —
  // which is what a manager holding a printed bill would do anyway.
  const search = page.locator('[data-testid="order-management-search"]');
  if (await search.count()) {
    await search.first().fill(orderNo);
    await page.waitForTimeout(2500);
  }
  const row = page.locator(`tr:has-text("${orderNo}")`).first();
  await row.waitFor({ timeout: 20000 });
  const openBtn = row.locator('[data-testid^="open-order-"]');
  const orderId = (await openBtn.getAttribute("data-testid")).replace("open-order-", "");
  await openBtn.click();
  await page.waitForTimeout(2500);
  return orderId;
}

/** Everything the void/refund surface is currently offering the operator. */
async function settlementProbe(page) {
  return page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const voidBtn = q('[aria-label="Void order"]');
    const refundBtn = q('[aria-label="Refund order"]');
    const notice = q('[data-testid="void-blocked-paid-notice"]');
    return {
      voidTriggerPresent: !!voidBtn,
      refundTriggerPresent: !!refundBtn,
      refundTriggerEnabled: refundBtn ? !refundBtn.disabled : false,
      paidNotice: notice ? notice.textContent.trim() : null,
      paidChip: !!q('[data-testid="paid-chip"]'),
      bodyMentionsRefunded: /REFUNDED/.test(document.body.innerText),
    };
  });
}

/** Charges the currently-open order in full with CASH via the dedicated Charge page. */
async function chargeCashInFull(page, orderId) {
  await page.goto(`${BASE}/app/pos/orders/${orderId}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const health = await pageHealth(page);
  if (health.couldntLoad) throw new Error(`charge page in error state: ${JSON.stringify(health)}`);

  // S1-05: the tender box asks for RUPEES now — "Amount in paisa" no longer exists anywhere.
  const amountField = page.locator('input[aria-label="Amount (Rs)"]').first();
  await amountField.waitFor({ timeout: 15000 });
  // Leave the amount as the page pre-fills it (the outstanding balance) if it already has one;
  // otherwise read the order total off the API and type it, in rupees.
  const prefilled = await amountField.inputValue();
  if (!prefilled || Number(prefilled) <= 0) {
    const order = await orderOverSession(page, orderId);
    const paisa = order.totalPaisa;
    await amountField.fill(`${Math.floor(paisa / 100)}.${String(paisa % 100).padStart(2, "0")}`);
  }
  await page.locator('[data-testid="record-payment-button"], button:has-text("Record Payment")')
    .first()
    .click();
  await page.waitForTimeout(4000);
}

/** Reads the payments history for `orderId` over the SAME authenticated browser session. */
async function paymentsOverSession(page, orderId) {
  return page.evaluate(
    async ([id, bearer]) => {
      const r = await fetch(`http://localhost:8080/api/v1/pos/orders/${id}/payments`, {
        credentials: "include",
        headers: { Authorization: bearer },
      });
      return { status: r.status, body: await r.json() };
    },
    [orderId, BEARER],
  );
}

/** Attempts the void over the SAME authenticated browser session (the manager's live JWT). */
async function voidOverSession(page, orderId) {
  return page.evaluate(
    async ([id, bearer]) => {
      const r = await fetch(`http://localhost:8080/api/v1/pos/orders/${id}/void`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          Authorization: bearer,
        },
        body: JSON.stringify({ reason: "S0-01 direct API attempt" }),
      });
      return { status: r.status, body: await r.text() };
    },
    [orderId, BEARER],
  );
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! page error:", String(e).slice(0, 160)));
  watchSession(page);

  await login(page, MANAGER);
  console.log("  signed in as", MANAGER.email);

  // ── 1. ring + fire ──────────────────────────────────────────────────────────
  console.log("\n[1] ring one item and Send to Kitchen");
  const orderNo = await ringAndFire(page);
  console.log("    order:", orderNo);
  await shot(page, "sent-to-kitchen");

  // ── 2. open from Order Management and charge CASH in full ───────────────────
  console.log("\n[2] Order Management -> Open -> CHARGE NOW -> CASH in full");
  const orderId = await openFromOrderManagement(page, orderNo);
  console.log("    orderId:", orderId);
  await shot(page, "order-drawer-before-charge");
  await chargeCashInFull(page, orderId);
  await shot(page, "charge-page-after-cash");

  const afterPay = await paymentsOverSession(page, orderId);
  results.paymentsAfterCharge = afterPay.body?.data;
  must(
    Array.isArray(afterPay.body?.data) && afterPay.body.data.length === 1,
    `one CASH tender recorded (${JSON.stringify(afterPay.body?.data)})`,
  );
  const orderAfterPay = await orderOverSession(page, orderId);
  results.statusAfterCharge = orderAfterPay.status;
  console.log("    order status after full CASH:", orderAfterPay.status);

  // ── 3. reopen from Order Management: what does the manager see? ─────────────
  console.log("\n[3] reopen the PAID order from Order Management");
  await openFromOrderManagement(page, orderNo);
  await page.waitForTimeout(2000);
  results.settlementOnPaidOrder = await settlementProbe(page);
  await shot(page, "paid-order-void-blocked");
  console.log("   ", JSON.stringify(results.settlementOnPaidOrder));

  must(
    results.settlementOnPaidOrder.voidTriggerPresent === false,
    "the Void trigger is ABSENT on a paid order",
  );
  must(
    !!results.settlementOnPaidOrder.paidNotice,
    `a stated reason replaces it: "${results.settlementOnPaidOrder.paidNotice}"`,
  );
  must(
    results.settlementOnPaidOrder.refundTriggerPresent === true,
    "the Refund trigger IS present on this non-CLOSED paid order",
  );

  // ── 4. refund it from the UI ────────────────────────────────────────────────
  console.log("\n[4] click Refund, type a reason, Confirm Refund");
  await page.locator('[aria-label="Refund order"]').first().click();
  await page.waitForTimeout(800);
  await shot(page, "refund-panel-open");
  await page.locator('textarea[placeholder*="Wrong item served"]').first().fill(
    "S0-01 proof — guest left, cash returned",
  );
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Confirm Refund")').first().click();
  await page.waitForTimeout(5000);
  await shot(page, "after-confirm-refund");

  const orderAfterRefund = await orderOverSession(page, orderId);
  results.statusAfterRefund = orderAfterRefund.status;
  must(orderAfterRefund.status === "REFUNDED", `order status is REFUNDED (${orderAfterRefund.status})`);

  const afterRefund = await paymentsOverSession(page, orderId);
  results.paymentsAfterRefund = afterRefund.body?.data;
  const rows = afterRefund.body?.data ?? [];
  const tender = rows.filter((r) => r.kind !== "REFUND");
  const reversal = rows.filter((r) => r.kind === "REFUND");
  must(tender.length === 1, "the ORIGINAL payment row is still there");
  must(reversal.length === 1, "a REVERSING refund row now sits beside it");
  must(
    reversal[0].amountPaisa === -tender[0].amountPaisa,
    `the reversal is the exact negative of the tender (${tender[0].amountPaisa} / ${reversal[0].amountPaisa})`,
  );
  must(
    rows.reduce((a, r) => a + r.amountPaisa, 0) === 0,
    "net money held against the order is zero to the paisa",
  );

  // The refunded order, as Order Management renders it.
  await openOrdersTab(page);
  await page.locator('[data-testid="status-filter-REFUNDED"]').click().catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, "order-management-refunded");

  // ── 5. the direct API attempt, on the manager's live session ────────────────
  console.log("\n[5] POST .../void directly, with the manager's live browser session");
  const orderNo2 = await ringAndFire(page);
  const orderId2 = await openFromOrderManagement(page, orderNo2);
  await chargeCashInFull(page, orderId2);
  const directVoid = await voidOverSession(page, orderId2);
  results.directVoid = directVoid;
  console.log("    HTTP", directVoid.status, directVoid.body.slice(0, 240));
  must(directVoid.status >= 400 && directVoid.status < 500, `the void is refused 4xx (got ${directVoid.status})`);

  const afterDirect = await paymentsOverSession(page, orderId2);
  must(
    (afterDirect.body?.data ?? []).length === 1,
    "and the payment on that order is untouched — still exactly one live tender",
  );
  const order2 = await orderOverSession(page, orderId2);
  must(order2.status !== "VOIDED", `and the order was NOT voided (${order2.status})`);
  results.directVoidOrderStatus = order2.status;

  results.orderNo = orderNo;
  results.orderId = orderId;
  results.orderNo2 = orderNo2;
  results.orderId2 = orderId2;
  writeFileSync(`${OUT}/${LABEL}-results.json`, JSON.stringify(results, null, 2));
  console.log("\nALL ASSERTIONS PASSED — results written to", `${OUT}/${LABEL}-results.json`);

  await browser.close();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  writeFileSync(`${OUT}/${LABEL}-results.json`, JSON.stringify({ error: e.message, ...results }, null, 2));
  process.exit(1);
});
