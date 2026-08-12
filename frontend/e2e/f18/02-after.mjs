/*
 * F18 step 2 — THE PASS, driven.
 *
 * As kitchen@terrace.local:
 *   a. open /app/kitchen/expo and find the split check from step 1, ONCE, as a whole,
 *      naming which station still owes and which is ready;
 *   b. in a SECOND TAB, bump the last outstanding item on that station's own board;
 *   c. watch the pass flip to ready-to-run WITHOUT A RELOAD — proven by a sentinel written
 *      into the page before the bump and re-read after it, plus performance.timeOrigin.
 *
 * Also captures 390 / 768 / 1440 and both themes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log, OUT } from "./lib.mjs";

const st = JSON.parse(readFileSync(resolve(OUT, "_f18.json"), "utf8"));
const { orderNo, orderId, branchId } = st;
log("working check:", orderNo, orderId);

const browser = await newBrowser();
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);

// ── a. the pass ──────────────────────────────────────────────────────────────
let tr = await go(kds, "/app/kitchen/expo", { waitMs: 7000 });
log("\n/app/kitchen/expo:", JSON.stringify(tr));
await shot(kds, "02a-pass-first-look");

const header = await kds.evaluate(() => ({
  boardPresent: !!document.querySelector('[data-testid="expo-board"]'),
  checks: document.querySelectorAll('[data-testid="expo-check"]').length,
  count: document.querySelector('[data-testid="expo-check-count"]')?.textContent?.trim(),
  ready: document.querySelector('[data-testid="expo-ready-count"]')?.textContent?.trim(),
  connection: document.querySelector('[data-testid="expo-connection"]')?.textContent?.trim(),
  connected: document
    .querySelector('[data-testid="expo-connection"]')
    ?.getAttribute("data-connected"),
  surfaceBg: getComputedStyle(document.querySelector('[data-testid="expo-board"]')).backgroundColor,
}));
log("pass header:", JSON.stringify(header, null, 1));

/** Everything the pass says about ONE check, read off the rendered card. */
async function readCheck(page, wantedOrderNo) {
  return page.evaluate((wanted) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="expo-check"]'));
    const card = cards.find((c) => c.getAttribute("data-order-no") === wanted);
    if (!card) return { found: false, cardsOnPass: cards.length };
    const stations = Array.from(card.querySelectorAll('[data-testid^="expo-station-"]'))
      .filter((n) => !n.getAttribute("data-testid").endsWith("-state"))
      .map((n) => ({
        station: n.getAttribute("data-testid").replace("expo-station-", ""),
        state: n.getAttribute("data-state"),
        says: n
          .querySelector('[data-testid$="-state"]')
          ?.textContent?.replace(/\s+/g, " ")
          .trim(),
        items: Array.from(n.querySelectorAll('[data-testid^="expo-item-"]')).map((i) =>
          i.textContent.replace(/\s+/g, " ").trim(),
        ),
      }));
    return {
      found: true,
      cardsForThisOrder: cards.filter((c) => c.getAttribute("data-order-no") === wanted).length,
      cardsOnPass: cards.length,
      state: card.getAttribute("data-state"),
      stationsOwing: card.getAttribute("data-stations-owing"),
      aging: card.getAttribute("data-aging"),
      headline: card
        .querySelector('[data-testid="expo-check-headline"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      header: card.querySelector("h2")?.textContent?.trim(),
      table: card.querySelector("h2")?.parentElement?.textContent?.replace(/\s+/g, " ").trim(),
      stations,
    };
  }, wantedOrderNo);
}

// The pass can be long; put the card on screen for the screenshot.
await kds.evaluate((wanted) => {
  const card = Array.from(document.querySelectorAll('[data-testid="expo-check"]')).find(
    (c) => c.getAttribute("data-order-no") === wanted,
  );
  card?.scrollIntoView({ block: "center" });
}, orderNo);
await kds.waitForTimeout(600);
await shot(kds, "02b-pass-half-ready");

const before = await readCheck(kds, orderNo);
log("\nTHE CHECK ON THE PASS (before the last bump):\n", JSON.stringify(before, null, 1));

// ── b. a sentinel, so "no reload" is a measurement and not a hope ────────────
const sentinel = `f18-${Date.now()}`;
const timeOriginBefore = await kds.evaluate((s) => {
  window.__F18_SENTINEL__ = s;
  return performance.timeOrigin;
}, sentinel);
log("\nsentinel planted:", sentinel, "timeOrigin:", timeOriginBefore);

// ── c. the last outstanding item, bumped on ITS OWN BOARD in a second tab ────
const owing = before.stations?.find((s) => s.state !== "ready");
log("station still owing:", JSON.stringify(owing));

const board = await kds.context().newPage();
board.on("console", () => {});
await board.goto(`http://localhost:3000/app/kitchen/${owing.station}`, {
  waitUntil: "domcontentloaded",
});
await board.waitForTimeout(7000);
await shot(board, "02c-station-board-owing");

// Find the fragment for our order and press its move-forward control until Ready.
for (let press = 0; press < 4; press += 1) {
  const moved = await board.evaluate((wanted) => {
    const frag = Array.from(document.querySelectorAll('[data-testid^="kds-fragment-"]')).find((f) =>
      f.textContent.includes(wanted),
    );
    if (!frag) return { ok: false, why: "no fragment for this order on the board" };
    const btn = frag.querySelector('[data-testid^="column-move-"]');
    if (!btn) return { ok: false, why: "no move control (already Ready)" };
    const label = btn.textContent.replace(/\s+/g, " ").trim();
    btn.click();
    return { ok: true, label };
  }, orderNo);
  log(`  press ${press + 1}:`, JSON.stringify(moved));
  if (!moved.ok) break;
  await board.waitForTimeout(2500);
}
await shot(board, "02d-station-board-after-bump");

const serverSide = await apiGet(
  board,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`,
);
log(
  "\nserver-side, after the bump:",
  JSON.stringify(
    (serverSide.body?.content ?? [])
      .filter((t) => t.orderId === orderId)
      .map((t) => ({
        station: t.stationCode,
        status: t.status,
        items: t.items.map((i) => `${i.qty}x ${i.name} [${i.status}]`),
      })),
    null,
    1,
  ),
);

// ── the pass tab has NOT been touched since. Watch it flip. ─────────────────
const started = Date.now();
let flipped = null;
for (let i = 0; i < 40; i += 1) {
  const now = await readCheck(kds, orderNo);
  if (now.state === "ready") {
    flipped = { afterMs: Date.now() - started, ...now };
    break;
  }
  await kds.waitForTimeout(500);
}

const stillAlive = await kds.evaluate(() => ({
  sentinel: window.__F18_SENTINEL__ ?? null,
  timeOrigin: performance.timeOrigin,
  navigations: performance.getEntriesByType("navigation").length,
}));

log("\nTHE CHECK ON THE PASS (after the last bump):\n", JSON.stringify(flipped, null, 1));
log("no-reload proof:", JSON.stringify(stillAlive));
log("  sentinel survived:", stillAlive.sentinel === sentinel);
log("  timeOrigin unchanged:", stillAlive.timeOrigin === timeOriginBefore);

await kds.evaluate((wanted) => {
  const card = Array.from(document.querySelectorAll('[data-testid="expo-check"]')).find(
    (c) => c.getAttribute("data-order-no") === wanted,
  );
  card?.scrollIntoView({ block: "center" });
}, orderNo);
await kds.waitForTimeout(400);
await shot(kds, "02e-pass-ready-to-run");

// ── the filters ─────────────────────────────────────────────────────────────
await kds.locator('[data-testid="expo-filter-ready"]').click();
await kds.waitForTimeout(1200);
const readyOnly = await kds.evaluate(() => ({
  cards: document.querySelectorAll('[data-testid="expo-check"]').length,
  hasOurs: !!document.querySelector(`[data-testid="expo-check"]`),
}));
log("\nready-to-run filter:", JSON.stringify(readyOnly));
await shot(kds, "02f-pass-ready-filter");
await kds.locator('[data-testid="expo-filter-all"]').click();
await kds.waitForTimeout(800);

// ── responsive + theme ──────────────────────────────────────────────────────
for (const [w, h, label] of [
  [390, 844, "390"],
  [768, 1024, "768"],
  [1440, 950, "1440"],
]) {
  await kds.setViewportSize({ width: w, height: h });
  await kds.waitForTimeout(900);
  const overflow = await kds.evaluate(() => ({
    docScrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    boardBg: getComputedStyle(document.querySelector('[data-testid="expo-board"]')).backgroundColor,
    headlineColor: getComputedStyle(
      document.querySelector('[data-testid="expo-check-headline"] span'),
    ).color,
  }));
  log(`  ${label}px:`, JSON.stringify(overflow), "horizontal overflow:", overflow.docScrollW > overflow.clientW);
  await shot(kds, `02g-pass-${label}`);
}

await kds.setViewportSize({ width: 1440, height: 950 });
for (const theme of ["light", "dark"]) {
  await kds.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await kds.waitForTimeout(700);
  const c = await kds.evaluate(() => {
    const board = document.querySelector('[data-testid="expo-board"]');
    const card = document.querySelector('[data-testid="expo-check"] h2');
    return {
      boardBg: getComputedStyle(board).backgroundColor,
      titleColor: card ? getComputedStyle(card).color : null,
    };
  });
  log(`  theme=${theme}:`, JSON.stringify(c));
  await shot(kds, `02h-pass-theme-${theme}`);
}

await browser.close();
log("\nAFTER captured.");
