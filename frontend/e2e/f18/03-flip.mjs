/*
 * F18 step 3 — THE FLIP, measured.
 *
 * The pass is open and untouched. On a SECOND TAB, on the owing station's own board, the
 * last outstanding item is bumped to Ready with a real click. The pass must flip to
 * ready-to-run without a reload, and the sentinel proves the tab was never reloaded.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log, OUT } from "./lib.mjs";

const st = JSON.parse(readFileSync(resolve(OUT, "_f18.json"), "utf8"));
const { orderNo, orderId, branchId } = st;
log("working check:", orderNo);

const browser = await newBrowser();
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);

async function ticketsOfOrder(page) {
  const r = await apiGet(
    page,
    `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`,
  );
  return (r.body?.content ?? []).filter((t) => t.orderId === orderId);
}

async function readCheck(page) {
  return page.evaluate((wanted) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="expo-check"]'));
    const card = cards.find((c) => c.getAttribute("data-order-no") === wanted);
    if (!card) return { found: false };
    return {
      found: true,
      copies: cards.filter((c) => c.getAttribute("data-order-no") === wanted).length,
      state: card.getAttribute("data-state"),
      stationsOwing: card.getAttribute("data-stations-owing"),
      headline: card
        .querySelector('[data-testid="expo-check-headline"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      stations: Array.from(card.querySelectorAll('[data-testid^="expo-station-"]'))
        .filter((n) => !n.getAttribute("data-testid").endsWith("-state"))
        .map(
          (n) =>
            `${n.getAttribute("data-testid").replace("expo-station-", "")}=${n.getAttribute("data-state")}`,
        ),
    };
  }, orderNo);
}

const tr = await go(kds, "/app/kitchen/expo", { waitMs: 8000 });
log("/app/kitchen/expo:", JSON.stringify(tr));

await kds.evaluate((wanted) => {
  const card = Array.from(document.querySelectorAll('[data-testid="expo-check"]')).find(
    (c) => c.getAttribute("data-order-no") === wanted,
  );
  card?.scrollIntoView({ block: "center" });
}, orderNo);
await kds.waitForTimeout(600);
await shot(kds, "03a-pass-before-flip");
log("\nBEFORE:", JSON.stringify(await readCheck(kds)));
log("server:", JSON.stringify((await ticketsOfOrder(kds)).map((t) => `${t.stationCode}=${t.status}:${t.items.map((i) => i.status)}`)));

// ── sentinel ────────────────────────────────────────────────────────────────
const sentinel = `f18-${Date.now()}`;
const t0 = await kds.evaluate((s) => {
  window.__F18_SENTINEL__ = s;
  return performance.timeOrigin;
}, sentinel);

// ── the bump, on the owing station's OWN board, in a second tab ─────────────
const outstanding = (await ticketsOfOrder(kds))
  .flatMap((t) => t.items.map((i) => ({ ...i, station: t.stationCode, ticketId: t.id })))
  .filter((i) => i.status !== "READY" && i.status !== "SERVED" && i.status !== "CANCELLED");
log("\noutstanding lines:", JSON.stringify(outstanding.map((i) => `${i.station} ${i.name} ${i.status}`)));
const target = outstanding[0];
if (!target) throw new Error("nothing outstanding — reset the check first");

const board = await kds.context().newPage();
await board.goto(`http://localhost:3000/app/kitchen/${target.station}`, {
  waitUntil: "domcontentloaded",
});
await board.waitForTimeout(8000);
await shot(board, "03b-station-board");

const STAGES = { PENDING: 3, ACCEPTED: 2, PREPARING: 2, COOKING: 2 };
let presses = STAGES[target.status] ?? 3;
for (let i = 0; i < presses + 2; i += 1) {
  const before = (await ticketsOfOrder(board))
    .flatMap((t) => t.items)
    .find((it) => it.id === target.id);
  if (before.status === "READY") {
    log(`  line is READY after ${i} presses`);
    break;
  }
  const btn = board.locator(`[data-testid="column-move-${target.id}"]`);
  await btn.first().waitFor({ state: "visible", timeout: 20000 });
  const label = (await btn.first().innerText()).replace(/\s+/g, " ").trim();
  await btn.first().click();
  log(`  press ${i + 1}: "${label}" (was ${before.status})`);
  // Wait for the SERVER to confirm the transition before pressing again — the board
  // collapses a bumped card optimistically, so the DOM is not the authority here.
  for (let w = 0; w < 20; w += 1) {
    await board.waitForTimeout(400);
    const now = (await ticketsOfOrder(board))
      .flatMap((t) => t.items)
      .find((it) => it.id === target.id);
    if (now.status !== before.status) {
      log(`     → ${now.status}`);
      break;
    }
  }
}
await shot(board, "03c-station-board-after");

const finalServer = await ticketsOfOrder(board);
log(
  "\nserver, after the bump:",
  JSON.stringify(
    finalServer.map((t) => ({
      station: t.stationCode,
      status: t.status,
      items: t.items.map((i) => `${i.qty}x ${i.name} [${i.status}]`),
    })),
    null,
    1,
  ),
);

// ── the pass tab, never touched since the sentinel ──────────────────────────
const started = Date.now();
let flipped = null;
for (let i = 0; i < 60; i += 1) {
  const now = await readCheck(kds);
  if (now.state === "ready") {
    flipped = { afterMs: Date.now() - started, ...now };
    break;
  }
  await kds.waitForTimeout(250);
}
const alive = await kds.evaluate(() => ({
  sentinel: window.__F18_SENTINEL__ ?? null,
  timeOrigin: performance.timeOrigin,
  navigations: performance.getEntriesByType("navigation").length,
}));

log("\nAFTER:", JSON.stringify(flipped, null, 1));
log("no-reload proof:", JSON.stringify(alive));
log("  sentinel survived:", alive.sentinel === sentinel);
log("  timeOrigin unchanged:", alive.timeOrigin === t0);
log("  navigation entries (1 = the original load):", alive.navigations);

await kds.evaluate((wanted) => {
  const card = Array.from(document.querySelectorAll('[data-testid="expo-check"]')).find(
    (c) => c.getAttribute("data-order-no") === wanted,
  );
  card?.scrollIntoView({ block: "center" });
}, orderNo);
await kds.waitForTimeout(400);
await shot(kds, "03d-pass-ready-to-run");

// It must NOT clear: running food is still somebody's job.
const stillThere = await readCheck(kds);
log("\nstill on the pass after going ready:", JSON.stringify(stillThere));

await browser.close();
log("\nFLIP captured.");
