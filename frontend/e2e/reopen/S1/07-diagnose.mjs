/* S1 re-open, step 7: nail the mismatch. What does routing SAY, and what did the kitchen GET,
 * for the same menu item ids on the same order. */
import { PEOPLE, newBrowser, newPage, login, apiGet, log, writeJson, loadState } from "./lib.mjs";

const st = loadState();
const BRANCH = st.branchId;
const ORDER_NO = process.env.ORDER_NO || "ORD-20260812-0345";

const browser = await newBrowser();
const out = {};
try {
  // --- what routing SAYS ---
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  const r = await apiGet(owner, `/api/v1/pos/menu/routing?branchId=${BRANCH}`);
  const rr = r.body?.data ?? r.body;
  const want = ["Pinacolada", "Chicken Karahi", "Mutton Biryani", "Chicken Samosa"];
  out.routingSays = (rr?.items ?? [])
    .filter((i) => want.includes(i.itemName))
    .map((i) => ({
      id: i.itemId, name: i.itemName, cat: i.categoryName,
      own: i.stationId, eff: i.effectiveStationCode, src: i.source,
    }));
  log("  ROUTING SAYS:");
  for (const i of out.routingSays) log(`    ${i.name.padEnd(16)} cat=${String(i.cat).padEnd(10)} eff=${i.eff} src=${i.src} ownRoute=${i.own ? "yes" : "no"}`);

  // --- what the TILL menu says (the payload the cart is built from) ---
  const menu = await apiGet(owner, `/api/v1/pos/menu/items?branchId=${BRANCH}&size=200`);
  const mb = menu.body?.data?.content ?? menu.body?.data ?? menu.body?.content ?? [];
  out.menuSays = (Array.isArray(mb) ? mb : [])
    .filter((i) => want.includes(i.name))
    .map((i) => ({ id: i.id, name: i.name, station: i.effectiveStationCode ?? i.stationCode ?? null }));
  log(`  TILL MENU (${menu.status}) SAYS: ${JSON.stringify(out.menuSays)}`);
  await owner.close();

  // --- what the KITCHEN received ---
  const kds = await newPage(browser);
  await login(kds, PEOPLE.kitchen);
  const tickets = await apiGet(
    kds,
    `/api/v1/kitchen/kds/tickets?branchId=${BRANCH}&status=PENDING,COOKING,READY&size=200`,
  );
  const tb = tickets.body?.content ?? tickets.body?.data?.content ?? tickets.body?.data ?? [];
  const mineTickets = (Array.isArray(tb) ? tb : []).filter((t) => t.orderNo === ORDER_NO || t.orderNumber === ORDER_NO);
  out.kitchenGot = mineTickets.map((t) => ({
    ticketId: t.id, station: t.stationCode ?? t.station, status: t.status,
    items: (t.items ?? []).map((i) => ({ name: i.itemName ?? i.name, qty: i.quantity ?? i.qty, menuItemId: i.menuItemId })),
  }));
  log(`  KITCHEN (${tickets.status}) tickets for ${ORDER_NO}: ${mineTickets.length}`);
  for (const t of out.kitchenGot) log(`    station=${String(t.station).padEnd(9)} ${JSON.stringify(t.items)}`);
  await kds.close();

  // --- the verdict, item by item ---
  out.verdict = [];
  for (const item of out.routingSays) {
    const landed = out.kitchenGot.find((t) => t.items.some((i) => i.name === item.name));
    const row = {
      item: item.name,
      routingSaysFiresTo: item.eff ?? "DEFAULT",
      routeSource: item.src,
      actuallyLandedOn: landed?.station ?? "(nowhere)",
      agrees: (landed?.station ?? "DEFAULT") === (item.eff ?? "DEFAULT"),
    };
    out.verdict.push(row);
    log(`  ${row.agrees ? "OK  " : "MISMATCH"}  ${row.item.padEnd(16)} screen says ${String(row.routingSaysFiresTo).padEnd(8)} (${row.routeSource}) -> ticket landed on ${row.actuallyLandedOn}`);
  }
  writeJson("07-diagnose.json", out);
} finally {
  await browser.close();
}
