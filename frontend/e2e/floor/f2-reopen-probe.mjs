/* Server-truth probe: what the order list route actually answers, per status, on the LIVE jar. */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log } from "./f2-lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.manager);
await go(page, "/app/pos", { waitMs: 8000, allowTrouble: true });
const req = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
const branchId = req ? new URL(req.u).searchParams.get("branchId") : null;
log("branchId:", branchId);
const bearer = await tokenOf(page);

for (const st of ["", "DRAFT", "OPEN", "SENT_TO_KDS", "CLOSED", "VOIDED", "REFUNDED"]) {
  const q = `/api/v1/pos/orders?branchId=${branchId}&size=5${st ? `&status=${st}` : ""}`;
  const r = await apiGet(page, q, bearer);
  const rows = r.body?.data ?? [];
  log(
    `\n${st || "(default)"} → ${r.status}, ${rows.length} rows, total=${r.body?.meta?.totalCount ?? "?"}`,
  );
  for (const o of rows.slice(0, 3)) {
    log(
      `   ${o.orderNo} type=${o.type} table=${o.tableName ?? "-"} cashierName=${JSON.stringify(o.cashierName)} cashierId=${(o.cashierId ?? "").slice(0, 8)} settlement=${o.settlementStatus} qty=${o.itemQuantity}/${o.distinctItemCount} byName=${JSON.stringify(o.settlement?.byName ?? null)}`,
    );
  }
  if (rows.length) {
    const missingType = rows.filter((o) => !o.type).length;
    const missingName = rows.filter((o) => !o.cashierName && o.cashierId).length;
    log(`   → rows with NO type: ${missingType}; rows with an id but NO resolved name: ${missingName}`);
  }
}

await browser.close();
