/*
 * F3 step 1 — REPRODUCE. Read the picker tile and the board header for every station,
 * as kitchen@terrace.local, and cross-read the raw ticket payload on the same bearer so
 * the delta can be attributed rather than guessed.
 */
import { newBrowser, newPage, login, PEOPLE } from "../shift/lib.mjs";
import { go, shot, readPicker, readBoard, apiGet, OUT } from "./f3-lib.mjs";
import { writeFileSync } from "node:fs";

const MAP = {
  PENDING: "NEW",
  ACCEPTED: "STARTED",
  PREPARING: "PREPARING",
  COOKING: "PREPARING",
  READY: "READY",
};

function truth(tickets) {
  const byStation = new Map();
  for (const t of tickets) {
    if (t.status === "SERVED" || t.status === "CANCELLED") continue;
    const s = byStation.get(t.stationCode) ?? {
      tickets: 0,
      ticketsWithLiveItems: 0,
      liveItems: 0,
      fragments: 0,
      itemCols: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 },
      fragCols: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 },
      deadStatuses: {},
      zeroItemTickets: [],
    };
    s.tickets += 1;
    const seen = new Set();
    let live = 0;
    for (const it of t.items) {
      const col = MAP[it.status] ?? null;
      if (!col) {
        s.deadStatuses[it.status] = (s.deadStatuses[it.status] ?? 0) + 1;
        continue;
      }
      live += 1;
      s.itemCols[col] += 1;
      seen.add(col);
    }
    s.liveItems += live;
    s.fragments += seen.size;
    for (const c of seen) s.fragCols[c] += 1;
    if (live > 0) s.ticketsWithLiveItems += 1;
    else
      s.zeroItemTickets.push({
        id: t.id.slice(0, 8),
        orderNo: t.orderNo,
        status: t.status,
        itemStatuses: t.items.map((i) => i.status),
      });
    byStation.set(t.stationCode, s);
  }
  return byStation;
}

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);

const t0 = await go(page, "/app/kitchen");
console.log("picker url:", t0.url, "alerts:", t0.alerts);
await shot(page, "01-picker");
const picker = await readPicker(page);
console.log("\n=== PICKER TILES ===");
for (const p of picker) console.log(` ${p.code}: badge=${p.badge} cols=${JSON.stringify(p.cols)}`);

// branchId, taken from the request the page itself made
const req = page.__requests.find((r) => r.u.includes("/kitchen/kds/tickets"));
const branchId = req ? new URL(req.u).searchParams.get("branchId") : null;
console.log("\nbranchId =", branchId, "(from", req?.u?.slice(0, 120), ")");

const wide = await apiGet(
  page,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=2000`,
);
console.log(
  "branch-wide fetch:",
  wide.status,
  "content:",
  wide.body?.content?.length,
  "totalElements:",
  wide.body?.totalElements,
);
const gt = truth(wide.body?.content ?? []);

const boards = {};
for (const p of picker) {
  const tt = await go(page, `/app/kitchen/${p.code}`, { waitMs: 4000 });
  if (tt.alerts.length) console.log(`  ! ${p.code} alerts: ${tt.alerts.join(" / ")}`);
  const b = await readBoard(page);
  boards[p.code] = b;
  await shot(page, `02-board-${p.code}`);
  const g = gt.get(p.code);
  console.log(
    `\n${p.code}\n  picker badge   ${p.badge}   cols ${JSON.stringify(p.cols)}` +
      `\n  board header   ${b.count}   cols ${JSON.stringify(b.cols.NEW ? { NEW: b.cols.NEW, STARTED: b.cols.STARTED, PREPARING: b.cols.PREPARING, READY: b.cols.READY } : b.cols)}` +
      `\n  ground truth   tickets=${g?.tickets} ticketsWithLiveItems=${g?.ticketsWithLiveItems} liveItems=${g?.liveItems} fragments=${g?.fragments}` +
      `\n                 itemCols=${JSON.stringify(g?.itemCols)} fragCols=${JSON.stringify(g?.fragCols)}` +
      `\n                 deadItemStatuses=${JSON.stringify(g?.deadStatuses)} zeroItemTickets=${g?.zeroItemTickets.length}`,
  );
  if (g?.zeroItemTickets.length) {
    console.log(
      `                 e.g. ${JSON.stringify(g.zeroItemTickets.slice(0, 3))}`,
    );
  }
}

writeFileSync(
  `${OUT}/01-measure.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      branchId,
      picker,
      boards,
      truth: Object.fromEntries(gt),
      wideTotalElements: wide.body?.totalElements,
      wideReturned: wide.body?.content?.length,
    },
    null,
    2,
  ),
);
console.log("\nconsole errors:", page.__console.slice(0, 6));
await browser.close();
