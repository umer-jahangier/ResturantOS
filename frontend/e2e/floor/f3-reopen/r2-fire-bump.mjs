/*
 * F3 RE-OPEN, step 2 — the DONE criterion, driven end to end.
 *
 *   fire one new mixed check from the POS  → both numbers move by the SAME amount
 *   bump one line of that check            → NEITHER total changes
 *   then the adjacent paths the fix could plausibly have missed:
 *     the Ready-column toggle, paging, a reload, and arriving at a board via the
 *     header's station switcher instead of via a tile.
 *
 * Ten agents ring checks on this branch, so nothing here demands a bare "+1". Every
 * assertion is either (a) screen == an independently derived truth measured in the same
 * second, or (b) a delta attributed to MY ticket by re-deriving with it removed.
 */
import { newBrowser, newPage, PEOPLE } from "../../shift/lib.mjs";
import { loginPatiently as login } from "./rlib.mjs";
import { apiGet } from "../f3-lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F3/reopen");
mkdirSync(OUT, { recursive: true });

const MAP = {
  PENDING: "NEW",
  ACCEPTED: "STARTED",
  PREPARING: "PREPARING",
  COOKING: "PREPARING",
  READY: "READY",
};
const TERMINAL = new Set(["SERVED", "CANCELLED", "CLEARED"]);
const COLS = ["NEW", "STARTED", "PREPARING", "READY"];

let pass = 0;
let fail = 0;
const failures = [];
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else {
    fail += 1;
    failures.push(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

function truthFor(tickets, station, { exclude } = {}) {
  const out = { tickets: 0, items: 0, cards: 0, cols: { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 } };
  for (const t of tickets) {
    if (t.stationCode !== station) continue;
    if (exclude && t.id === exclude) continue;
    if (TERMINAL.has(t.status)) continue;
    const seen = new Set();
    let live = 0;
    for (const it of t.items) {
      const c = MAP[it.status] ?? null;
      if (!c) continue;
      live += 1;
      seen.add(c);
    }
    if (live === 0) continue;
    out.tickets += 1;
    out.items += live;
    out.cards += seen.size;
    for (const c of seen) out.cols[c] += 1;
  }
  return out;
}

async function tickets(page, branchId) {
  const r = await apiGet(
    page,
    `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`,
  );
  if (r.status !== 200) throw new Error(`ticket read failed: ${r.status}`);
  return r.body?.content ?? [];
}

async function readTiles(page) {
  return page.evaluate(() => {
    const out = {};
    for (const tile of document.querySelectorAll('[data-testid^="station-tile-"]')) {
      const code = tile.getAttribute("data-testid").replace("station-tile-", "");
      const text = tile.innerText;
      const cols = {};
      for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
        const el = tile.querySelector(`[data-testid="station-${code}-col-${c}"]`);
        cols[c] = el ? Number(el.innerText.trim().split("\n")[0]) : null;
      }
      out[code] = {
        tickets: Number((/(\d+)\s+tickets?\b/i.exec(text) ?? [])[1] ?? NaN),
        items: Number((/(\d+)\s+items?\b/i.exec(text) ?? [])[1] ?? NaN),
        cols,
      };
    }
    return out;
  });
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
      headerText: text.replace(/\n+/g, " | "),
      page: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? null,
      cols,
      cardsOnPage: document.querySelectorAll("[data-fragment-key]").length,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim().slice(0, 140)),
    };
  });
}

async function waitPicker(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid^="station-tile-"]') !== null,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);
}
async function waitBoard(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="kds-ticket-count"]') !== null,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1800);
}

/**
 * Read a surface and the payload together, retrying until the two were observed in the same
 * poll window. Without this, a concurrent agent's order lands between the two reads and the
 * disagreement it produces is a measurement artefact, not a defect.
 */
async function settled(page, branchId, station, kind, tries = 8) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    const before = truthFor(await tickets(page, branchId), station);
    const screen = kind === "tile" ? (await readTiles(page))[station] : await readBoard(page);
    const after = truthFor(await tickets(page, branchId), station);
    last = { screen, gt: after };
    if (JSON.stringify(before) === JSON.stringify(after) && screen.tickets === after.tickets) {
      return { ...last, settled: true };
    }
    await page.waitForTimeout(4000); // one poll interval (10s refetch, 5s stale)
    if (kind === "tile") {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitPicker(page);
    } else {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitBoard(page);
    }
  }
  return { ...last, settled: false };
}

const browser = await newBrowser();
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await waitPicker(kds);
function observedBranchId(page) {
  for (const r of page.__requests) {
    const b = new URL(r.u).searchParams.get("branchId");
    if (b) return b;
  }
  return null;
}
let branchId = observedBranchId(kds);
for (let i = 0; i < 10 && !branchId; i += 1) {
  await kds.waitForTimeout(3000);
  branchId = observedBranchId(kds);
}
if (!branchId) throw new Error("never observed the branchId the kitchen page is using");
console.log("branchId =", branchId);

const rawBefore = await tickets(kds, branchId);
const idsBefore = new Set(rawBefore.map((t) => t.id));

// ── 1. a cashier fires one new mixed check ───────────────────────────────────
console.log("\n=== 1. fire one new mixed check from the POS ===");
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
let ready = false;
for (let i = 1; i <= 15 && !ready; i += 1) {
  await cash.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await cash.waitForTimeout(7000);
  ready =
    (await cash.locator("[data-testid=order-type-dine_in]").count()) > 0 &&
    (await cash.locator('[data-testid="menu-grid"] button[aria-pressed]').count()) > 0;
  if (!ready) {
    console.log(
      `  POS not ready (${i}/15): ${(await cash.evaluate(() => (document.querySelector('[role="alert"]')?.innerText ?? "no order-type control").slice(0, 120))).replace(/\s+/g, " ")}`,
    );
    await cash.waitForTimeout(12000);
  }
}
if (!ready) throw new Error("pos-service never came back");
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(700);
const trig = cash.locator("[data-testid=table-select-trigger]");
if (await trig.count()) {
  await trig.click();
  await cash.waitForTimeout(1500);
  const opts = await cash.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
      id: n.getAttribute("data-testid"),
      t: n.innerText.replace(/\s+/g, " ").trim(),
      disabled: n.getAttribute("aria-disabled") === "true",
    })),
  );
  const free = opts.find((o) => !o.disabled && /AVAILABLE/i.test(o.t)) ?? opts.find((o) => !o.disabled);
  if (free) {
    console.log("  table:", free.t);
    await cash.locator(`[data-testid="${free.id}"]`).click();
    await cash.waitForTimeout(1200);
  } else {
    await cash.keyboard.press("Escape");
    await cash.waitForTimeout(500);
    await cash.locator("[data-testid=order-type-takeaway]").click();
    await cash.waitForTimeout(900);
  }
}
const menu = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await menu.first().waitFor({ timeout: 25000 });

/**
 * S6 landed a modifier dialog on the POS this week: some dishes now open a configuration
 * sheet instead of dropping straight into the cart, and it blocks every other click while
 * it is up. Adding a dish is therefore "tap, then finish the dialog if there is one".
 */
async function addDish(n) {
  await menu.nth(n).click();
  await cash.waitForTimeout(900);
  const dlg = cash.locator('[data-testid="modifier-dialog"]');
  if (await dlg.count()) {
    const add = cash.locator('[data-testid="modifier-dialog-add"]');
    if ((await add.count()) && (await add.first().isEnabled())) {
      await add.first().click();
    } else {
      // A required group with nothing chosen — pick the first option in each group, then add.
      const groups = await cash.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="modifier-group-"]'))
          .map((g) => g.getAttribute("data-testid"))
          .filter((id) => /^modifier-group-[^-]/.test(id) && !/error/.test(id)),
      );
      for (const g of groups) {
        const opt = cash.locator(`[data-testid="${g}"] [data-testid^="modifier-option-"]`).first();
        if (await opt.count()) {
          await opt.click();
          await cash.waitForTimeout(250);
        }
      }
      await cash.locator('[data-testid="modifier-dialog-add"]').first().click();
    }
    await cash.waitForTimeout(1200);
  }
}
await addDish(0);
await addDish(1);
await cash.waitForTimeout(800);
await cash.screenshot({ path: `${OUT}/r2-01-cart.png` });
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(8000);
await cash.screenshot({ path: `${OUT}/r2-02-fired.png` });
const firedNos = await cash.evaluate(() =>
  Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
);
console.log("  order numbers on the POS:", JSON.stringify(firedNos));

const rawAfterFire = await tickets(kds, branchId);
const mine = rawAfterFire.find((t) => !idsBefore.has(t.id) && firedNos.includes(t.orderNo));
if (!mine) throw new Error(`no new KDS ticket for ${firedNos.join("/")}`);
const S = mine.stationCode;
console.log(
  `  fired ${mine.orderNo} → station ${S}, ${mine.items.length} line(s): ${mine.items.map((i) => `${i.name}=${i.status}`).join(", ")}`,
);

// ── 2. both surfaces show it, and both show the same thing ───────────────────
console.log(`\n=== 2. the tile and the board agree, with my check on the board (${S}) ===`);
await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await waitPicker(kds);
const tileNow = await settled(kds, branchId, S, "tile");
check(`the tile for ${S} settled against the payload`, tileNow.settled, true);
check(`tile "N tickets" == truth`, tileNow.screen.tickets, tileNow.gt.tickets);
check(`tile "N items" == truth`, tileNow.screen.items, tileNow.gt.items);

await kds.locator(`[data-testid="station-tile-${S}"]`).click();
await waitBoard(kds);
const boardNow = await settled(kds, branchId, S, "board");
await kds.screenshot({ path: `${OUT}/r2-03-board-after-fire.png` });
check(`the board for ${S} settled against the payload`, boardNow.settled, true);
check(`board "N tickets" == truth`, boardNow.screen.tickets, boardNow.gt.tickets);
check(`board "N items" == truth`, boardNow.screen.items, boardNow.gt.items);
for (const c of COLS) check(`board ${c} column == truth cards`, boardNow.screen.cols[c], boardNow.gt.cols[c]);

// my ticket's own contribution, by re-deriving without it
const rawNow = await tickets(kds, branchId);
const withMine = truthFor(rawNow, S);
const withoutMine = truthFor(rawNow, S, { exclude: mine.id });
const liveLines = mine.items.filter((i) => MAP[i.status]).length;
console.log(
  `  my ticket contributes ${withMine.tickets - withoutMine.tickets} ticket(s) and ${withMine.items - withoutMine.items} item(s)`,
);
check("my check adds exactly one ticket to the station's total", withMine.tickets - withoutMine.tickets, 1);
check("my check adds its own lines and no more", withMine.items - withoutMine.items, liveLines);

// ── 3. bump ONE line of my check ─────────────────────────────────────────────
console.log("\n=== 3. bump one line — neither total may move ===");
const beforeBump = await readBoard(kds);
const gtBeforeBump = truthFor(await tickets(kds, branchId), S);
console.log(`  header before: "${beforeBump.tickets} tickets / ${beforeBump.items} items", cards on page ${beforeBump.cardsOnPage}`);

const btn = kds.locator(`[data-testid="column-move-${mine.items[0].id}"]`);
const btnCount = await btn.count();
check("my check's own move button is on the board a cook can reach", btnCount > 0, true);
if (btnCount > 0) {
  const label = (await btn.first().innerText()).replace(/\s+/g, " ");
  console.log(`  clicking "${label}"`);
  await btn.first().click();
  await kds.waitForTimeout(6000);
}
const afterBump = await readBoard(kds);
await kds.screenshot({ path: `${OUT}/r2-04-board-after-bump.png` });
const rawAfterBump = await tickets(kds, branchId);
const gtAfterBump = truthFor(rawAfterBump, S);
const mineAfter = rawAfterBump.find((t) => t.id === mine.id);
const colsOfMine = new Set(mineAfter.items.map((i) => MAP[i.status]).filter(Boolean));
console.log(
  `  my ticket now spans ${colsOfMine.size} board column(s): ${[...colsOfMine].join(", ")} — statuses ${mineAfter.items.map((i) => i.status).join(", ")}`,
);
console.log(`  header after:  "${afterBump.tickets} tickets / ${afterBump.items} items"`);
check("the bump genuinely split my check across two columns", colsOfMine.size >= 2, true);
check("board ticket total did not move on a bump", afterBump.tickets, beforeBump.tickets);
check("board item total did not move on a bump", afterBump.items, beforeBump.items);
check("...and the payload agrees the total did not move", gtAfterBump.tickets, gtBeforeBump.tickets);
check("board ticket total still == truth after the bump", afterBump.tickets, gtAfterBump.tickets);
check("board item total still == truth after the bump", afterBump.items, gtAfterBump.items);

// the picker must have made the same move — go back and read the tile
await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await waitPicker(kds);
const tileAfterBump = (await readTiles(kds))[S];
await kds.screenshot({ path: `${OUT}/r2-05-picker-after-bump.png` });
console.log(`  tile after bump: ${tileAfterBump.tickets} tickets / ${tileAfterBump.items} items`);
check("the tile total did not move on a bump either", tileAfterBump.tickets, beforeBump.tickets);
check("tile == board after the bump", tileAfterBump.tickets, afterBump.tickets);

// ── 4. adjacent paths ────────────────────────────────────────────────────────
console.log("\n=== 4. adjacent paths ===");
await kds.locator(`[data-testid="station-tile-${S}"]`).click();
await waitBoard(kds);
const base = await readBoard(kds);

// 4a. hiding the Ready column is a view preference, not a change in queue depth
await kds.locator('[data-testid="kds-toggle-ready"]').click();
await kds.waitForTimeout(1500);
const hidden = await readBoard(kds);
await kds.screenshot({ path: `${OUT}/r2-06-ready-hidden.png` });
check("hiding Ready does not change the ticket total", hidden.tickets, base.tickets);
check("hiding Ready does not change the item total", hidden.items, base.items);
check("hiding Ready really removed the Ready column", hidden.cols.READY, null);
await kds.locator('[data-testid="kds-toggle-ready"]').click();
await kds.waitForTimeout(1500);
const restored = await readBoard(kds);
check("showing Ready again restores the same totals", [restored.tickets, restored.items], [base.tickets, base.items]);

// 4b. paging
if (base.page) {
  const pager = kds.locator('[data-testid="kds-next-page"], [data-testid="kds-page-next"]');
  if (await pager.count()) {
    await pager.first().click();
    await kds.waitForTimeout(1200);
  } else {
    await kds.keyboard.press("ArrowRight");
    await kds.waitForTimeout(1200);
  }
  const paged = await readBoard(kds);
  console.log(`  page indicator ${base.page} → ${paged.page}`);
  check("turning the page does not change the ticket total", paged.tickets, base.tickets);
  check("turning the page does not change the item total", paged.items, base.items);
} else {
  console.log("  (single page — nothing to turn)");
}

// 4c. a reload — does the number persist, or was it a render-time accident?
await kds.reload({ waitUntil: "domcontentloaded" });
await waitBoard(kds);
const reloaded = await readBoard(kds);
const gtReload = truthFor(await tickets(kds, branchId), S);
check("after a reload the board still equals the truth", [reloaded.tickets, reloaded.items], [gtReload.tickets, gtReload.items]);

// 4d. reach a DIFFERENT board through the header's station switcher, not a tile
const other = Object.keys(await (async () => {
  await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
  await waitPicker(kds);
  return readTiles(kds);
})()).find((c) => c !== S);
const tilesAll = await readTiles(kds);
await kds.locator(`[data-testid="station-tile-${S}"]`).click();
await waitBoard(kds);
const sw = kds.locator('[data-testid="kds-board"] select');
if ((await sw.count()) && other) {
  await sw.first().selectOption(other);
  await kds.waitForTimeout(3500);
  await waitBoard(kds);
  const otherBoard = await readBoard(kds);
  await kds.screenshot({ path: `${OUT}/r2-07-switcher-${other}.png` });
  console.log(`  switched to ${other}: header "${otherBoard.tickets} tickets / ${otherBoard.items} items"; tile said ${tilesAll[other].tickets}/${tilesAll[other].items}`);
  const gtOther = truthFor(await tickets(kds, branchId), other);
  check(`the board reached by the switcher (${other}) equals the truth`, [otherBoard.tickets, otherBoard.items], [gtOther.tickets, gtOther.items]);
  check(`...and equals the tile the cook saw for ${other}`, [otherBoard.tickets, otherBoard.items], [tilesAll[other].tickets, tilesAll[other].items]);
} else {
  console.log("  (no station switcher found)");
}

writeFileSync(
  `${OUT}/r2-fire-bump.json`,
  JSON.stringify({ branchId, station: S, order: mine.orderNo, ticketId: mine.id, pass, fail, failures }, null, 2),
);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) for (const f of failures) console.log("  FAILURE " + f);
await browser.close();
process.exit(fail ? 1 : 0);
