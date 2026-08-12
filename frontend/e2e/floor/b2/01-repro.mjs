/*
 * B2 STEP 1 — REPRODUCE, before touching anything.
 *
 * The cashier rings a dine-in check, fires it to the kitchen, then opens it in Order
 * Management and presses Void. Records what the panel says and what the network answered.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, apiSend, tokenOf,
  ringAndFire, openInOrderManagement, orderRow, log,
} from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);

const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const perms = claims.permissions ?? [];
log("  cashier sub:", claims.sub);
log("  branch:", claims.branch_id ?? claims.branchId);
log("  permission count:", perms.length);
log("  void-ish:", JSON.stringify(perms.filter((p) => /void/.test(p))));
saveState({ cashierSub: claims.sub, cashierBranch: claims.branch_id ?? claims.branchId, cashierPerms: perms });

// Every active table in F-7 is OCCUPIED (the 133 stranded checks hold all six), so the repro
// rings TAKEAWAY. The defect under test is about STATUS, not order type — the dine-in path is
// driven in full once the drawer is cleared.
log("\n=== ring a check and fire it ===");
const fired = await ringAndFire(cash, { type: "takeaway", tiles: 2, label: "01a" });
saveState({ reproOrderNo: fired.orderNo, reproOrderId: fired.orderId });
if (!fired.orderId) { await browser.close(); throw new Error("could not ring an order"); }

const readBack = await orderRow(cash, fired.orderNo, tok);
log("  server row after fire:", JSON.stringify(readBack));

log("\n=== open it in Order Management and press Void ===");
const id = await openInOrderManagement(cash, fired.orderNo);
log("  drawer opened for:", id);
await shot(cash, "01b-order-drawer");

const drawer = await cash.evaluate(() => {
  const d = document.querySelector("[data-testid=order-table-detail-drawer]");
  return d ? {
    buttons: Array.from(d.querySelectorAll("button"))
      .map((b) => (b.getAttribute("aria-label") || b.textContent).trim()).filter(Boolean),
    text: d.innerText.replace(/\s+/g, " ").slice(0, 500),
  } : null;
});
log("  drawer buttons:", JSON.stringify(drawer?.buttons));

const trigger = cash.getByLabel("Void order");
log("  'Void order' trigger count:", await trigger.count());
if (await trigger.count()) {
  await trigger.first().click();
  await cash.waitForTimeout(1600);
  await shot(cash, "01c-void-panel");
  const ta = cash.locator("[data-testid=void-refund-panel] textarea");
  if (await ta.count()) await ta.first().fill("Guest walked out before the food went out — B2 repro");
  await cash.waitForTimeout(400);
  cash.__requests.length = 0;
  await cash.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void/i }).last().click();
  await cash.waitForTimeout(6000);
  await shot(cash, "01d-after-confirm-void");
  const after = await cash.evaluate(() => ({
    err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    panelStillOpen: !!document.querySelector("[data-testid=void-refund-panel]"),
  }));
  log("  panel after Confirm Void:", JSON.stringify(after, null, 1));
  log("  network during confirm:", JSON.stringify(cash.__requests.filter((r) => /void/.test(r.u))));
  saveState({ reproPanelAfter: after, reproNet: cash.__requests.filter((r) => /void/.test(r.u)) });
}

// direct call with the same live bearer, for the exact body
const direct = await apiSend(cash, "POST", `/api/v1/pos/orders/${fired.orderId}/void`,
  { reason: "B2 repro — cashier voiding own fired unpaid check" }, tok);
log("\n  POST /void direct →", direct.status, JSON.stringify(direct.body));
saveState({ reproDirect: direct });

const final = await orderRow(cash, fired.orderNo, tok);
log("  order row now:", JSON.stringify(final));
saveState({ reproFinalStatus: final?.settlementStatus ?? null });

await browser.close();
log("\nB2 step 1 done");
