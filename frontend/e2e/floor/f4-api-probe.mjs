/* F4 — probe the extended audit read API on the OWNER's own bearer, through the gateway. */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log } from "../shift/lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);
await go(page, "/app/dashboard", { waitMs: 4000 });
const tok = await tokenOf(page);

for (const q of [
  "/api/v1/audit/events?size=5",
  "/api/v1/audit/events?resourceType=ORDER&size=40",
  "/api/v1/audit/events?action=ORDER_VOIDED&resourceType=ORDER&size=5",
  "/api/v1/audit/events?action=ORDER_VOIDED&resourceType=USER&size=5",
  "/api/v1/audit/events?size=5&page=3",
  "/api/v1/audit/facets",
  "/api/v1/audit/events?from=2026-08-12&to=2026-08-12&zone=Asia/Karachi&size=5",
  "/api/v1/audit/events?zone=Mars/Olympus_Mons&size=5",
]) {
  const r = await apiGet(page, q, tok);
  const rows = Array.isArray(r.body?.data) ? r.body.data : null;
  const kinds = {};
  for (const e of rows ?? []) kinds[e.resourceType] = (kinds[e.resourceType] ?? 0) + 1;
  log(`\n  ${q}\n    → ${r.status} rows=${rows ? rows.length : "n/a"} meta=${JSON.stringify(r.body?.meta)}`);
  if (rows) log("    resourceTypes:", JSON.stringify(kinds));
  if (rows?.[0]) log("    first:", JSON.stringify({ a: rows[0].action, rt: rows[0].resourceType, u: rows[0].userId, n: rows[0].userName, at: rows[0].occurredAt }));
  if (!rows) log("    body:", JSON.stringify(r.body).slice(0, 400));
}

await browser.close();
log("\nprobe done");
