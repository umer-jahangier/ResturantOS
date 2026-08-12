/*
 * F18 step 0 — what the product HAS today.
 *
 *  - Which menu items route to which station (so a split check can be rung deterministically).
 *  - What the kitchen persona's nav offers.
 *  - Whether any route/word "expo"/"pass" exists anywhere the cook can reach.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log } from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);

const me = await apiGet(cash, "/api/v1/auth/me");
log("me:", JSON.stringify(me.body).slice(0, 600));

const stations = await apiGet(cash, "/api/v1/pos/stations");
log("\npos stations:", JSON.stringify(stations.body).slice(0, 1500));

const items = await apiGet(cash, "/api/v1/pos/menu/items?size=500");
const rows = items.body?.data?.content ?? items.body?.content ?? items.body?.data ?? items.body ?? [];
log("\nmenu items:", Array.isArray(rows) ? rows.length : typeof rows);
if (Array.isArray(rows)) {
  const byStation = {};
  for (const r of rows) {
    const s = r.kdsStation ?? r.stationCode ?? r.station?.code ?? "(none)";
    (byStation[s] ??= []).push(`${r.name} [${r.id}]`);
  }
  for (const [s, names] of Object.entries(byStation)) {
    log(`  ${s}: ${names.length} — ${names.slice(0, 4).join(" | ")}`);
  }
}

// ── the kitchen persona ───────────────────────────────────────────────────────
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
let tr = await go(kds, "/app/kitchen", { waitMs: 6000 });
log("\n/app/kitchen:", JSON.stringify(tr));
await shot(kds, "00a-kitchen-picker-before");

const nav = await kds.evaluate(() => ({
  links: Array.from(document.querySelectorAll("a[href]")).map((a) => ({
    href: a.getAttribute("href"),
    text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
  })),
  bodyHasExpo: /expo|the pass\b/i.test(document.body.innerText),
  text: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1200),
}));
log("nav links:", JSON.stringify(nav.links, null, 1));
log("body mentions expo/pass:", nav.bodyHasExpo);
log("picker text:", nav.text);

for (const route of ["/app/kitchen/expo", "/app/kitchen/EXPO", "/app/kitchen/pass", "/app/expo"]) {
  const t = await go(kds, route, { waitMs: 3500, allowTrouble: true });
  const body = await kds.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
  log(`\n${route} -> ${JSON.stringify(t)}\n   ${body}`);
}

const kdsStations = await apiGet(kds, "/api/v1/kitchen/kds/stations?branchId=" + (await kds.evaluate(() => null) ?? ""));
log("\n(kds stations probe skipped - needs branchId)", kdsStations.status);

await browser.close();
log("\nprobe done");
