/*
 * F2 step 1 — REPRODUCE, before touching a line of code.
 *
 * As manager@terrace.local, open POS → Order Management and read the table the way a manager
 * reads it. Then cross-read the SAME orders over HTTP on the manager's own bearer, so the
 * screen's claim and the server's fact sit side by side.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  openOrderManagement,
  shot,
  readOrderTable,
  apiGet,
  tokenOf,
  saveState,
  log,
} from "./f2-lib.mjs";

const HEX8 = /^[0-9a-f]{8}$/i;

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.manager);
  const trouble = await openOrderManagement(page);
  log("  page state:", JSON.stringify(trouble));
  await shot(page, "01-active-list");

  const token = await tokenOf(page);
  const me = await apiGet(page, "/api/v1/auth/me", token);
  const branchId = me.body?.data?.branchId ?? me.body?.data?.user?.branchId ?? null;
  log("  branchId:", branchId);

  const table = await readOrderTable(page);
  log("  headers:", JSON.stringify(table.headers));

  const cashierIdx = table.headers.findIndex((h) => /Server\/Cashier/i.test(h));
  const orderIdx = table.headers.findIndex((h) => /Order/i.test(h));

  const screenRows = table.rows.slice(0, 12).map((r) => ({
    orderCell: r.cells[orderIdx]?.text.replace(/\n/g, " | "),
    cashierCell: r.cells[cashierIdx]?.text,
  }));
  log("  first rows as a manager sees them:");
  for (const r of screenRows) log(`    ${r.orderCell}   →  Server/Cashier: "${r.cashierCell}"`);

  const hexCount = screenRows.filter((r) => HEX8.test(r.cashierCell ?? "")).length;
  log(`  rows whose Server/Cashier is an 8-char hex fragment: ${hexCount}/${screenRows.length}`);

  // Now the server's own answer for the same page.
  const list = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branchId}&page=0&size=12`,
    token,
  );
  log("  list status:", list.status);
  const rows = list.body?.data ?? [];
  log("  DTO keys:", JSON.stringify(Object.keys(rows[0] ?? {})));

  // Per-order detail carries `type`; the summary does not. That difference is the defect.
  const detail = [];
  for (const r of rows.slice(0, 8)) {
    const d = await apiGet(
      page,
      `/api/v1/pos/orders/${r.orderId}?branchId=${branchId}`,
      token,
    );
    detail.push({
      orderNo: r.orderNo,
      tableName: r.tableName,
      screenSays: r.tableName ?? "Takeaway",
      serverType: d.body?.data?.type ?? "(unreadable)",
      cashierId: r.cashierId,
      settlementStatus: r.settlementStatus,
    });
  }
  log("  screen label vs the server's order type:");
  for (const d of detail) {
    const wrong = d.serverType === "DINE_IN" && d.screenSays === "Takeaway";
    log(
      `    ${d.orderNo}  screen="${d.screenSays}"  server.type=${d.serverType}  ${wrong ? "  ← WRONG" : ""}`,
    );
  }

  saveState({ branchId, repro: { screenRows, detail, headers: table.headers } });
} finally {
  await page.context().close();
  await browser.close();
}
