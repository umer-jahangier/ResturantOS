/*
 * F3 RE-OPEN, step 1 — measure the picker and every board myself, and derive an
 * INDEPENDENT ground truth from the raw payload on the cook's own bearer.
 *
 * Deliberately does NOT import the product's kds-counts.ts: a truth computed by the
 * code under test proves nothing. The reader here parses the VISIBLE TEXT a cook reads
 * ("63 tickets", "66 items") rather than a testid whose value the fix could have chosen.
 */
import { newBrowser, newPage, login, PEOPLE } from "../../shift/lib.mjs";
import { apiGet } from "../f3-lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F3/reopen");
mkdirSync(OUT, { recursive: true });

const COLS = ["NEW", "STARTED", "PREPARING", "READY"];
const MAP = {
  PENDING: "NEW",
  ACCEPTED: "STARTED",
  PREPARING: "PREPARING",
  COOKING: "PREPARING",
  READY: "READY",
};
const TERMINAL_TICKET = new Set(["SERVED", "CANCELLED", "CLEARED"]);

/** My own arithmetic, written from the definition, not from the product's helper. */
function truth(tickets) {
  const by = new Map();
  for (const t of tickets) {
    const s =
      by.get(t.stationCode) ??
      {
        rawTickets: 0,
        boardTickets: 0,
        liveItems: 0,
        cardTickets: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 },
        itemsByCol: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 },
        cards: 0,
        debris: [],
      };
    s.rawTickets += 1;
    if (TERMINAL_TICKET.has(t.status)) {
      by.set(t.stationCode, s);
      continue;
    }
    const seen = new Set();
    let live = 0;
    for (const it of t.items) {
      const c = MAP[it.status] ?? null;
      if (!c) continue;
      live += 1;
      s.itemsByCol[c] += 1;
      seen.add(c);
    }
    if (live > 0) {
      s.boardTickets += 1;
      s.liveItems += live;
      s.cards += seen.size;
      for (const c of seen) s.cardTickets[c] += 1;
    } else {
      s.debris.push({
        id: String(t.id).slice(0, 8),
        orderNo: t.orderNo,
        status: t.status,
        items: t.items.map((i) => i.status),
      });
    }
    by.set(t.stationCode, s);
  }
  return by;
}

/** What a COOK reads off a tile — visible text, parsed the way a person parses it. */
async function readTilesAsHuman(page) {
  return page.evaluate(() => {
    const out = [];
    for (const tile of document.querySelectorAll('[data-testid^="station-tile-"]')) {
      const code = tile.getAttribute("data-testid").replace("station-tile-", "");
      const text = tile.innerText;
      const tickets = /(\d+)\s+tickets?\b/i.exec(text);
      const items = /(\d+)\s+items?\b/i.exec(text);
      const badge = tile.querySelector(`[data-testid="station-queue-${code}"]`);
      const cols = {};
      for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
        const el = tile.querySelector(`[data-testid="station-${code}-col-${c}"]`);
        cols[c] = el ? Number(el.innerText.trim().split("\n")[0]) : null;
      }
      out.push({
        code,
        visibleTickets: tickets ? Number(tickets[1]) : null,
        visibleItems: items ? Number(items[1]) : null,
        badge: badge ? Number(badge.innerText.trim()) : null,
        badgeAria: badge ? badge.getAttribute("aria-label") : null,
        hasCaption: /tickets by stage/i.test(text),
        cols,
        raw: text.replace(/\n+/g, " | "),
      });
    }
    return out;
  });
}

async function readBoardAsHuman(page) {
  return page.evaluate(() => {
    const header =
      document.querySelector('[data-testid="kds-board"] header') ||
      document.querySelector('[data-testid="kds-ticket-count"]')?.closest("header");
    const text = header ? header.innerText : "";
    const tickets = /(\d+)\s+tickets?\b/i.exec(text);
    const items = /(\d+)\s+items?\b/i.exec(text);
    const cols = {};
    for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
      const el = document.querySelector(`[data-testid="kds-column-count-${c}"]`);
      cols[c] = el ? Number(el.innerText.trim()) : null;
    }
    return {
      h1: document.querySelector("h1")?.innerText.trim() ?? null,
      visibleTickets: tickets ? Number(tickets[1]) : null,
      visibleItems: items ? Number(items[1]) : null,
      headerText: text.replace(/\n+/g, " | "),
      page: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? null,
      cols,
      cardsOnPage: document.querySelectorAll("[data-fragment-key]").length,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        n.innerText.trim().slice(0, 160),
      ),
    };
  });
}

async function waitPicker(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid^="station-tile-"]') !== null ||
      document.querySelector('[data-testid="kds-no-stations"]') !== null ||
      document.querySelector('[role="alert"]') !== null,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);
}

async function waitBoard(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="kds-ticket-count"]') !== null ||
      document.querySelector('[role="alert"]') !== null,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1800);
}

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);

await page.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await waitPicker(page);

// branchId, straight off the request the page itself made
const req = page.__requests.find((r) => /kds\/tickets\?/.test(r.u));
const branchId = req ? new URL(req.u).searchParams.get("branchId") : null;
console.log("branchId =", branchId);
if (!branchId) throw new Error("could not observe the branchId the page is using");

const tiles = await readTilesAsHuman(page);
await page.screenshot({ path: `${OUT}/r1-picker.png` });
console.log("\n=== PICKER (visible text) ===");
for (const t of tiles)
  console.log(
    `  ${t.code.padEnd(9)} badge=${t.badge}  "${t.visibleTickets} tickets"  "${t.visibleItems} items"  caption=${t.hasCaption}  cols=${JSON.stringify(t.cols)}`,
  );

// ── independent ground truth, branch-wide, on the cook's own bearer ───────────
const raw = await apiGet(
  page,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`,
);
const content = raw.body?.content ?? [];
console.log(
  `\npayload: status=${raw.status} rows=${content.length} totalElements=${raw.body?.totalElements}`,
);
const T = truth(content);
console.log("=== TRUTH (my arithmetic, from the payload) ===");
for (const [code, s] of T)
  console.log(
    `  ${code.padEnd(9)} boardTickets=${s.boardTickets} liveItems=${s.liveItems} cards=${s.cards} cardTickets=${JSON.stringify(s.cardTickets)} debris=${s.debris.length}`,
  );

// ── every board, reached the way a cook reaches it: by tapping the tile ───────
const results = [];
for (const t of tiles) {
  await page.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
  await waitPicker(page);
  const beforeTiles = await readTilesAsHuman(page);
  const tile = beforeTiles.find((x) => x.code === t.code);
  await page.locator(`[data-testid="station-tile-${t.code}"]`).click();
  await waitBoard(page);
  const board = await readBoardAsHuman(page);
  await page.screenshot({ path: `${OUT}/r1-board-${t.code}.png` });

  // re-read the payload at the same moment, station-scoped, so the comparison is not
  // against a truth measured minutes and several other agents' orders ago
  const rawS = await apiGet(
    page,
    `/api/v1/kitchen/kds/tickets?branchId=${branchId}&stationCode=${t.code}&status=PENDING,COOKING,READY&size=500`,
  );
  const TS = truth(rawS.body?.content ?? []).get(t.code) ?? {
    boardTickets: 0,
    liveItems: 0,
    cardTickets: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 },
    debris: [],
  };

  const row = {
    code: t.code,
    tileTickets: tile.visibleTickets,
    tileItems: tile.visibleItems,
    tileBadge: tile.badge,
    tileCols: tile.cols,
    boardTickets: board.visibleTickets,
    boardItems: board.visibleItems,
    boardCols: board.cols,
    truthTickets: TS.boardTickets,
    truthItems: TS.liveItems,
    truthCols: TS.cardTickets,
    debris: TS.debris.length,
    headerText: board.headerText,
    alerts: board.alerts,
    page: board.page,
    cardsOnPage: board.cardsOnPage,
  };
  results.push(row);
  console.log(
    `\n  ${t.code}: tile ${row.tileTickets}t/${row.tileItems}i  →  board ${row.boardTickets}t/${row.boardItems}i  |  truth ${row.truthTickets}t/${row.truthItems}i  (debris ${row.debris})`,
  );
  console.log(`     tile cols  ${JSON.stringify(row.tileCols)}`);
  console.log(`     board cols ${JSON.stringify(row.boardCols)}`);
  console.log(`     truth cols ${JSON.stringify(row.truthCols)}`);
  if (row.alerts.length) console.log(`     ! alerts: ${JSON.stringify(row.alerts)}`);
}

writeFileSync(`${OUT}/r1-measure.json`, JSON.stringify({ branchId, tiles, results }, null, 2));

let fails = 0;
for (const r of results) {
  if (r.tileTickets !== r.boardTickets) {
    console.log(`FAIL ${r.code}: tile says ${r.tileTickets} tickets, board says ${r.boardTickets}`);
    fails++;
  }
  if (r.tileItems !== r.boardItems) {
    console.log(`FAIL ${r.code}: tile says ${r.tileItems} items, board says ${r.boardItems}`);
    fails++;
  }
  for (const c of COLS) {
    if (r.tileCols[c] !== r.boardCols[c]) {
      console.log(`FAIL ${r.code}: ${c} tile=${r.tileCols[c]} board=${r.boardCols[c]}`);
      fails++;
    }
  }
}
console.log(`\n${fails === 0 ? "AGREEMENT: clean" : `AGREEMENT: ${fails} disagreement(s)`}`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
