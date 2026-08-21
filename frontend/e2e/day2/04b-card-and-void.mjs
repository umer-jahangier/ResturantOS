/* DAY 2 — 4b: a manager's 10% on a clean check (no modifiers) to pin the discount base,
 * settled by CARD; then a void attempt on a PAID check; then the printed bill. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const B = S.branchId;
const ORD2 = (S.order2 ?? [])[0] ?? "ORD-20260812-0443";
const browser = await newBrowser();

async function bill(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const g = (re) => re.exec(t)?.[1] ?? null;
    return {
      subtotal: g(/Subtotal (Rs [\d,]+\.\d\d)/), discounts: g(/Discounts (-?Rs ?[\d,]+\.\d\d)/),
      service: g(/Service charge \([\d.]+%\) (Rs [\d,]+\.\d\d)/), taxes: g(/Taxes (Rs [\d,]+\.\d\d)/),
      total: g(/Total (Rs [\d,]+\.\d\d)/), remaining: g(/Remaining balance (Rs [\d,]+\.\d\d)/),
      history: document.querySelector("[data-testid=payment-history-rows]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
      applied: document.querySelector("[data-testid=applied-discounts]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    };
  });
}

// ── find order 2's id ────────────────────────────────────────────────────────
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const list = await apiGet(mgr, `/api/v1/pos/orders?branchId=${B}&size=40`);
const rows = (list.body?.data?.content ?? list.body?.data ?? []);
const row2 = rows.find((r) => r.orderNo === ORD2);
log("  order 2 row:", JSON.stringify(row2).slice(0, 400));
const OID2 = row2?.orderId;

await go(mgr, `/app/pos/orders/${OID2}/charge`, { waitMs: 8000 });
const c0 = await bill(mgr);
log("  BILL BEFORE (no modifiers on this check):", JSON.stringify(c0));
await mgr.locator("[data-testid=add-discount-button]").click();
await mgr.waitForTimeout(1400);
await mgr.locator("[data-testid=discount-scope-order]").first().click();
await mgr.waitForTimeout(700);
await mgr.locator("[data-testid=discount-type-percent]").first().click();
await mgr.waitForTimeout(400);
await mgr.locator("[data-testid=discount-value-input]").fill("10");
await mgr.waitForTimeout(400);
await mgr.locator("[data-testid=discount-reason-input]").fill("Day 2 — discount-base probe");
await mgr.waitForTimeout(800);
const prev = await mgr.evaluate(() => document.querySelector("[data-testid=discount-preview]")?.innerText.replace(/\s+/g, " ").trim() ?? null);
log("  PREVIEW SAYS:", prev);
await shot(mgr, "04c-discount-preview-clean-check");
await mgr.locator("[data-testid=apply-discount-submit]").click({ force: true });
await mgr.waitForTimeout(5000);
const c1 = await bill(mgr);
log("  BILL AFTER  :", JSON.stringify(c1));
await shot(mgr, "04d-after-discount-clean-check");

// ── settle by CARD ───────────────────────────────────────────────────────────
const methodSel = mgr.locator("[data-testid=tender-row] select, select").first();
await methodSel.selectOption("CARD");
await mgr.waitForTimeout(1000);
const cardControls = await mgr.evaluate(() => ({
  hasTendered: !!document.querySelector("[data-testid=change-due-value]"),
  labels: Array.from(document.querySelectorAll("label")).map((l) => l.innerText.trim()).filter(Boolean).slice(0, 14),
}));
log("  card controls:", JSON.stringify(cardControls));
await mgr.locator("[data-testid=fill-full-amount-button]").click();
await mgr.waitForTimeout(700);
const refBox = mgr.getByLabel(/Ref/i).first();
if (await refBox.count()) await refBox.fill("VISA-8812");
await mgr.waitForTimeout(400);
await shot(mgr, "04e-card-filled");
await mgr.locator("[data-testid=record-payment-button]").click();
await mgr.waitForTimeout(6000);
const c2 = await bill(mgr);
log("  AFTER CARD:", JSON.stringify(c2));
await shot(mgr, "04f-card-recorded");
const pays2 = await apiGet(mgr, `/api/v1/pos/orders/${OID2}/payments?branchId=${B}`);
log("  order_payments (card):", JSON.stringify(pays2.body).slice(0, 500));

// ── 4c. void a PAID check ────────────────────────────────────────────────────
log("\n=== 4c. void attempt on a PAID check ===");
await go(mgr, "/app/pos", { waitMs: 7000 });
await mgr.getByText("Order Management", { exact: true }).first().click();
await mgr.waitForTimeout(4000);
await mgr.locator('input[placeholder*="Search" i], input[type=search]').last().fill(ORD2);
await mgr.waitForTimeout(3000);
await mgr.locator(`[aria-label^="Open order ${ORD2}"]`).first().click();
await mgr.waitForTimeout(3500);
const drawerPaid = await mgr.evaluate(() => {
  const d = document.querySelector("[role=dialog]");
  return {
    btns: Array.from((d ?? document).querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean),
    notice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    text: (d ?? document.body).innerText.replace(/\s+/g, " ").slice(0, 600),
  };
});
log("  PAID DRAWER:", JSON.stringify(drawerPaid, null, 1).slice(0, 1200));
await shot(mgr, "04g-paid-drawer");
// the direct call, on the manager's own bearer
const direct = await apiSend(mgr, "POST", `/api/v1/pos/orders/${OID2}/void?branchId=${B}`, { reason: "day 2 — void on a paid check" });
log("  DIRECT VOID ON A PAID CHECK:", direct.status, JSON.stringify(direct.body).slice(0, 400));
const pays3 = await apiGet(mgr, `/api/v1/pos/orders/${OID2}/payments?branchId=${B}`);
log("  payments after the attempt:", JSON.stringify(pays3.body).slice(0, 400));
saveState({ order2Id: OID2, cleanDiscount: { c0, prev, c1 }, card: { c2, payments: pays2.body }, paidVoid: { drawerPaid, direct: { s: direct.status, b: direct.body }, paymentsAfter: pays3.body } });
await browser.close();
