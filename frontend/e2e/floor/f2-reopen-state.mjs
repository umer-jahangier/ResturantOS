/* What state are my three rung checks in right now, and did the first void land? */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log } from "./f2-lib.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F2");
const rung = JSON.parse(readFileSync(`${OUT}/_reopen-rung.json`, "utf8"));

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.manager);
await go(page, "/app/pos", { waitMs: 8000, allowTrouble: true });
const req = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
const branchId = req ? new URL(req.u).searchParams.get("branchId") : null;
const bearer = await tokenOf(page);

const all = {};
for (const st of ["", "VOIDED", "CLOSED", "REFUNDED"]) {
  const r = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branchId}&size=60${st ? `&status=${st}` : ""}`,
    bearer,
  );
  for (const o of r.body?.data ?? []) all[o.orderId] = o;
}

for (const [label, o] of Object.entries(rung)) {
  const live = all[o.orderId];
  log(
    `${label} ${o.orderNo}: ${live ? `settlement=${live.settlementStatus} type=${live.type} table=${live.tableName ?? "-"} cashierName=${JSON.stringify(live.cashierName)} reasonLen=${live.settlement?.reason?.length ?? null} byName=${JSON.stringify(live.settlement?.byName ?? null)}` : "NOT FOUND in the first 60 of any list"}`,
  );
}
await browser.close();
