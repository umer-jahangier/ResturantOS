/*
 * F2 step 2 — the server's own answer for the rows the screen just mislabelled.
 *
 * branchId is taken from the page's OWN outgoing request, not guessed: whatever the app asked
 * for is by definition the branch the manager is looking at.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  openOrderManagement,
  apiGet,
  tokenOf,
  saveState,
  log,
} from "./f2-lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.manager);
  await openOrderManagement(page);

  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  log("  the page's own list request:", listReq?.u);
  const branchId = new URL(listReq.u).searchParams.get("branchId");
  log("  branchId:", branchId);

  const token = await tokenOf(page);
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&page=0&size=10`, token);
  log("  list status:", list.status);
  const rows = list.body?.data ?? [];
  log("  OrderSummaryDto keys:", JSON.stringify(Object.keys(rows[0] ?? {})));

  let wrong = 0;
  for (const r of rows) {
    const d = await apiGet(page, `/api/v1/pos/orders/${r.orderId}?branchId=${branchId}`, token);
    const type = d.body?.data?.type ?? "(unreadable)";
    const screenSays = r.tableName ?? "Takeaway";
    const bad = type === "DINE_IN" && screenSays === "Takeaway";
    if (bad) wrong++;
    log(
      `    ${r.orderNo}  screen="${screenSays}"  server.type=${type}  tableId=${r.tableId ?? "null"}${bad ? "   ← WRONG" : ""}`,
    );
  }
  log(`  mislabelled: ${wrong}/${rows.length}`);

  // The Voided list, where the walkthrough saw thirteen consecutive "Takeaway" rows and a name
  // printed one column over from a hex fragment.
  const voided = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branchId}&status=VOIDED&page=0&size=10`,
    token,
  );
  log("  voided status:", voided.status);
  for (const r of voided.body?.data ?? []) {
    log(
      `    ${r.orderNo}  cashierId=${r.cashierId}  settlement.byUserId=${r.settlement?.byUserId} byName=${JSON.stringify(r.settlement?.byName)}  reason=${JSON.stringify((r.settlement?.reason ?? "").slice(0, 70))}`,
    );
  }

  saveState({ branchId });
} finally {
  await page.context().close();
  await browser.close();
}
