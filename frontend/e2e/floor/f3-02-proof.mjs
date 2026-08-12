/*
 * F3 PROOF — the DONE MEANS path, driven as the people who do these jobs.
 *
 *   1. kitchen@terrace.local opens /app/kitchen, notes the DEFAULT tile, CLICKS into the
 *      DEFAULT board and reads its header. Repeat for PANTRY1 and GRILL.
 *   2. cashier@terrace.local fires one new mixed check from the POS.
 *   3. Both numbers must move by the same amount.
 *   4. The cook bumps ONE item of that check; neither total may move.
 *   5. The header is checked for horizontal overflow at 390 / 768 / 1440.
 *
 * Every UI reading is paired with a cross-read of the raw ticket payload on the cook's OWN
 * bearer, because ten agents share this machine and other orders land mid-run: attributing
 * drift beats pretending there is none.
 */
import { newBrowser, newPage, login, PEOPLE } from "../shift/lib.mjs";
import { go, shot, readPicker, readBoard, waitForPicker, waitForBoard, apiGet, OUT } from "./f3-lib.mjs";
import { writeFileSync } from "node:fs";

const MAP = { PENDING: "NEW", ACCEPTED: "STARTED", PREPARING: "PREPARING", COOKING: "PREPARING", READY: "READY" };
const STATIONS = ["DEFAULT", "PANTRY1", "GRILL"];
const results = [];
let failures = 0;

function check(what, a, b) {
  const ok = a === b;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  results.push({ what, a, b, ok });
  return ok;
}

/** Independent count of what the board can actually draw, from the raw payload. */
function truthFor(tickets, stationCode) {
  let ticketCount = 0;
  let itemCount = 0;
  const cols = { NEW: 0, STARTED: 0, PREPARING: 0, READY: 0 };
  for (const t of tickets) {
    if (t.stationCode !== stationCode) continue;
    if (t.status === "SERVED" || t.status === "CANCELLED") continue;
    const seen = new Set();
    let live = 0;
    for (const it of t.items) {
      const c = MAP[it.status];
      if (!c) continue;
      live += 1;
      seen.add(c);
    }
    if (live === 0) continue;
    ticketCount += 1;
    itemCount += live;
    for (const c of seen) cols[c] += 1;
  }
  return { ticketCount, itemCount, cols };
}

/**
 * The shift harness waits a fixed 3s after submitting the login form. Ten agents share this
 * machine and the gateway is restarted often, so under load that lands on `/login` and reads
 * as "this persona cannot sign in". Retry on a fresh page instead of scoring a slow stack as
 * a permission failure.
 */
async function signIn(browser, who, attempts = 4) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    const page = await newPage(browser);
    try {
      await login(page, who);
      return page;
    } catch (e) {
      last = e;
      console.log(`  login attempt ${i}/${attempts} for ${who.email} failed: ${e.message}`);
      await page.context().close();
      await new Promise((r) => setTimeout(r, 6000));
    }
  }
  throw last;
}

/**
 * The out-of-band cross-read, on the persona's own bearer.
 *
 * It used to `return r.body?.content ?? []` — which folded a 429 or a 401 into "this station
 * is empty" and then reported the live board as WRONG for showing 16 tickets against a truth
 * of 0. That is the exact `isError`-never-destructured shape this audit exists to stamp out,
 * committed by the instrument rather than the product. A non-200 now retries, and then throws.
 */
async function ticketsOf(page, branchId, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    const r = await apiGet(
      page,
      `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=2000`,
    );
    if (r.status === 200 && Array.isArray(r.body?.content)) return r.body.content;
    last = r.status;
    console.log(`  cross-read attempt ${i}/${attempts} returned ${r.status}; retrying`);
    await page.waitForTimeout(4000 * i);
  }
  throw new Error(`cross-read of the ticket payload never succeeded (last status ${last})`);
}

/**
 * Read a station tile once the picker's own poll has caught up.
 *
 * `useKdsTickets` runs on `refetchInterval: 10_000` with `staleTime: 5_000`, so a tile read
 * two seconds after a check was fired legitimately still shows the previous poll — the tile
 * is not WRONG, it is one tick behind. Sampling mid-interval and calling the difference a
 * defect would be measuring react-query, not the product. This waits (bounded) for the tile
 * and a fresh payload read to agree, and fails loudly if they never do.
 */
async function readTileSettled(page, code, branchId, budgetMs = 40000) {
  const deadline = Date.now() + budgetMs;
  let tile;
  let gt;
  while (Date.now() < deadline) {
    tile = (await readPicker(page)).find((p) => p.code === code);
    gt = truthFor(await ticketsOf(page, branchId), code);
    const want = `${gt.ticketCount} ${gt.ticketCount === 1 ? "ticket" : "tickets"}`;
    if (tile?.tickets === want) return { tile, gt, settled: true };
    await page.waitForTimeout(3000);
  }
  return { tile, gt, settled: false };
}

const browser = await newBrowser();
const kds = await signIn(browser, PEOPLE.kitchen);

// ── 1. picker tile vs the board it opens ──────────────────────────────────────
console.log("\n=== 1. the tile a cook taps, and the board it opens ===");
let t = await go(kds, "/app/kitchen", { waitMs: 2000 });
if (t.bad?.length) throw new Error(`/app/kitchen is broken: ${t.bad}`);
await waitForPicker(kds);
await shot(kds, "10-picker-after-fix");
const picker0 = await readPicker(kds);
const branchId = new URL(
  kds.__requests.find((r) => r.u.includes("/kitchen/kds/tickets")).u,
).searchParams.get("branchId");
const raw0 = await ticketsOf(kds, branchId);

/*
 * Ten other agents ring, bump and close checks on this same branch while this runs, and the
 * picker and the board poll on their own 10s timers. Comparing a tile read at T with a board
 * read at T+5s therefore measures the TRAFFIC, not the product — one run of this script
 * scored "tile 7 / board 9" for exactly that reason, on a build where both are correct.
 *
 * So each surface is compared to the payload read at ITS OWN instant. If both surfaces equal
 * the truth at the moment they were read, they agree by construction — that is a STRONGER
 * statement than tile == board, not a weaker one, and it cannot be faked by a quiet minute.
 * The direct tile == board comparison is still made, but only when the payload is unchanged
 * across the two reads; when it moved, the run says so instead of failing.
 */
const before = {};
let quietStations = 0;
for (const code of STATIONS) {
  await go(kds, "/app/kitchen", { waitMs: 1500 });
  await waitForPicker(kds);
  const settledTile = await readTileSettled(kds, code, branchId);
  const tile = settledTile.tile;
  const gtTile = settledTile.gt;
  if (!settledTile.settled) console.log(`  NOTE ${code}: tile never settled within budget`);
  console.log(`\n${code} — tile reads: ${tile.text}`);

  // A cook TAPS the tile; the tiles are <button>s, not links.
  await kds.locator(`[data-testid="station-tile-${code}"]`).click();
  await kds.waitForURL(`**/app/kitchen/${code}`, { timeout: 15000 });
  await waitForBoard(kds);
  const board = await readBoard(kds);
  const gtBoard = truthFor(await ticketsOf(kds, branchId), code);
  await shot(kds, `11-board-${code}-after-fix`);
  console.log(`  board header reads: ${board.count} · ${board.items}`);
  console.log(`  truth at tile read : ${gtTile.ticketCount} tickets, ${gtTile.itemCount} items, cards ${JSON.stringify(gtTile.cols)}`);
  console.log(`  truth at board read: ${gtBoard.ticketCount} tickets, ${gtBoard.itemCount} items, cards ${JSON.stringify(gtBoard.cols)}`);

  // Each surface against the payload at its own moment.
  check(`${code} tile headline == truth`, tile.tickets, `${gtTile.ticketCount} ${gtTile.ticketCount === 1 ? "ticket" : "tickets"}`);
  check(`${code} tile items == truth`, tile.items, `${gtTile.itemCount} ${gtTile.itemCount === 1 ? "item" : "items"}`);
  check(`${code} board headline == truth`, board.count, `${gtBoard.ticketCount} ${gtBoard.ticketCount === 1 ? "ticket" : "tickets"}`);
  check(`${code} board items == truth`, board.items, `${gtBoard.itemCount} ${gtBoard.itemCount === 1 ? "item" : "items"}`);
  for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
    check(`${code} ${c} tile == truth`, tile.cols[c], String(gtTile.cols[c]));
    check(`${code} ${c} board == truth`, board.cols[c], String(gtBoard.cols[c]));
  }

  // The direct comparison the DONE MEANS asks for — when the branch held still between reads.
  const quiet =
    gtTile.ticketCount === gtBoard.ticketCount && gtTile.itemCount === gtBoard.itemCount;
  if (quiet) {
    quietStations += 1;
    check(`${code} tile headline == board headline (payload held still)`, tile.tickets, board.count);
    check(`${code} tile items == board items (payload held still)`, tile.items, board.items);
    for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
      check(`${code} ${c} tile == board (payload held still)`, tile.cols[c], board.cols[c]);
    }
  } else {
    console.log(
      `  NOTE ${code}: another agent changed this board between the two reads ` +
        `(${gtTile.ticketCount}/${gtTile.itemCount} → ${gtBoard.ticketCount}/${gtBoard.itemCount}); ` +
        `direct tile-vs-board comparison skipped, each surface still checked against its own payload`,
    );
  }

  // Both numbers say WHAT they count.
  check(`${code} board headline is labelled`, /^\d+ tickets?$/.test(board.count ?? ""), true);
  check(`${code} board items is labelled`, /^\d+ items?$/.test(board.items ?? ""), true);
  // `text-transform: uppercase` is a paint, not a string — compare what was authored.
  check(`${code} tile split is captioned`, (tile.caption ?? "").toLowerCase(), "tickets by stage");

  before[code] = { tile, board, gt: gtBoard };
}
check("at least one station was quiet enough for a direct tile-vs-board read", quietStations >= 1, true);

// ── 2. fire one new mixed check from the POS ──────────────────────────────────
console.log("\n=== 2. a cashier fires one new mixed check ===");
const rawBefore = await ticketsOf(kds, branchId);
const idsBefore = new Set(rawBefore.map((t) => t.id));

const cash = await signIn(browser, PEOPLE.cashier);
// pos-service is restarted often on this machine. `till-status-unavailable` is the POS
// saying so honestly; reload until it is back rather than scoring an outage as a defect.
let posReady = false;
for (let i = 1; i <= 20 && !posReady; i += 1) {
  await go(cash, "/app/pos", { waitMs: 6000 });
  posReady =
    (await cash.locator("[data-testid=order-type-dine_in]").count()) > 0 &&
    // The menu grid comes from pos-service too; an order-type control with no dishes under
    // it is a half-warm POS, not a ready one.
    (await cash.locator('[data-testid="menu-grid"] button[aria-pressed]').count()) > 0;
  if (!posReady) {
    const why = await cash.evaluate(() =>
      (document.querySelector('[role="alert"]')?.innerText ?? "no order-type control").slice(0, 120),
    );
    console.log(`  POS not ready (attempt ${i}/20): ${why.replace(/\s+/g, " ")}`);
    await cash.waitForTimeout(15000);
  }
}
if (!posReady) throw new Error("pos-service never came back — cannot fire a check");
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(600);
const tableTrigger = cash.locator("[data-testid=table-select-trigger]");
if (await tableTrigger.count()) {
  await tableTrigger.click();
  await cash.waitForTimeout(1500);
  const opts = await cash.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
      id: n.getAttribute("data-testid"),
      t: n.innerText.replace(/\s+/g, " ").trim(),
      // An OCCUPIED table renders aria-disabled; clicking it just times out.
      disabled: n.getAttribute("aria-disabled") === "true",
    })),
  );
  const free = opts.find((o) => !o.disabled && /AVAILABLE/i.test(o.t)) ?? opts.find((o) => !o.disabled);
  if (free) {
    console.log("  table:", free.t);
    await cash.locator(`[data-testid="${free.id}"]`).click();
    await cash.waitForTimeout(1000);
  } else {
    // Every table is seated. A takeaway check fires to exactly the same stations.
    console.log("  no selectable table — falling back to TAKEAWAY");
    await cash.keyboard.press("Escape");
    await cash.waitForTimeout(500);
    await cash.locator("[data-testid=order-type-takeaway]").click();
    await cash.waitForTimeout(800);
  }
}
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 25000 });
// Two DIFFERENT dishes: one check that can hold two lines in two different columns —
// which is exactly the shape that used to make the board header count it twice.
await tiles.nth(0).click();
await cash.waitForTimeout(400);
await tiles.nth(1).click();
await cash.waitForTimeout(900);
await shot(cash, "13-pos-cart");
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "14-pos-fired");
const firedNos = await cash.evaluate(() =>
  Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
);
console.log("  order numbers on the POS after firing:", JSON.stringify(firedNos));

// Which board did routing send it to? Ask the payload rather than assuming DEFAULT — the
// first two menu tiles route to PANTRY1, and a proof that only ever looks at one station
// would score correct routing as a missing ticket.
const rawAfter = await ticketsOf(kds, branchId);
const mine = rawAfter.find((t) => !idsBefore.has(t.id) && firedNos.includes(t.orderNo));
if (!mine) throw new Error(`no new KDS ticket for ${firedNos.join("/")} — the check did not fire`);
const S = mine.stationCode;
const myOrderNo = mine.orderNo;
console.log(`  fired ${myOrderNo} → station ${S}, ${mine.items.length} line(s): ${mine.items.map((i) => `${i.name}=${i.status}`).join(", ")}`);
if (!before[S]) throw new Error(`no "before" reading for ${S}`);

// ── 3. both numbers move by the same amount ───────────────────────────────────
console.log(`\n=== 3. both numbers move by the same amount (station ${S}) ===`);
await go(kds, "/app/kitchen", { waitMs: 2000 });
await waitForPicker(kds);
const settledAfter = await readTileSettled(kds, S, branchId);
const tileAfter = settledAfter.tile;
const truthAtTileAfter = settledAfter.gt;
check("the picker caught up with the new check within one poll", settledAfter.settled, true);
await kds.locator(`[data-testid="station-tile-${S}"]`).click();
await kds.waitForURL(`**/app/kitchen/${S}`, { timeout: 15000 });
await waitForBoard(kds);
const boardAfter = await readBoard(kds);
const rawAfter2 = await ticketsOf(kds, branchId);
const truthAfter = truthFor(rawAfter2, S);
await shot(kds, `15-${S}-after-fire`);

const n = (s) => Number(String(s).match(/\d+/)?.[0] ?? NaN);
console.log(`  before — tile ${before[S].tile.tickets}/${before[S].tile.items}, board ${before[S].board.count}/${before[S].board.items}, truth ${before[S].gt.ticketCount}/${before[S].gt.itemCount}`);
console.log(`  after  — tile ${tileAfter.tickets}/${tileAfter.items}, board ${boardAfter.count}/${boardAfter.items}, truth ${truthAfter.ticketCount}/${truthAfter.itemCount}`);

/*
 * The DONE MEANS wants "both numbers move by the same amount". Under ten concurrent agents
 * the raw before→after delta is my one check PLUS whatever they rang and closed in between,
 * and a run that demands +1 is measuring their traffic. So the delta is decomposed instead:
 *
 *   my check's own contribution — computed from the payload, by removing MY ticket from it —
 *   must be exactly +1 ticket and +2 items, and both surfaces must equal the payload at the
 *   moment they were read. The two together say precisely what the DONE MEANS asks.
 */
const withoutMine = rawAfter2.filter((x) => x.id !== mine.id);
const truthWithoutMine = truthFor(withoutMine, S);
const myTicketContribution = truthAfter.ticketCount - truthWithoutMine.ticketCount;
const myItemContribution = truthAfter.itemCount - truthWithoutMine.itemCount;
console.log(`  my check contributes ${myTicketContribution} ticket and ${myItemContribution} items to both surfaces`);
console.log(`  raw deltas (mine + other agents') — tickets: tile +${n(tileAfter.tickets) - n(before[S].tile.tickets)}, board +${n(boardAfter.count) - n(before[S].board.count)}, payload +${truthAfter.ticketCount - before[S].gt.ticketCount}`);
check("my one check adds exactly one ticket", myTicketContribution, 1);
check("…and its two lines add exactly two items", myItemContribution, 2);
check("the new check is on this board", rawAfter2.some((x) => x.id === mine.id), true);
check("board headline == payload after the fire", boardAfter.count, `${truthAfter.ticketCount} ${truthAfter.ticketCount === 1 ? "ticket" : "tickets"}`);
check("board items == payload after the fire", boardAfter.items, `${truthAfter.itemCount} ${truthAfter.itemCount === 1 ? "item" : "items"}`);
check("tile headline == payload after the fire", tileAfter.tickets, `${truthAtTileAfter.ticketCount} ${truthAtTileAfter.ticketCount === 1 ? "ticket" : "tickets"}`);
check("tile items == payload after the fire", tileAfter.items, `${truthAtTileAfter.itemCount} ${truthAtTileAfter.itemCount === 1 ? "item" : "items"}`);
// Literal string equality only when nothing landed between the two reads (see section 1).
if (
  truthAtTileAfter.ticketCount === truthAfter.ticketCount &&
  truthAtTileAfter.itemCount === truthAfter.itemCount
) {
  check("tile still == board after the fire (payload held still)", tileAfter.tickets, boardAfter.count);
  check("items still == items after the fire (payload held still)", tileAfter.items, boardAfter.items);
} else {
  console.log(`  NOTE: ${S} changed between the tile read and the board read (${truthAtTileAfter.ticketCount}/${truthAtTileAfter.itemCount} -> ${truthAfter.ticketCount}/${truthAfter.itemCount}); each surface still matched its own payload above`);
}

// ── 4. bumping one item moves neither total ───────────────────────────────────
console.log("\n=== 4. the cook bumps ONE line of that check ===");
const firstItemId = mine.items.find((i) => MAP[i.status] === "NEW")?.id;
const moveBtn = kds.locator(`[data-testid="column-move-${firstItemId}"]`);
await moveBtn.first().waitFor({ timeout: 20000 });
console.log("  clicking:", (await moveBtn.first().innerText()).replace(/\s+/g, " "));
await moveBtn.first().click();
await kds.waitForTimeout(6000);
const boardBumped = await readBoard(kds);
const rawBumped = await ticketsOf(kds, branchId);
const truthBumped = truthFor(rawBumped, S);
await shot(kds, `16-${S}-after-bump`);
console.log(`  after bump — board ${boardBumped.count}/${boardBumped.items}, truth ${truthBumped.ticketCount}/${truthBumped.itemCount}`);
const bumpedTicket = rawBumped.find((x) => x.id === mine.id);
console.log(`  my ticket now: ${bumpedTicket.items.map((i) => `${i.name}=${i.status}`).join(", ")}`);
const columnsNow = new Set(bumpedTicket.items.map((i) => MAP[i.status]).filter(Boolean));
check("my one check now spans two board columns (two cards)", columnsNow.size, 2);

/*
 * THE assertion this whole item is about. My check now draws TWO cards where it drew one, so
 * the old header — which counted cards — would read one higher for a bump that moved nothing
 * on or off the board. Measured as MY check's own contribution so a ticket another agent
 * closes in the same second cannot mask or manufacture the result.
 */
const bumpedWithoutMine = truthFor(rawBumped.filter((x) => x.id !== mine.id), S);
const myTicketAfterBump = truthBumped.ticketCount - bumpedWithoutMine.ticketCount;
const myItemsAfterBump = truthBumped.itemCount - bumpedWithoutMine.itemCount;
console.log(`  my check contributes ${myTicketAfterBump} ticket and ${myItemsAfterBump} items AFTER the bump (was ${myTicketContribution} / ${myItemContribution})`);
check("bumping one line did not change my check's ticket contribution", myTicketAfterBump, myTicketContribution);
check("bumping one line did not change my check's item contribution", myItemsAfterBump, myItemContribution);
check("board headline == payload after the bump", boardBumped.count, `${truthBumped.ticketCount} ${truthBumped.ticketCount === 1 ? "ticket" : "tickets"}`);
check("board items == payload after the bump", boardBumped.items, `${truthBumped.itemCount} ${truthBumped.itemCount === 1 ? "item" : "items"}`);
// When the branch held still across the bump, the literal on-screen strings must be identical.
if (truthBumped.ticketCount === truthAfter.ticketCount && truthBumped.itemCount === truthAfter.itemCount) {
  check("board headline unchanged by the bump (payload held still)", boardBumped.count, boardAfter.count);
  check("board item count unchanged by the bump (payload held still)", boardBumped.items, boardAfter.items);
} else {
  console.log(`  NOTE: another agent changed ${S} across the bump (${truthAfter.ticketCount}/${truthAfter.itemCount} → ${truthBumped.ticketCount}/${truthBumped.itemCount}); literal string comparison skipped, contribution check above still stands`);
}

await go(kds, "/app/kitchen", { waitMs: 2000 });
await waitForPicker(kds);
const settledBumped = await readTileSettled(kds, S, branchId);
const tileBumped = settledBumped.tile;
const truthAtTileBumped = settledBumped.gt;
check("the picker settled after the bump", settledBumped.settled, true);
await shot(kds, "17-picker-after-bump");
console.log(`  picker after bump — ${tileBumped.tickets} / ${tileBumped.items} (payload ${truthAtTileBumped.ticketCount}/${truthAtTileBumped.itemCount})`);
check("tile headline == payload after the bump", tileBumped.tickets, `${truthAtTileBumped.ticketCount} ${truthAtTileBumped.ticketCount === 1 ? "ticket" : "tickets"}`);
check("tile items == payload after the bump", tileBumped.items, `${truthAtTileBumped.itemCount} ${truthAtTileBumped.itemCount === 1 ? "item" : "items"}`);

// ── 5. the header at 390 / 768 / 1440, both themes ────────────────────────────
console.log("\n=== 5. the widened header at 390 / 768 / 1440 ===");
for (const [w, h] of [[390, 844], [768, 1024], [1440, 950]]) {
  await kds.setViewportSize({ width: w, height: h });
  await go(kds, `/app/kitchen/${S}`, { waitMs: 1500 });
  await waitForBoard(kds);
  const m = await kds.evaluate(() => {
    const el = document.querySelector('[data-testid="kds-ticket-count"]');
    const it = document.querySelector('[data-testid="kds-item-count"]');
    const cs = getComputedStyle(el);
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      ticketText: el?.innerText?.trim(),
      itemText: it?.innerText?.trim(),
      // Computed style, never the class list — cn()/tailwind-merge silently drops classes.
      color: cs.color,
      fontSize: cs.fontSize,
      ticketVisible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right <= window.innerWidth + 1,
      itemVisible: it.getBoundingClientRect().width > 0 && it.getBoundingClientRect().right <= window.innerWidth + 1,
    };
  });
  console.log(`  ${w}px: ${JSON.stringify(m)}`);
  await shot(kds, `18-header-${w}`);
  check(`${w}px — no horizontal page scroll`, m.docScroll <= m.docClient, true);
  check(`${w}px — ticket count on screen`, m.ticketVisible, true);
  check(`${w}px — item count on screen`, m.itemVisible, true);
}

writeFileSync(`${OUT}/02-proof.json`, JSON.stringify({ at: new Date().toISOString(), myOrderNo, results }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed, ${failures} failed`);
console.log("console errors:", kds.__console.slice(0, 8));
await browser.close();
if (failures) process.exitCode = 1;
