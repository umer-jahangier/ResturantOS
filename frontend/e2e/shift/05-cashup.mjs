/*
 * SHIFT STEP 5 — CASH UP.
 *
 * The cashier clears the drawer the way the close screen demands: close the two settled
 * checks, void the two parked drafts. Then close the till, count the cash, read the
 * variance. Every step through the screen, never the API.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, tokenOf, log, BASE, money } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

async function signIn(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password ?? who.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  log("  ✓", who.email);
}

const cash = await newPage(browser);
await signIn(cash, NEW);
await go(cash, "/app/pos", { waitMs: 6000 });
const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const bid = claims.branch_id ?? claims.branchId;

const listMine = async () => {
  const l = await apiGet(cash, `/api/v1/pos/orders?branchId=${bid}&size=80`, tok);
  return (l.body?.data ?? []).filter((o) => o.cashierId === claims.sub);
};
let mine = await listMine();
log("  my checks at the end of service:");
for (const o of mine) log(`    ${o.orderNo}  ${o.settlementStatus}/${o.derivedStatus}  ${o.paymentStatus}  ${money(o.totalPaisa)}  paid ${money(o.amountPaidPaisa)}`);
saveState({ myChecksAtClose: mine.map((o) => ({ id: o.orderId, no: o.orderNo, s: o.settlementStatus, d: o.derivedStatus, p: o.paymentStatus, total: o.totalPaisa, paid: o.amountPaidPaisa })) });

// ── close the two paid checks ─────────────────────────────────────────────────
for (const o of mine.filter((x) => x.paymentStatus === "PAID" && x.settlementStatus !== "CLOSED")) {
  log(`\n  closing ${o.orderNo}`);
  await go(cash, `/app/pos/orders/${o.orderId}/charge`, { waitMs: 6000 });
  const btn = cash.locator("[data-testid=close-order-button]");
  const state = await cash.evaluate(() => {
    const b = document.querySelector("[data-testid=close-order-button]");
    return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
  });
  log("    close control:", JSON.stringify(state));
  if (state && !state.disabled) {
    await btn.click();
    await cash.waitForTimeout(6000);
    const err = await cash.evaluate(() => document.querySelector("[data-testid=close-order-error]")?.textContent?.trim() ?? null);
    const chip = await cash.evaluate(() => document.querySelector("[data-testid=charge-closed-chip]")?.textContent?.trim() ?? null);
    log("    after close — err:", err, "chip:", chip);
    await shot(cash, `05a-closed-${o.orderNo}`);
  } else {
    await shot(cash, `05a-cannot-close-${o.orderNo}`);
    finding({ id: "SHIFT-CLOSE", sev: "S1", what: `close control unusable on ${o.orderNo}`, evidence: state });
  }
}

// ── void the parked drafts through the screen ─────────────────────────────────
mine = await listMine();
const parked = mine.filter((o) => o.settlementStatus !== "CLOSED" && o.settlementStatus !== "VOIDED" && o.paymentStatus === "UNPAID");
log("\n  parked checks still on the drawer:", JSON.stringify(parked.map((o) => `${o.orderNo}:${o.settlementStatus}/${o.derivedStatus}`)));
for (const o of parked) {
  log(`  voiding ${o.orderNo} (${o.settlementStatus})`);
  await go(cash, "/app/pos", { waitMs: 6500 });
  await cash.getByText("Order Management", { exact: true }).click();
  await cash.waitForTimeout(3500);
  await cash.locator("[data-testid=order-management-search]").first().fill(o.orderNo);
  await cash.waitForTimeout(3500);
  const openBtn = cash.locator(`[data-testid="open-order-${o.orderId}"]`);
  if (!(await openBtn.count())) {
    log("    ! row not openable");
    continue;
  }
  await openBtn.click();
  await cash.waitForTimeout(3000);
  const v = cash.getByLabel("Void order");
  log("    Void trigger:", await v.count());
  if (await v.count()) {
    await v.first().click();
    await cash.waitForTimeout(1500);
    const ta = cash.locator("[data-testid=void-refund-panel] textarea");
    if (await ta.count()) await ta.first().fill("End of shift — parked check never taken");
    await cash.waitForTimeout(300);
    await cash.locator("[data-testid=void-refund-panel] button").filter({ hasText: /Confirm Void/i }).click();
    await cash.waitForTimeout(5000);
    const err = await cash.evaluate(() => document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null);
    log("    void error:", err);
    await shot(cash, `05b-void-${o.orderNo}`);
  }
}

// ── close the till ────────────────────────────────────────────────────────────
log("\n=== the cashier closes the drawer ===");
mine = await listMine();
log("  final state of my checks:");
for (const o of mine) log(`    ${o.orderNo}  ${o.settlementStatus}/${o.derivedStatus}  ${o.paymentStatus}`);
saveState({ myChecksFinal: mine.map((o) => ({ no: o.orderNo, s: o.settlementStatus, d: o.derivedStatus, p: o.paymentStatus, total: o.totalPaisa, paid: o.amountPaidPaisa })) });

await go(cash, "/app/pos", { waitMs: 6500 });
const strip = await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  return b ? b.parentElement.innerText.replace(/\s+/g, " ").trim() : null;
});
log("  till strip before close:", strip);
await shot(cash, "05c-till-strip-before-close");
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(1500);
const panel = await cash.evaluate(() => {
  const p = document.querySelector("[data-testid=close-till-panel]");
  return p ? { text: p.innerText.replace(/\s+/g, " ").trim(), hasExpected: /Expected cash/.test(p.innerText) } : null;
});
log("  close panel:", JSON.stringify(panel, null, 1));
await shot(cash, "05d-close-till-panel");
saveState({ closeTillPanel: panel });

// Count the drawer honestly: float 5000 + the one cash tender 1682.60 = 6682.60.
await cash.locator("[data-testid=close-till-panel] input[type=number]").first().fill("6682.60");
await cash.waitForTimeout(900);
const variancePreview = await cash.evaluate(() => {
  const p = document.querySelector("[data-testid=close-till-panel]");
  return p ? /Variance:?\s*(Rs [\d,]+\.\d\d)/.exec(p.innerText)?.[0] ?? null : null;
});
log("  variance preview while typing:", variancePreview);
await shot(cash, "05e-declared-count");
await cash.locator("[data-testid=close-till-panel] textarea").fill("Shift walkthrough — counted drawer").catch(() => {});
await cash.locator("[data-testid=close-till-confirm-button]").click();
await cash.waitForTimeout(6000);
const closeErr = await cash.evaluate(() => document.querySelector("[data-testid=close-till-error]")?.textContent?.trim() ?? null);
log("  close error:", closeErr);
await shot(cash, "05f-after-close-till");
const afterStrip = await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
log("  screen after close:", afterStrip);
saveState({ tillCloseError: closeErr, afterCloseScreen: afterStrip });

await browser.close();
log("\nstep 5 (cashier) done");
