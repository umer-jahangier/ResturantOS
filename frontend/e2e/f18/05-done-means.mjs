/*
 * F18 — DONE MEANS, in one run, entirely by clicking.
 *
 *   1. Cashier rings ONE check whose lines route to TWO stations, and fires it.
 *   2. kitchen@terrace.local opens THE PASS: the check appears ONCE, as a whole, naming which
 *      station still owes and which is ready. It is not ready.
 *   3. On station A's own board, in a second tab, that station's line is bumped to Ready with
 *      real clicks. The pass still says the check is not ready — one station owes.
 *   4. On station B's board, the LAST outstanding line is bumped to Ready.
 *   5. The pass — never reloaded, proven by a sentinel and by performance.timeOrigin — flips
 *      to "All ready — run it", and the check STAYS on the pass.
 *
 * Every read is on the signed-in persona's own bearer. No token injection, no mock.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log } from "./lib.mjs";

const browser = await newBrowser();

// ── 1. ring a split check ────────────────────────────────────────────────────
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
let tr = await go(cash, "/app/pos", { waitMs: 9000 });
log("/app/pos:", JSON.stringify(tr));

await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(600);
const trigger = cash.locator("[data-testid=table-select-trigger]");
if (await trigger.count()) {
  await trigger.click();
  await cash.waitForTimeout(1300);
  const opts = await cash.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
      id: n.getAttribute("data-testid"),
      label: n.innerText.replace(/\s+/g, " ").trim(),
      disabled: n.getAttribute("aria-disabled") === "true",
    })),
  );
  const free = opts.find((o) => !o.disabled);
  log("tables:", JSON.stringify(opts.map((o) => `${o.label}${o.disabled ? " (disabled)" : ""}`)));
  if (free) {
    await cash.locator(`[data-testid="${free.id}"]`).click();
    log("  seated at", free.label);
  } else {
    await cash.keyboard.press("Escape");
    log("  ! every table at this branch is Occupied and the picker disables those, so this");
    log("    check carries no table number. The pass still renders one for checks that have it.");
  }
  await cash.waitForTimeout(900);
}

/**
 * A dish tile may now open a MODIFIER dialog (another agent's in-flight work landed mid-run
 * and this harness broke on it: the dialog's overlay intercepted the next tile's click).
 * Confirm it if it appears, so the harness rings a check rather than dying on someone else's
 * new screen.
 */
async function clearModifierDialog(page) {
  const dialog = page.locator('[data-testid="modifier-dialog"]');
  if ((await dialog.count()) === 0) return;
  if (!(await dialog.first().isVisible().catch(() => false))) return;
  const add = page.locator('[data-testid="modifier-dialog-add"]').first();
  // A FORCED group leaves "Add to order" disabled until something is chosen. Pick options,
  // one at a time, until it enables — the dialog itself decides when the line is legal.
  const options = dialog.locator('[data-testid^="modifier-option-"]');
  const n = await options.count();
  for (let i = 0; i < n; i += 1) {
    if (await add.isEnabled().catch(() => false)) break;
    await options.nth(i).click().catch(() => {});
    await page.waitForTimeout(350);
  }
  if (await add.isEnabled().catch(() => false)) {
    await add.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(1000);
}

async function tapDish(page, name) {
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30000 });
  const tile = tiles.filter({ hasText: name });
  if ((await tile.count()) === 0) throw new Error(`no tile for ${name}`);
  await tile.first().scrollIntoViewIfNeeded();
  await tile.first().click();
  await page.waitForTimeout(700);
  await clearModifierDialog(page);
}
await tapDish(cash, "Audit Item 52235"); // routes to PANTRY1
await tapDish(cash, "Butter Naan"); //      routes to GRILL
await shot(cash, "05a-cart");
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(8000);
await shot(cash, "05b-fired");

const orderNo = await cash.evaluate(
  () => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null,
);
if (!orderNo) throw new Error("could not read the order number off the drawer");
log("\n→ CHECK:", orderNo);

const branchId = await cash.evaluate(async () => {
  const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json();
  const token = j?.accessToken ?? j?.data?.accessToken;
  return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).branch_id;
});

// ── 2. the pass ──────────────────────────────────────────────────────────────
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);

// Reached by CLICKING, from the screen a cook actually lands on — a pass nobody can find is
// the same as no pass, and "nobody could find the whole check" is the finding.
tr = await go(kds, "/app/kitchen", { waitMs: 8000 });
log("/app/kitchen (the cook's home screen):", JSON.stringify(tr));
await shot(kds, "05c0-kitchen-home-offers-the-pass");
const passButton = kds.locator('[data-testid="kds-open-pass"]');
log("the pass is offered here:", await passButton.count(), "→", (await passButton.first().innerText()).replace(/\s+/g, " ").trim());
await passButton.first().click();
await kds.waitForTimeout(9000);
log("landed on:", kds.url());
if (!kds.url().endsWith("/app/kitchen/expo")) throw new Error("the pass button did not open the pass");

async function readCheck(page) {
  return page.evaluate((wanted) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="expo-check"]'));
    const mine = cards.filter((c) => c.getAttribute("data-order-no") === wanted);
    if (mine.length === 0) return { found: false, cardsOnPass: cards.length };
    const card = mine[0];
    return {
      found: true,
      copiesOnPass: mine.length,
      state: card.getAttribute("data-state"),
      stationsOwing: card.getAttribute("data-stations-owing"),
      headline: card
        .querySelector('[data-testid="expo-check-headline"]')
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
      identity: card.querySelector("h2")?.parentElement?.textContent?.replace(/\s+/g, " ").trim(),
      stations: Array.from(card.querySelectorAll('[data-testid^="expo-station-"]'))
        .filter((n) => !n.getAttribute("data-testid").endsWith("-state"))
        .map((n) => ({
          code: n.getAttribute("data-testid").replace("expo-station-", ""),
          state: n.getAttribute("data-state"),
          says: n.querySelector('[data-testid$="-state"]')?.textContent?.replace(/\s+/g, " ").trim(),
          lines: Array.from(n.querySelectorAll('[data-testid^="expo-item-"]')).map((i) =>
            i.textContent.replace(/\s+/g, " ").trim(),
          ),
          itemIds: Array.from(n.querySelectorAll('[data-testid^="expo-item-"]')).map((i) =>
            i.getAttribute("data-testid").replace("expo-item-", ""),
          ),
        })),
    };
  }, orderNo);
}

async function focus(page) {
  await page.evaluate((wanted) => {
    document
      .querySelector(`[data-testid="expo-check"][data-order-no="${wanted}"]`)
      ?.scrollIntoView({ block: "center" });
  }, orderNo);
  await page.waitForTimeout(600);
}

await focus(kds);
await shot(kds, "05c-pass-nothing-started");
log("\nPASS, straight after the fire:\n", JSON.stringify(await readCheck(kds), null, 1));

const connection = await kds.evaluate(() => ({
  says: document.querySelector('[data-testid="expo-connection"]')?.textContent?.trim(),
  connected: document
    .querySelector('[data-testid="expo-connection"]')
    ?.getAttribute("data-connected"),
}));
log("live feed:", JSON.stringify(connection));

// ── the sentinel: this tab is never touched again until the very end ────────
const sentinel = `f18-${Date.now()}`;
const t0 = await kds.evaluate((s) => {
  window.__F18_SENTINEL__ = s;
  return performance.timeOrigin;
}, sentinel);

// ── 3 & 4. bump each station's line to Ready, on that station's OWN board ───
//
// Every fact below is read off a RENDERED SCREEN — the pass names the stations, the pass
// names the lines, and the board is clicked. No HTTP read is used to decide anything, so the
// proof cannot be true of the API while being false of the product.
const board = await kds.context().newPage();

const opening = await readCheck(kds);
const stations = opening.stations;
log("\nstations this check split to (read off the pass):", JSON.stringify(stations.map((s) => s.code)));
if (stations.length < 2) throw new Error("the check did not split — nothing to prove");

for (const [index, station] of stations.entries()) {
  log(`\n── bumping ${station.code} on its own board ──`);
  await board.goto(`http://localhost:3000/app/kitchen/${station.code}`, {
    waitUntil: "domcontentloaded",
  });
  await board.waitForTimeout(8000);
  if (index === 0) await shot(board, "05d-board-station-a");

  for (const itemId of station.itemIds) {
    for (let press = 0; press < 4; press += 1) {
      const btn = board.locator(`[data-testid="column-move-${itemId}"]`).first();
      let visible = false;
      try {
        await btn.waitFor({ state: "visible", timeout: 12000 });
        visible = true;
      } catch {
        visible = false;
      }
      if (!visible) {
        log("   no move control left — this line is Ready");
        break;
      }
      const label = (await btn.innerText()).replace(/\s+/g, " ").trim();
      await btn.click();
      log(`   click "${label}"`);
      await board.waitForTimeout(2500);
    }
  }

  // The pass, still untouched — read it and say what it says.
  const seen = await readCheck(kds);
  log(`   PASS now says: ${seen.headline}   [state=${seen.state}, owing=${seen.stationsOwing}]`);
  log(`   stations: ${JSON.stringify(seen.stations.map((s) => `${s.code}=${s.state}`))}`);
  if (index === 0) {
    await focus(kds);
    await shot(kds, "05e-pass-half-ready");
    log("   ← THE SENTENCE THE PRODUCT COULD NOT SAY: one station done, the check NOT ready.");
  }
}
await shot(board, "05f-board-station-b-after");

// ── 5. the flip, on a tab that was never reloaded ───────────────────────────
const started = Date.now();
let flipped = null;
for (let i = 0; i < 80; i += 1) {
  const now = await readCheck(kds);
  if (now.state === "ready") {
    flipped = { withinMs: Date.now() - started, ...now };
    break;
  }
  await kds.waitForTimeout(200);
}
const alive = await kds.evaluate(() => ({
  sentinel: window.__F18_SENTINEL__ ?? null,
  timeOrigin: performance.timeOrigin,
  navigationEntries: performance.getEntriesByType("navigation").length,
}));

log("\nPASS, after the LAST outstanding line went ready:\n", JSON.stringify(flipped, null, 1));
log("\nno-reload proof");
log("  sentinel planted before any bump survived:", alive.sentinel === sentinel, `(${alive.sentinel})`);
log("  performance.timeOrigin unchanged:", alive.timeOrigin === t0);
log("  navigation entries (1 = the single original load):", alive.navigationEntries);

await focus(kds);
await shot(kds, "05g-pass-ready-to-run");

const persisted = await readCheck(kds);
log("\nthe check has NOT cleared:", JSON.stringify({ found: persisted.found, state: persisted.state }));

await browser.close();
log("\nDONE MEANS: driven.");
