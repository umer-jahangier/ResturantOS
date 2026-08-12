/* S1 RE-OPEN 02 — capture the routing payload the SCREEN actually received, plus branches. */
import { newBrowser, newPage, login, go, apiGet, PEOPLE, saveState, OUT, log } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);

  let routingBody = null;
  let stationsBody = null;
  let branchId = null;
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/pos/menu/routing?branchId=") && r.status() === 200) {
      branchId = new URL(u).searchParams.get("branchId");
      routingBody = await r.json().catch(() => null);
    }
    if (u.includes("/pos/stations?branchId=") && r.status() === 200) {
      stationsBody = await r.json().catch(() => null);
    }
  });

  const t = await go(page, "/app/menu/routing", { waitMs: 6000 });
  log("trouble:", JSON.stringify(t));

  const d = routingBody?.data ?? routingBody;
  const st = stationsBody?.data?.content ?? stationsBody?.data ?? stationsBody?.content ?? stationsBody;
  writeFileSync(`${OUT}/02-routing-raw.json`, JSON.stringify(d, null, 2));
  writeFileSync(`${OUT}/02-stations-raw.json`, JSON.stringify(st, null, 2));
  log("branchId:", branchId);
  log("stations:", (Array.isArray(st) ? st : []).map((s) => `${s.code}|${s.name}|active=${s.active}|type=${s.stationType}|id=${s.id}`).join("\n           "));
  log("categories:");
  for (const c of d?.categories ?? []) log(`   ${c.categoryName} active=${c.active} -> ${c.stationCode ?? "-"} id=${c.categoryId}`);
  const items = d?.items ?? [];
  log("items total:", items.length, "routed:", items.filter((i) => i.effectiveStationCode).length);
  for (const i of items) {
    if (i.effectiveStationCode) log(`   ${i.itemName} [${i.categoryName}] -> ${i.effectiveStationCode} src=${i.routeSource} active=${i.active} id=${i.itemId}`);
  }

  // branches: which endpoint answers?
  for (const p of ["/api/v1/branches", "/api/v1/auth/branches", "/api/v1/users/branches", "/api/v1/tenant/branches"]) {
    const r = await apiGet(page, p);
    if (r.status === 200) {
      const bl = r.body?.data?.content ?? r.body?.data ?? r.body?.content ?? r.body;
      log(`branches via ${p}:`, JSON.stringify(Array.isArray(bl) ? bl.map((b) => ({ id: b.id, name: b.name, code: b.code })) : bl).slice(0, 600));
      saveState({ branchesPath: p, branches: Array.isArray(bl) ? bl : [] });
      break;
    } else log(`branches via ${p}: ${r.status}`);
  }
  saveState({ branchId, stations: Array.isArray(st) ? st : [], categories: d?.categories ?? [], items });
} finally {
  await browser.close();
}
