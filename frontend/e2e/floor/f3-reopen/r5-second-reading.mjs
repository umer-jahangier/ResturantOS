/*
 * F3 RE-OPEN, step 5 — a SECOND independent reading, taken well after the first and after
 * ~40 minutes of other agents' traffic has churned the boards, plus the one permission
 * question the counting fix sits next to: a WAITER holds `pos.kds.view` (granted 2026-08-06
 * by changelog 055, six days before this fix) but NOT `pos.kds.update`. They must be able to
 * READ the queue and must not be able to bump it.
 */
import { newBrowser, newPage, PEOPLE, tokenOf } from "../../shift/lib.mjs";
import { loginPatiently as login } from "./rlib.mjs";
import { apiGet } from "../f3-lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F3/reopen");
mkdirSync(OUT, { recursive: true });
const MAP = { PENDING: "NEW", ACCEPTED: "STARTED", PREPARING: "PREPARING", COOKING: "PREPARING", READY: "READY" };
const TERMINAL = new Set(["SERVED", "CANCELLED", "CLEARED"]);
const COLS = ["NEW", "STARTED", "PREPARING", "READY"];

let pass = 0, fail = 0;
const failures = [];
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass += 1) : (fail += 1, failures.push(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}
function truthFor(rows, station) {
  const o = { tickets: 0, items: 0, cols: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 }, debris: 0 };
  for (const t of rows) {
    if (t.stationCode !== station) continue;
    if (TERMINAL.has(t.status)) continue;
    const seen = new Set();
    let live = 0;
    for (const it of t.items) {
      const c = MAP[it.status] ?? null;
      if (!c) continue;
      live += 1;
      seen.add(c);
    }
    if (!live) { o.debris += 1; continue; }
    o.tickets += 1;
    o.items += live;
    for (const c of seen) o.cols[c] += 1;
  }
  return o;
}
async function rows(page, branchId) {
  const r = await apiGet(page, `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`);
  return r.body?.content ?? [];
}
async function readTiles(page) {
  return page.evaluate(() => {
    const out = {};
    for (const tile of document.querySelectorAll('[data-testid^="station-tile-"]')) {
      const code = tile.getAttribute("data-testid").replace("station-tile-", "");
      const cols = {};
      for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
        const el = tile.querySelector(`[data-testid="station-${code}-col-${c}"]`);
        cols[c] = el ? Number(el.innerText.trim().split("\n")[0]) : null;
      }
      out[code] = {
        tickets: Number((/(\d+)\s+tickets?\b/i.exec(tile.innerText) ?? [])[1] ?? NaN),
        items: Number((/(\d+)\s+items?\b/i.exec(tile.innerText) ?? [])[1] ?? NaN),
        cols,
      };
    }
    return out;
  });
}
async function readBoard(page) {
  return page.evaluate(() => {
    const h =
      document.querySelector('[data-testid="kds-board"] header') ||
      document.querySelector('[data-testid="kds-ticket-count"]')?.closest("header");
    const text = h ? h.innerText : "";
    const cols = {};
    for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
      const el = document.querySelector(`[data-testid="kds-column-count-${c}"]`);
      cols[c] = el ? Number(el.innerText.trim()) : null;
    }
    return {
      tickets: Number((/(\d+)\s+tickets?\b/i.exec(text) ?? [])[1] ?? NaN),
      items: Number((/(\d+)\s+items?\b/i.exec(text) ?? [])[1] ?? NaN),
      cols,
      moveButtons: document.querySelectorAll('[data-testid^="column-move-"]').length,
      cards: document.querySelectorAll("[data-fragment-key]").length,
    };
  });
}
async function waitPicker(p) {
  await p.waitForFunction(() => document.querySelector('[data-testid^="station-tile-"]') !== null, null, { timeout: 60000 });
  await p.waitForTimeout(1800);
}
async function waitBoard(p) {
  await p.waitForFunction(() => document.querySelector('[data-testid="kds-ticket-count"]') !== null, null, { timeout: 60000 });
  await p.waitForTimeout(1800);
}
function branchOf(p) {
  for (const r of p.__requests) {
    const b = new URL(r.u).searchParams.get("branchId");
    if (b) return b;
  }
  return null;
}

const browser = await newBrowser();
const out = {};

console.log("\n=== second reading, as the cook ===");
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await waitPicker(kds);
const branchId = branchOf(kds);
await kds.screenshot({ path: `${OUT}/r5-01-picker.png` });

const codes = Object.keys(await readTiles(kds));
const table = [];
for (const code of codes) {
  await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
  await waitPicker(kds);
  const tile = (await readTiles(kds))[code];
  await kds.locator(`[data-testid="station-tile-${code}"]`).click();
  await waitBoard(kds);
  const board = await readBoard(kds);
  const gt = truthFor(await rows(kds, branchId), code);
  await kds.screenshot({ path: `${OUT}/r5-board-${code}.png` });
  table.push({ code, tile, board, gt });
  console.log(
    `  ${code.padEnd(9)} tile ${tile.tickets}t/${tile.items}i | board ${board.tickets}t/${board.items}i | truth ${gt.tickets}t/${gt.items}i (debris ${gt.debris})`,
  );
  check(`${code}: tile tickets == board tickets`, tile.tickets, board.tickets);
  check(`${code}: tile items == board items`, tile.items, board.items);
  for (const c of COLS) check(`${code}: ${c} tile == board`, tile.cols[c], board.cols[c]);
  // truth is read a beat after the screen, so only flag a divergence larger than one check
  const drift = Math.abs(board.tickets - gt.tickets);
  check(`${code}: the board is within one check of the truth (drift ${drift})`, drift <= 1, true);
}
out.second = table;

// ── the waiter: may read the queue, may not bump it ──────────────────────────
console.log("\n=== a waiter holds pos.kds.view and not pos.kds.update ===");
const w = await newPage(browser);
await login(w, { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" });
const busiest = table.slice().sort((a, b) => b.board.tickets - a.board.tickets)[0].code;
await w.goto(`${BASE}/app/kitchen/${busiest}`, { waitUntil: "domcontentloaded" });
await waitBoard(w);
const wb = await readBoard(w);
const wGt = truthFor(await rows(w, branchId), busiest);
await w.screenshot({ path: `${OUT}/r5-02-waiter-board.png` });
console.log(`  waiter on ${busiest}: "${wb.tickets} tickets / ${wb.items} items", ${wb.cards} cards, ${wb.moveButtons} move buttons`);
check("the waiter reads the same queue depth the cook does", Math.abs(wb.tickets - wGt.tickets) <= 1, true);
check("the waiter cannot bump — no move control is rendered", wb.moveButtons, 0);
// Permissions travel IN the JWT here — `/api/v1/auth/me` does not exist and 404s, which the
// first version of this probe silently read as "no permissions at all". Decode the token.
const tok = await tokenOf(w);
const perms = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()).permissions ?? [];
console.log(`  waiter kds permissions: ${JSON.stringify(perms.filter((p) => p.startsWith("pos.kds")))}`);
check("the waiter's token carries pos.kds.view", perms.includes("pos.kds.view"), true);
check("the waiter's token does NOT carry pos.kds.update", perms.includes("pos.kds.update"), false);
out.waiter = { board: wb, perms: perms.filter((p) => p.startsWith("pos.kds")) };

writeFileSync(`${OUT}/r5-second-reading.json`, JSON.stringify({ pass, fail, failures, out }, null, 2));
console.log(`\n${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILURE " + f);
await browser.close();
process.exit(fail ? 1 : 0);
