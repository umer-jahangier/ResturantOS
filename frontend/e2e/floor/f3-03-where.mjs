/* Where did ORD-...-0178 go, and did it fire at all? */
import { newBrowser, newPage, login, PEOPLE } from "../shift/lib.mjs";
import { go, apiGet } from "./f3-lib.mjs";

const browser = await newBrowser();
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
await go(kds, "/app/kitchen", { waitMs: 3500 });
const branchId = new URL(
  kds.__requests.find((r) => r.u.includes("/kitchen/kds/tickets")).u,
).searchParams.get("branchId");

const r = await apiGet(
  kds,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=2000`,
);
const all = r.body?.content ?? [];
const target = process.argv[2] ?? "ORD-20260812-0178";
const mine = all.filter((t) => t.orderNo === target);
console.log(`tickets for ${target}:`, JSON.stringify(mine.map((t) => ({
  id: t.id.slice(0, 8), station: t.stationCode, status: t.status,
  items: t.items.map((i) => `${i.name}=${i.status}`),
})), null, 1));

const recent = [...all].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 6);
console.log("\n6 newest tickets on this branch:");
for (const t of recent) {
  console.log(` ${t.receivedAt}  ${t.orderNo}  ${t.stationCode}  ${t.items.map((i) => `${i.name}=${i.status}`).join(", ")}`);
}

const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const o = await apiGet(cash, "/api/v1/pos/orders?size=4");
const rows = o.body?.data ?? o.body ?? [];
console.log("\n4 newest POS orders:");
for (const x of (Array.isArray(rows) ? rows : [])) {
  console.log(` ${x.orderNo}  ${x.status}  type=${x.orderType}  lines=${(x.items ?? []).length}`,
    (x.items ?? []).map((i) => `${i.itemName ?? i.name}×${i.qty ?? i.quantity}`).join(", "));
}
await browser.close();
