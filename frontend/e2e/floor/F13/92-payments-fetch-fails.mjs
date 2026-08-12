/*
 * F13 RE-OPEN, part 3 — what the cashier reads when the PAYMENTS fetch fails.
 *
 * The component decides everything from `useOrderPayments`, and reads it as
 * `const { data: payments = [] }`. A failed query and an unpaid check are therefore the SAME
 * VALUE to this component — the exact "an error state looks like an empty state" trap. If a 503
 * on the payments call turns a paid check back into a voidable one, the cashier is offered Void
 * on money, and the 409 that follows says "use Refund" with no Refund button on screen.
 *
 * Driven on a check that IS fully paid, with only GET .../payments failed at the network layer.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, log, drawerProbe, openInOrderManagement } from "./lib.mjs";
import { readFileSync } from "node:fs";

const st = JSON.parse(readFileSync(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F13/_reopen.json", "utf8"));
const PAID = st.notes.cashierPartial.orderNo; // part paid, still SENT_TO_KDS → voidableStatus true

const browser = await newBrowser();
const page = await newPage(browser);
for (let a = 1; a <= 4; a++) {
  try { await login(page, PEOPLE.cashier); break; }
  catch (e) { log(`  login attempt ${a}: ${e.message.slice(0, 90)}`); await page.waitForTimeout(6000); if (a === 4) throw e; }
}

log("\n=== the cashier's drawer on", PAID, "with GET payments failing 503 ===");
// Find the row FIRST, with the network untouched — then fail ONLY the payments read and
// re-open the drawer, so the order list itself is never in the blast radius.
const id = await openInOrderManagement(page, PAID);
log("  order id:", id);
await page.route((url) => url.pathname.endsWith("/payments"), (route) =>
  route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ title: "SERVICE_UNAVAILABLE" }) }));
// Close and re-open the same drawer so the payments query refires under the failure.
await page.keyboard.press("Escape");
await page.waitForTimeout(1500);
await page.locator(`[data-testid="open-order-${id}"]`).click();
await page.waitForTimeout(6000);
await shot(page, "92a-cashier-payments-503");
const probe = await drawerProbe(page);
log("  notice :", JSON.stringify(probe.notice));
log("  Void   :", probe.voidTrigger);
log("  Refund :", probe.refundTrigger);
log("  buttons:", JSON.stringify(probe.buttons));

if (probe.voidTrigger) {
  log("\n  → Void IS offered on a paid check. Pressing it, as a cashier would.");
  await page.locator('[aria-label="Void order"]').click();
  await page.waitForTimeout(1200);
  await page.locator("[data-testid=void-refund-panel] textarea").first().fill("customer walked out");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Confirm Void/i }).click();
  await page.waitForTimeout(6000);
  await shot(page, "92b-void-attempt-result");
  const after = await page.evaluate(() => ({
    err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
    refund: !!document.querySelector('[aria-label="Refund order"]'),
    panel: !!document.querySelector("[data-testid=void-refund-panel]"),
  }));
  log("  void error copy:", JSON.stringify(after.err));
  log("  Refund control anywhere on this screen:", after.refund);
}

await browser.close();
