/* F2 — how many tables does F-7 have, and how many are free right now? */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log } from "./f2-lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.manager);
  await go(page, "/app/pos", { waitMs: 7000, allowTrouble: true });
  const token = await tokenOf(page);
  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = new URL(listReq.u).searchParams.get("branchId");
  log("branchId", branchId);
  const t = await apiGet(page, `/api/v1/pos/tables?branchId=${branchId}&size=200`, token);
  const tables = t.body?.data ?? [];
  log("status", t.status, "tables", tables.length);
  const byStatus = {};
  for (const x of tables) (byStatus[x.status] ??= []).push(x.tableName);
  log(JSON.stringify(byStatus, null, 2));
} finally {
  await page.context().close();
  await browser.close();
}
