/*
 * S1-08 PROOF — drives the DONE MEANS click path for real, in four Chromium contexts.
 *
 *   A  manager@terrace.local  → /app/menu/items          (the actor)
 *   B  cashier@terrace.local  → /app/pos, terminal tab, till OPEN, the category containing
 *                               "Butter Naan" SELECTED. B is never reloaded and never clicked
 *                               after the baseline — every observation of B is a poll of the DOM.
 *   C  cashier@terrace.local  → a second cashier session used ONLY to inspect the already-open
 *                               order while it is 86'd, so B is left undisturbed.
 *   D  kitchen@terrace.local  → /app/kitchen/DEFAULT, to confirm the outstanding line still
 *                               shows on the board.
 *
 * Sequence:
 *   1. B rings a Butter Naan and sends it to the kitchen — an order now HOLDS the line.
 *   2. A deactivates Butter Naan.
 *   3. B is polled +2/+5/+10/+20s untouched: the tile must be gone.
 *   4. C confirms the open order still carries the line at the right name and price.
 *   5. D confirms the kitchen board still shows it.
 *   6. A reactivates. B is polled again untouched: the tile must come back.
 *
 *   node e2e/repair/s1-08-proof.mjs
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import {
  BASE,
  MANAGER,
  CASHIER,
  TARGET_ITEM,
  outDir,
  shot,
  login,
  ensureTillOpen,
  probeTill,
  fmt,
  toggleItem,
  watch,
} from "./s1-08-lib.mjs";

const DIR = outDir("after");
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const KITCHEN = {
  slug: "floating-terrace",
  email: "kitchen@terrace.local",
  password: "Terrace#Kitchen1",
};

const browser = await chromium.launch({ headless: true });
const ctx = async () => (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const A = await ctx();
const B = await ctx();
const C = await ctx();
const D = await ctx();

/** Only the POS socket's frames — the Next dev HMR socket is noise here. */
const posFrames = [];
B.on("websocket", (ws) => {
  if (!ws.url().includes("/pos/ws/orders/")) return;
  say(`  [B] POS socket open: ${ws.url().split("?")[0]}`);
  ws.on("framereceived", (f) => {
    const s = typeof f.payload === "string" ? f.payload : "(binary)";
    posFrames.push(s);
    say(`  [B] POS frame: ${s.slice(0, 220)}`);
  });
});

const result = { item: TARGET_ITEM, steps: {} };

try {
  // ── A ──────────────────────────────────────────────────────────────────────────────────
  say("== A: manager → /app/menu/items ==");
  await login(A, MANAGER);
  await A.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
  await A.waitForTimeout(3000);
  await shot(A, DIR, "01-A-menu-items");

  // ── B ──────────────────────────────────────────────────────────────────────────────────
  say("== B: cashier → /app/pos ==");
  await login(B, CASHIER);
  await B.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await B.waitForTimeout(3500);
  say(`  B: till = ${await ensureTillOpen(B)}`);
  await B.waitForTimeout(2500);

  // Select the category that CONTAINS the item, exactly as DONE MEANS requires — an "All"
  // grid would prove less, because "All" is the one query whose key has categoryId undefined.
  const category = await selectCategoryContaining(B, TARGET_ITEM);
  say(`  B: category pill selected = "${category}"`);
  result.steps.category = category;

  // ── 1. an order that HOLDS the line ────────────────────────────────────────────────────
  say(`== B: ring one "${TARGET_ITEM}" and Send to Kitchen ==`);
  await tapItem(B, TARGET_ITEM);
  await B.waitForTimeout(600);
  await B.locator('[data-testid="send-to-kitchen-button"]').first().click();
  await B.waitForTimeout(5000);
  await shot(B, DIR, "02-B-order-sent");
  const orderNo = await readOrderNo(B);
  say(`  B: order = ${orderNo ?? "(no order no read)"} `);
  result.steps.orderNo = orderNo;

  // Back to a clean terminal so the grid is what we are watching. This is the LAST click on B.
  await B.reload({ waitUntil: "domcontentloaded" });
  await B.waitForTimeout(4500);
  const cat2 = await selectCategoryContaining(B, TARGET_ITEM);
  say(`  B: category re-selected = "${cat2}" (last interaction with B)`);

  const baseline = await probeTill(B, TARGET_ITEM);
  say(`  B baseline: ${fmt(baseline)}`);
  await shot(B, DIR, "03-B-baseline");
  if (!baseline.target) throw new Error(`"${TARGET_ITEM}" not on the grid at baseline`);
  result.steps.baseline = { tiles: baseline.n, present: true };

  // ── 2 + 3. 86 it, and watch B without touching it ──────────────────────────────────────
  say(`== A: deactivate "${TARGET_ITEM}" ==`);
  const act1 = await toggleItem(A, TARGET_ITEM);
  say(`  A clicked: ${act1}`);
  await shot(A, DIR, "04-A-deactivated");

  say("== B: WATCHED, NOT TOUCHED ==");
  const off = await watch(B, TARGET_ITEM, DIR, "05-B-after-86", [1, 2, 5, 10, 20]);
  result.steps.afterDeactivate = off.map((o) => ({ t: o.t, present: !!o.target, tiles: o.n }));
  const goneAt = off.find((o) => !o.target);
  say(
    goneAt
      ? `  RESULT: tile GONE by +${goneAt.t}s with no reload and no click`
      : "  RESULT: tile STILL PRESENT at +20s — not fixed",
  );
  if (!goneAt) throw new Error("tile did not disappear");

  // ── 4. the order already holding the line ──────────────────────────────────────────────
  //
  // A SECOND cashier session, so B is never touched. The order is found by SEARCHING for its
  // number: the first row of Order Management is whatever order the branch created most
  // recently, and with ten agents driving this stack that is somebody else's — the first
  // attempt at this check opened ORD-…-0094 and reported the line missing from an order that
  // never had it.
  say("== C: the open order while the item is 86'd ==");
  await login(C, CASHIER);
  await C.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await C.waitForTimeout(4000);
  await C.locator("button", { hasText: "Order Management" }).first().click();
  await C.waitForTimeout(3500);
  if (orderNo) {
    await C.locator('[data-testid="order-management-search"]').first().fill(orderNo);
    await C.waitForTimeout(3000);
  }
  await shot(C, DIR, "06-C-order-list");
  const rowsShown = await C.evaluate((no) => ({
    found: no ? document.body.innerText.includes(no) : false,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent?.trim()),
    openButtons: document.querySelectorAll('[data-testid^="open-order-"]').length,
  }), orderNo);
  say(`  C: search "${orderNo}" → found=${rowsShown.found} rows=${rowsShown.openButtons} alerts=${rowsShown.alerts.length}`);

  const open = C.locator(`[data-testid^="open-order-"]`).first();
  if (await open.count()) {
    await open.click();
    await C.waitForTimeout(3500);
  }
  const lineOk = await C.evaluate((args) => {
    const t = document.body.innerText;
    return {
      isRightOrder: t.includes(args.no),
      // A 86'd item must not blank its own historic line: itemNameSnapshot and
      // unitPriceSnapshot are columns ON the order, not lookups through the menu.
      hasLine: t.includes(args.needle),
      // The price the line was SOLD at, read off the screen rather than assumed.
      priceOnLine: (t.match(/Rs\s*[\d,]+\.\d\d/g) || []).slice(0, 4),
      excerpt: t.slice(0, 1200),
    };
  }, { needle: TARGET_ITEM, no: orderNo ?? "" });
  say(`  C: detail is order ${orderNo}=${lineOk.isRightOrder}, shows "${TARGET_ITEM}"=${lineOk.hasLine}, prices on screen=${JSON.stringify(lineOk.priceOnLine)}`);
  await shot(C, DIR, "07-C-order-detail");
  result.steps.orderIntact = lineOk.isRightOrder && lineOk.hasLine;
  result.steps.orderPricesOnScreen = lineOk.priceOnLine;

  // ── 5. the kitchen board ───────────────────────────────────────────────────────────────
  //
  // MANAGER, not kitchen@terrace.local. The kitchen persona is currently station-scoped to
  // PANTRY1 by another agent's in-flight station-registry work, so it is refused the DEFAULT
  // board — "KDS WebSocket refused: station … outside the caller's assigned scope" in
  // kitchen-service.log. Reading that refusal as "the board is empty" is exactly the
  // wrong-persona trap; the manager holds no station scope and sees the whole board.
  say("== D: kitchen board (manager — kitchen@ is scoped to PANTRY1 right now) ==");
  await login(D, MANAGER);
  await D.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await D.waitForTimeout(6000);
  const kds = await walkForOrder(D, orderNo, TARGET_ITEM);
  say(`  D: ${kds.summary}`);
  await shot(D, DIR, "08-D-kitchen-board");
  result.steps.kitchen = kds;

  // ── 6. put it back ─────────────────────────────────────────────────────────────────────
  say(`== A: reactivate "${TARGET_ITEM}" ==`);
  const showInactive = A.locator('input[type="checkbox"]').first();
  if (await showInactive.count()) await showInactive.check();
  await A.waitForTimeout(1200);
  const act2 = await toggleItem(A, TARGET_ITEM);
  say(`  A clicked: ${act2}`);
  await shot(A, DIR, "09-A-reactivated");

  say("== B: WATCHED, STILL NOT TOUCHED ==");
  const back = await watch(B, TARGET_ITEM, DIR, "10-B-after-restore", [1, 2, 5, 10, 20]);
  result.steps.afterReactivate = back.map((o) => ({ t: o.t, present: !!o.target, tiles: o.n }));
  const backAt = back.find((o) => o.target);
  say(
    backAt
      ? `  RESULT: tile BACK by +${backAt.t}s with no reload and no click`
      : "  RESULT: tile did NOT come back",
  );

  result.posFrames = posFrames.slice(0, 8);
  result.posFrameCount = posFrames.length;
  result.verdict =
    goneAt && backAt && result.steps.orderIntact && kds.ok ? "PASS" : "PARTIAL";
  say(`== VERDICT: ${result.verdict} (POS frames seen on B: ${posFrames.length}) ==`);
} catch (e) {
  say(`FATAL: ${e.message}`);
  result.verdict = "FAIL";
  result.error = e.message;
  for (const [n, p] of [["A", A], ["B", B], ["C", C], ["D", D]]) {
    try {
      await shot(p, DIR, `zz-${n}-fatal`);
    } catch {}
  }
} finally {
  writeFileSync(`${DIR}/RESULT.json`, JSON.stringify(result, null, 2));
  writeFileSync(`${DIR}/RUN-LOG.txt`, log.join("\n"));
  await browser.close();
}

// ── helpers that need page context ────────────────────────────────────────────────────────

/** Clicks the category pill whose category actually contains the item, and returns its label. */
async function selectCategoryContaining(page, itemName) {
  const pills = page.locator('button:below(input[aria-label="Search menu"])');
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => t && t.length < 30),
  );
  // Walk the pills; stop on the first whose grid contains the item.
  const count = await pills.count();
  for (let i = 0; i < Math.min(count, 20); i += 1) {
    const label = (await pills.nth(i).textContent())?.trim() ?? "";
    if (!label || label === "All" || label === "Clear All") continue;
    await pills.nth(i).click();
    await page.waitForTimeout(1200);
    const p = await probeTill(page, itemName);
    if (p.target) return label;
  }
  void labels;
  throw new Error(`no category pill contains "${itemName}"`);
}

async function tapItem(page, itemName) {
  const tile = page
    .locator('[data-testid="menu-grid"] button[aria-pressed]')
    .filter({ hasText: itemName })
    .first();
  await tile.waitFor({ state: "visible", timeout: 10000 });
  await tile.click();
}

/**
 * Walks every page of the board with PageDown looking for the ticket. The board pages, and
 * 80+ tickets means the freshly-fired one is not on page 1 — asserting only on page 1 would
 * report "not on the board" for a ticket that is on it.
 */
async function walkForOrder(page, orderNo, itemName, maxPages = 15) {
  let hit = null;
  let pages = 0;
  let count = "";
  for (let i = 0; i < maxPages; i += 1) {
    const p = await page.evaluate((args) => {
      const txt = (n) => (n?.textContent ?? "").trim();
      const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
      const match = cards.find((c) => args.no && (c.textContent ?? "").includes(args.no));
      return {
        unknownStation: !!document.querySelector('[data-testid="kds-station-unknown"]'),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(txt).filter(Boolean),
        cards: cards.length,
        ticketCount: txt(document.querySelector('[data-testid="kds-ticket-count"]')),
        pageIndicator: txt(document.querySelector('[data-testid="kds-page-indicator"]')),
        card: match ? (match.textContent ?? "").replace(/\s+/g, " ").slice(0, 240) : null,
        hasItem: match ? (match.textContent ?? "").includes(args.item) : false,
      };
    }, { no: orderNo, item: itemName });
    pages = i + 1;
    count = p.ticketCount;
    if (p.unknownStation || p.alerts.length) {
      return { summary: `BLOCKED unknownStation=${p.unknownStation} alerts=${JSON.stringify(p.alerts)}`, ok: false };
    }
    if (p.card) {
      hit = p;
      break;
    }
    const [cur, of] = (p.pageIndicator || "1 / 1").split("/").map((s) => Number(s.trim()));
    if (!of || cur >= of) break;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(500);
  }
  if (!hit) return { summary: `ticket ${orderNo} NOT found on ${pages} page(s), ${count}`, ok: false };
  return {
    summary: `ticket ${orderNo} on page ${pages} of ${count}; line "${itemName}" present=${hit.hasItem}; card="${hit.card}"`,
    ok: hit.hasItem,
    card: hit.card,
  };
}

async function readOrderNo(page) {
  return page.evaluate(() => {
    const m = document.body.innerText.match(/ORD-\d{8}-\d{4}/);
    return m ? m[0] : null;
  });
}
