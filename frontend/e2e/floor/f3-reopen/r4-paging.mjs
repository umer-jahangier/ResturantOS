/*
 * F3 RE-OPEN, step 4 — the two things step 3 could not decide.
 *
 * a. PAGING. Step 3's PageDown comparison failed 102→103 tickets / 163→165 items. That is the
 *    signature of ANOTHER AGENT firing a two-line check between my two reads, not a paging
 *    defect — so this re-runs it with the payload read on BOTH sides of the key press, and
 *    scores the page turn only on runs where the underlying truth did not move. Any run whose
 *    truth DID move is reported and retried rather than counted either way.
 *
 * b. THE OTHER TENANT'S PICKER showed zero tiles. An empty state and an error state are the
 *    same picture in a screenshot; this asks the DOM which one it is.
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
async function ticketsOf(page, branchId) {
  const r = await apiGet(page, `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`);
  return r.body?.content ?? [];
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
      cards: document.querySelectorAll("[data-fragment-key]").length,
      overflowNotes: Array.from(document.querySelectorAll("[data-testid^='kds-column-']"))
        .map((n) => (/\+\d+ on other pages/.exec(n.innerText) ?? [])[0])
        .filter(Boolean),
    };
  });
}
async function waitPicker(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid^="station-tile-"]') !== null ||
      document.querySelector('[data-testid="kds-no-stations"]') !== null ||
      document.querySelector('[role="alert"]') !== null ||
      /permission|not enabled|No branch/i.test(document.body.innerText),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2000);
}
async function waitBoard(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="kds-ticket-count"]') !== null, null, { timeout: 60000 });
  await page.waitForTimeout(1800);
}
function observedBranchId(page) {
  for (const r of page.__requests) {
    const b = new URL(r.u).searchParams.get("branchId");
    if (b) return b;
  }
  return null;
}

const browser = await newBrowser();
const report = {};

// ── a. paging, with the concurrent traffic controlled for ────────────────────
console.log("\n=== a. turning a page, with other agents' traffic controlled for ===");
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
await kds.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
await waitPicker(kds);
const branchId = observedBranchId(kds);
const tiles = await kds.evaluate(() =>
  Object.fromEntries(
    Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((t) => [
      t.getAttribute("data-testid").replace("station-tile-", ""),
      Number((/(\d+)\s+tickets?\b/i.exec(t.innerText) ?? [])[1] ?? 0),
    ]),
  ),
);
const busiest = Object.entries(tiles).sort((a, b) => b[1] - a[1])[0][0];
console.log(`  busiest station: ${busiest} (${tiles[busiest]} tickets)`);
await kds.locator(`[data-testid="station-tile-${busiest}"]`).click();
await waitBoard(kds);

let quietRun = null;
const attempts = [];
for (let i = 1; i <= 6 && !quietRun; i += 1) {
  const gtBefore = truthFor(await ticketsOf(kds, branchId), busiest);
  const before = await readBoard(kds);
  await kds.locator('[data-testid="kds-board"]').click({ position: { x: 5, y: 5 } });
  await kds.keyboard.press("PageDown");
  await kds.waitForTimeout(1200);
  const after = await readBoard(kds);
  const gtAfter = truthFor(await ticketsOf(kds, branchId), busiest);
  // "Quiet" is not just "the truth did not move" — the header must ALSO have been caught up
  // to it when the key was pressed. The board polls every 10s, so a header still showing the
  // previous poll will step forward during the turn for a reason that has nothing to do with
  // paging. Attempt 1 of the first run was exactly that: truth 106→107 with the header a poll
  // behind at 106, catching up mid-turn.
  const quiet =
    JSON.stringify(gtBefore) === JSON.stringify(gtAfter) &&
    before.tickets === gtBefore.tickets &&
    before.items === gtBefore.items;
  attempts.push({ i, quiet, before, after, gtBefore, gtAfter });
  console.log(
    `  attempt ${i}: ${before.page} → ${after.page} | header ${before.tickets}/${before.items} → ${after.tickets}/${after.items} | truth ${gtBefore.tickets}/${gtBefore.items} → ${gtAfter.tickets}/${gtAfter.items} | ${quiet ? "QUIET" : "the branch moved under the read — discarding"}`,
  );
  if (quiet && after.page !== before.page) quietRun = { before, after, gtAfter };
  else await kds.waitForTimeout(6000);
}
if (!quietRun) {
  console.log("  ! never got a quiet window — reporting rather than scoring");
  check("a quiet page-turn window was reached", false, true);
} else {
  const { before, after, gtAfter } = quietRun;
  check("PageDown turned the page", after.page !== before.page, true);
  check("the ticket total is the same on the next page", after.tickets, before.tickets);
  check("the item total is the same on the next page", after.items, before.items);
  check("the column headers are the same on the next page", after.cols, before.cols);
  check("the header still equals the truth on the next page", [after.tickets, after.items], [gtAfter.tickets, gtAfter.items]);
  // the columns say out loud that they are showing part of a longer queue
  console.log(`  overflow notes on the page: ${JSON.stringify(after.overflowNotes)}`);
  check("a paged column tells the cook the rest exists", after.overflowNotes.length > 0, true);
}
await kds.screenshot({ path: `${OUT}/r4-01-paged.png` });
report.paging = attempts;

// ── b. what the other tenant's picker actually said ──────────────────────────
console.log("\n=== b. Control Bistro's kitchen: empty, or broken? ===");
const ctrl = await newPage(browser);
await login(ctrl, {
  slug: "control-bistro-isolation-test-tenant",
  email: "kitchen@control.local",
  password: "Control#Kitchen1",
});
await ctrl.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
// A branch with exactly ONE active station auto-navigates straight to that board (KDS-04), so
// "no tiles" here can mean the picker redirected rather than that it failed. Wait for either.
await ctrl
  .waitForFunction(
    () =>
      document.querySelector('[data-testid^="station-tile-"]') !== null ||
      document.querySelector('[data-testid="kds-no-stations"]') !== null ||
      document.querySelector('[data-testid="kds-ticket-count"]') !== null ||
      document.querySelector('[role="alert"]') !== null ||
      /permission|not enabled|No branch/i.test(document.body.innerText),
    null,
    { timeout: 60000 },
  )
  .catch(() => console.log("  ! Control Bistro's kitchen reached NO settled state in 60s"));
await ctrl.waitForTimeout(2000);
const ctrlState = await ctrl.evaluate(() => ({
  tiles: document.querySelectorAll('[data-testid^="station-tile-"]').length,
  redirectedToABoard: !!document.querySelector('[data-testid="kds-ticket-count"]'),
  boardHeader: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim() ?? null,
  emptyState: !!document.querySelector('[data-testid="kds-no-stations"]'),
  emptyTitle: document.querySelector('[data-testid="kds-no-stations-title"]')?.innerText.trim() ?? null,
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim().slice(0, 200)),
  loading: /Loading stations/i.test(document.body.innerText),
  denied: /do not have permission/i.test(document.body.innerText),
  url: location.href,
}));
await ctrl.screenshot({ path: `${OUT}/r4-02-control-picker.png` });
console.log("  " + JSON.stringify(ctrlState));
const ctrlBranch = observedBranchId(ctrl);
const ctrlRows = ctrlBranch ? await ticketsOf(ctrl, ctrlBranch) : [];
console.log(`  Control Bistro's own branch ${ctrlBranch}: ${ctrlRows.length} open KDS ticket(s)`);
check(
  "the other tenant's kitchen reaches a DECIDED state — empty state, a board, or a refusal; never a spinner",
  (ctrlState.emptyState || ctrlState.redirectedToABoard || ctrlState.tiles > 0 || ctrlState.denied) &&
    ctrlState.alerts.length === 0 &&
    !ctrlState.loading,
  true,
);
check("...and it is honestly empty — no open tickets behind it", ctrlRows.length, 0);
if (ctrlState.redirectedToABoard || ctrlState.tiles > 0) {
  // whatever it shows, it must show Control Bistro's own numbers
  const ctrlTruth = truthFor(ctrlRows, null);
  console.log(`  Control Bistro board header: ${JSON.stringify(ctrlState.boardHeader)}, truth ${ctrlTruth.tickets} tickets`);
  if (ctrlState.boardHeader) {
    check(
      "the other tenant's board header equals the other tenant's truth",
      Number((/(\d+)/.exec(ctrlState.boardHeader) ?? [])[1]),
      ctrlTruth.tickets,
    );
  }
}
report.control = { ...ctrlState, branchId: ctrlBranch, rows: ctrlRows.length };

writeFileSync(`${OUT}/r4-paging.json`, JSON.stringify({ pass, fail, failures, report }, null, 2));
console.log(`\n${pass} passed, ${fail} failed`);
for (const f of failures) console.log("  FAILURE " + f);
await browser.close();
process.exit(fail ? 1 : 0);
