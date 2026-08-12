/*
 * F3 RE-OPEN, step 3 — the questions a fix to two numbers can still fail.
 *
 *   a. paging is keyboard-only on this board (PageDown/PageUp) — my step-2 click probe never
 *      actually turned a page, so it proved nothing. Turn it properly.
 *   b. the WRONG persona: does a cashier / a waiter now read a cook's queue?
 *   c. ANOTHER TENANT: does Control Bistro's cook see Control Bistro's numbers, and does
 *      Floating Terrace's branch id return nothing on their bearer?
 *   d. the adjacent KDS surfaces that also print a number under a noun: the Pass, and the
 *      board's clear-stale control.
 */
import { newBrowser, newPage, PEOPLE } from "../../shift/lib.mjs";
import { loginPatiently as login } from "./rlib.mjs";
import { apiGet } from "../f3-lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F3/reopen");
mkdirSync(OUT, { recursive: true });

const MAP = { PENDING: "NEW", ACCEPTED: "STARTED", PREPARING: "PREPARING", COOKING: "PREPARING", READY: "READY" };
const TERMINAL = new Set(["SERVED", "CANCELLED", "CLEARED"]);

let pass = 0, fail = 0;
const failures = [];
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass += 1) : (fail += 1, failures.push(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

function truthFor(tickets, station) {
  const out = { tickets: 0, items: 0, cols: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 } };
  for (const t of tickets) {
    if (station && t.stationCode !== station) continue;
    if (TERMINAL.has(t.status)) continue;
    const seen = new Set();
    let live = 0;
    for (const it of t.items) {
      const c = MAP[it.status] ?? null;
      if (!c) continue;
      live += 1;
      seen.add(c);
    }
    if (!live) continue;
    out.tickets += 1;
    out.items += live;
    for (const c of seen) out.cols[c] += 1;
  }
  return out;
}

async function readBoard(page) {
  return page.evaluate(() => {
    const header =
      document.querySelector('[data-testid="kds-board"] header') ||
      document.querySelector('[data-testid="kds-ticket-count"]')?.closest("header");
    const text = header ? header.innerText : "";
    const cols = {};
    for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
      const el = document.querySelector(`[data-testid="kds-column-count-${c}"]`);
      cols[c] = el ? Number(el.innerText.trim()) : null;
    }
    return {
      tickets: Number((/(\d+)\s+tickets?\b/i.exec(text) ?? [])[1] ?? NaN),
      items: Number((/(\d+)\s+items?\b/i.exec(text) ?? [])[1] ?? NaN),
      page: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? null,
      cols,
      cardsOnPage: document.querySelectorAll("[data-fragment-key]").length,
      staleBtn: document.querySelector('[data-testid="kds-clear-stale-trigger"]')?.innerText.replace(/\s+/g, " ").trim() ?? null,
    };
  });
}
async function readTiles(page) {
  return page.evaluate(() => {
    const out = {};
    for (const tile of document.querySelectorAll('[data-testid^="station-tile-"]')) {
      const code = tile.getAttribute("data-testid").replace("station-tile-", "");
      const text = tile.innerText;
      out[code] = {
        tickets: Number((/(\d+)\s+tickets?\b/i.exec(text) ?? [])[1] ?? NaN),
        items: Number((/(\d+)\s+items?\b/i.exec(text) ?? [])[1] ?? NaN),
      };
    }
    return out;
  });
}
async function waitPicker(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid^="station-tile-"]') !== null ||
      /permission|not enabled|No branch/i.test(document.body.innerText),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);
}
async function waitBoard(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="kds-ticket-count"]') !== null ||
      /permission|not enabled|No branch/i.test(document.body.innerText),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1800);
}
function observedBranchId(page) {
  for (const r of page.__requests) {
    const b = new URL(r.u).searchParams.get("branchId");
    if (b) return b;
  }
  return null;
}
async function ticketsOf(page, branchId) {
  const r = await apiGet(page, `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`);
  return { status: r.status, rows: r.body?.content ?? [] };
}

const browser = await newBrowser();
const report = {};

// ── a. paging, properly ──────────────────────────────────────────────────────
console.log("\n=== a. turning a page must not change the queue depth ===");
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await waitPicker(kds);
const branchId = observedBranchId(kds);
console.log("  branchId =", branchId);
const tiles = await readTiles(kds);
const busiest = Object.entries(tiles).sort((a, b) => b[1].tickets - a[1].tickets)[0][0];
console.log(`  busiest station: ${busiest} (${tiles[busiest].tickets} tickets / ${tiles[busiest].items} items)`);
await kds.locator(`[data-testid="station-tile-${busiest}"]`).click();
await waitBoard(kds);
const p1 = await readBoard(kds);
console.log(`  page ${p1.page}: header "${p1.tickets} tickets / ${p1.items} items", ${p1.cardsOnPage} cards drawn`);
await kds.locator('[data-testid="kds-board"]').click({ position: { x: 5, y: 5 } });
await kds.keyboard.press("PageDown");
await kds.waitForTimeout(1500);
const p2 = await readBoard(kds);
console.log(`  page ${p2.page}: header "${p2.tickets} tickets / ${p2.items} items", ${p2.cardsOnPage} cards drawn`);
await kds.screenshot({ path: `${OUT}/r3-01-page2.png` });
check("PageDown really turned the page", p2.page !== p1.page, true);
check("the ticket total is the same on page 2", p2.tickets, p1.tickets);
check("the item total is the same on page 2", p2.items, p1.items);
check("the column headers are the same on page 2", p2.cols, p1.cols);
check("the board draws fewer cards than the header counts tickets (it is paged)", p1.cardsOnPage <= p1.tickets, true);
report.paging = { p1, p2 };

// the header count must also equal the truth on the busiest board
const gt = truthFor((await ticketsOf(kds, branchId)).rows, busiest);
check(`the busiest board (${busiest}) equals the truth`, [p2.tickets, p2.items], [gt.tickets, gt.items]);

// ── d. the adjacent surfaces on the same screen ──────────────────────────────
console.log("\n=== d. the other numbers on the kitchen's screens ===");
console.log(`  clear-stale control on ${busiest}: ${JSON.stringify(p1.staleBtn)}`);
if (p1.staleBtn) {
  const n = Number((/(\d+)/.exec(p1.staleBtn) ?? [])[1] ?? NaN);
  if (!Number.isNaN(n)) {
    check("the clear-stale control never offers more tickets than the board is carrying", n <= p1.tickets, true);
    report.stale = { label: p1.staleBtn, n, boardTickets: p1.tickets };
  }
}
await kds.goto(`${BASE}/app/kitchen/expo`, { waitUntil: "domcontentloaded" });
await kds.waitForTimeout(6000);
const expo = await kds.evaluate(() => {
  const t = document.body.innerText;
  return {
    checks: Number((/(\d+)\s+checks?\b/i.exec(t) ?? [])[1] ?? NaN),
    saysTickets: /(\d+)\s+tickets?\b/i.test(t),
    head: t.replace(/\s+/g, " ").slice(0, 200),
  };
});
await kds.screenshot({ path: `${OUT}/r3-02-pass.png` });
console.log(`  the Pass: ${JSON.stringify(expo)}`);
// The Pass counts CHECKS across the whole branch — a different question under a different
// word, which is the honest way to differ. It must not print a rival "N tickets".
check("the Pass does not print a second, rival 'N tickets'", expo.saysTickets, false);
const branchTruth = truthFor((await ticketsOf(kds, branchId)).rows, null);
console.log(`  branch-wide truth: ${branchTruth.tickets} checks on some board`);
if (!Number.isNaN(expo.checks)) {
  check("the Pass's check count is no larger than the branch's open checks", expo.checks <= branchTruth.tickets, true);
  report.expo = { pass: expo.checks, branchTruth: branchTruth.tickets };
}

// ── b. the wrong persona ─────────────────────────────────────────────────────
console.log("\n=== b. the wrong persona ===");
for (const who of ["cashier", "waiter"]) {
  const p = await newPage(browser);
  const person =
    who === "waiter"
      ? { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" }
      : PEOPLE.cashier;
  await login(p, person);
  await p.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(7000);
  const seen = await p.evaluate(() => ({
    tiles: document.querySelectorAll('[data-testid^="station-tile-"]').length,
    denied: /do not have permission|Access denied/i.test(document.body.innerText),
    notEnabled: /not enabled/i.test(document.body.innerText),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
  }));
  await p.screenshot({ path: `${OUT}/r3-03-${who}-kitchen.png` });
  console.log(`  ${who}: tiles=${seen.tiles} denied=${seen.denied} — "${seen.text.slice(0, 110)}"`);
  report[`persona_${who}`] = seen;
  // whichever way it falls, it must be DECIDED — never a silent zero board
  check(`${who} at /app/kitchen is either admitted with tiles or told why`, seen.tiles > 0 || seen.denied || seen.notEnabled, true);
  await p.close();
}

// ── c. another tenant ────────────────────────────────────────────────────────
console.log("\n=== c. another tenant ===");
const ctrl = await newPage(browser);
await login(ctrl, {
  slug: "control-bistro-isolation-test-tenant",
  email: "kitchen@control.local",
  password: "Control#Kitchen1",
});
await ctrl.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await ctrl.waitForTimeout(9000);
const ctrlBranch = observedBranchId(ctrl);
const ctrlSeen = await ctrl.evaluate(() => ({
  tiles: Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((t) => ({
    code: t.getAttribute("data-testid").replace("station-tile-", ""),
    text: t.innerText.replace(/\n+/g, " | "),
  })),
  denied: /do not have permission|Access denied/i.test(document.body.innerText),
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 220),
}));
await ctrl.screenshot({ path: `${OUT}/r3-04-control-kitchen.png` });
console.log(`  control-bistro branchId=${ctrlBranch}`);
console.log(`  tiles: ${JSON.stringify(ctrlSeen.tiles)}`);
check("Control Bistro is a different branch entirely", ctrlBranch !== branchId, true);
// ask for Floating Terrace's branch on the CONTROL cook's own bearer
const leak = await ticketsOf(ctrl, branchId);
console.log(`  control cook asking for Floating Terrace's branch: HTTP ${leak.status}, ${leak.rows.length} row(s)`);
check("Floating Terrace's tickets do not come back on a Control Bistro bearer", leak.rows.length, 0);
report.crossTenant = { ctrlBranch, status: leak.status, rows: leak.rows.length, tiles: ctrlSeen.tiles };
// and the reverse
const reverse = ctrlBranch ? await ticketsOf(kds, ctrlBranch) : null;
if (reverse) {
  console.log(`  terrace cook asking for Control Bistro's branch: HTTP ${reverse.status}, ${reverse.rows.length} row(s)`);
  check("Control Bistro's tickets do not come back on a Floating Terrace bearer", reverse.rows.length, 0);
  report.crossTenantReverse = { status: reverse.status, rows: reverse.rows.length };
}

writeFileSync(`${OUT}/r3-personas.json`, JSON.stringify({ pass, fail, failures, report }, null, 2));
console.log(`\n${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILURE " + f);
await browser.close();
process.exit(fail ? 1 : 0);
