/*
 * F2 — an adversarial RE-OPEN attempt, written by a verifier who was told to assume the fix
 * is incomplete.
 *
 * The prior pass drove: Active, Closed, Search, one void, manager + cashier. This drive goes
 * after what it did NOT touch:
 *
 *   1. RELOAD. Nothing in the prior report says the corrected row survives a page reload —
 *      the single most common way a "fixed" screen turns out to have been fixed in memory.
 *   2. The REFUNDED chip. A FOURTH server query (?status=REFUNDED) carrying the same settlement
 *      column as VOIDED. Never read.
 *   3. Every remaining chip — Draft, In Progress, Partially Served, Served, Paid. The action
 *      gating moved from derivedStatus to settlementStatus; a LIVE draft must still offer
 *      Cancel and Continue, or the fix over-corrected and broke the control it was protecting.
 *   4. A real DRAFT rung as DINE_IN with no table — the exact shape that used to read Takeaway,
 *      on a row that has never been fired.
 *   5. The WAITER persona, a third one.
 *   6. The CONTROL TENANT — can Floating Terrace's staff names be read from another tenant.
 *   7. Rendering rules driven with CONTROLLED data through response interception, including
 *      DELIVERY/PICKUP (unreachable from the terminal toggle) and the two failure contracts:
 *      a response missing `type` must ERROR, and a failed read must never say "No active orders".
 *
 * Every verdict here asserts rendered text or an accessible name. None asserts a prop, a class
 * or a test id, because all five defects were live in front of a manager while this component's
 * unit tests were green.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  openOrderManagement,
  readOrderTable,
  apiGet,
  apiSend,
  tokenOf,
  log,
} from "./f2-lib.mjs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F2");
const HEX8 = /^[0-9a-f]{8}$/i;
const STAGE = process.argv[2] ?? "all";

const CONTROL = {
  slug: "control-bistro-isolation-test-tenant",
  email: "manager@control.local",
  password: "Control#Manager1",
};
const WAITER = {
  slug: "floating-terrace",
  email: "waiter@terrace.local",
  password: "Terrace#Waiter1",
};

const LONG_REASON =
  "F2 re-open attempt — the table of eight sent back the whole order after the kitchen fired " +
  "the wrong protein for two of the mains, the duty manager comped the entire check rather " +
  "than re-firing at 21:40 with the pass already backed up, and this text is deliberately far " +
  "longer than the column is wide so that a clipped reason has nowhere to hide";

const report = { stage: STAGE, startedAt: new Date().toISOString(), verdicts: [], notes: {} };
const record = (name, pass, detail) => {
  report.verdicts.push({ name, pass, detail });
  log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const note = (k, v) => {
  report.notes[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

function flush() {
  const p = `${OUT}/_reopen-attempt-${STAGE}.json`;
  writeFileSync(p, JSON.stringify(report, null, 2));
  log(`\nwrote ${p}`);
  const fails = report.verdicts.filter((v) => !v.pass);
  log(`\n${report.verdicts.length - fails.length}/${report.verdicts.length} verdicts pass`);
  for (const f of fails) log(`  RED: ${f.name} — ${f.detail}`);
}

/** The Next dev-error overlay swallows clicks. Record whatever it said before removing it. */
async function clearDevOverlay(p) {
  const text = await p.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    if (!portal) return null;
    const t = (portal.shadowRoot?.textContent || portal.textContent || "").trim();
    portal.remove();
    return t.slice(0, 400);
  });
  if (text) log(`    [next dev overlay removed] ${text}`);
  return text;
}

async function posReady(p, tries = 8) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await go(p, "/app/pos", { waitMs: 8000, allowTrouble: true });
    await clearDevOverlay(p);
    const down = last.alerts.some((a) => /till is unavailable|not answering/i.test(a));
    if (!last.bad.length && !down) return last;
    log(`    /app/pos not ready (${i + 1}/${tries}): ${JSON.stringify(last.bad)}`);
    await p.waitForTimeout(9000);
  }
  throw new Error(`POS never came up: ${JSON.stringify(last)}`);
}

async function signIn(p, who) {
  try {
    await login(p, who);
  } catch (first) {
    log(`  ${who.email} refused once — waiting out the throttle: ${first.message}`);
    await p.waitForTimeout(70000);
    await login(p, who);
  }
}

/** Rows on screen, keyed by order number: the Order/Type, Server/Cashier, Items and actions. */
async function readRows(page) {
  const table = await readOrderTable(page);
  const idx = (re) => table.headers.findIndex((h) => re.test(h));
  const iOrder = idx(/Order/i);
  const iCash = idx(/Server\/Cashier/i);
  const iItems = idx(/^Items$/i);
  const iSettle = table.headers.findIndex((h) => /^(Voided|Refunded)$/i.test(h));
  const seen = {};
  const all = [];
  for (const r of table.rows) {
    const cell = (r.cells[iOrder]?.text ?? "").replace(/\n/g, " | ");
    const row = {
      orderCell: cell,
      cashier: (r.cells[iCash]?.text ?? "").trim(),
      items: (r.cells[iItems]?.text ?? "").replace(/\n/g, " / "),
      settlement: iSettle >= 0 ? (r.cells[iSettle]?.text ?? "").replace(/\n/g, " / ") : null,
      settlementOverflow: iSettle >= 0 ? (r.cells[iSettle]?.overflow ?? []) : [],
      actionButtons: (r.cells[r.cells.length - 1]?.buttons ?? []).map((b) => b.text),
    };
    all.push(row);
    // Key on the order NUMBER as printed — the first line of the Order/Type cell. Keying on an
    // `ORD-…` pattern would silently drop any row whose number does not match that shape.
    const no = /ORD-\d{8}-\d+/.exec(cell)?.[0] ?? (r.cells[iOrder]?.text ?? "").split("\n")[0].trim();
    if (no) seen[no] = row;
  }
  return { headers: table.headers, seen, all };
}

/**
 * One row, found by its order ID rather than its printed number.
 *
 * A DRAFT has `orderNo: null` and prints "New Order", so every draft on screen shares one
 * label and cannot be told apart by text. The row's own Open/Continue control carries the id.
 */
async function readRowByOrderId(page, orderId) {
  return page.evaluate((id) => {
    const btn = document.querySelector(`[data-testid="open-order-${id}"]`);
    if (!btn) return null;
    const tr = btn.closest("tr");
    if (!tr) return null;
    const tds = Array.from(tr.querySelectorAll("td"));
    return {
      cells: tds.map((td) => (td.innerText || "").trim().replace(/\n/g, " | ")),
      buttons: Array.from(tr.querySelectorAll("button")).map((b) => (b.textContent || "").trim()),
    };
  }, orderId);
}

/** Click a status chip and wait for its query, insisting the answer is not an outage. */
async function chip(page, id, waitMs = 3800) {
  for (let i = 0; i < 6; i++) {
    await page.locator(`[data-testid=status-filter-${id}]`).click();
    await page.waitForTimeout(waitMs);
    await clearDevOverlay(page);
    const alerts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
    );
    if (!alerts.length) return;
    log(`    chip ${id} answered with an outage (${i + 1}/6) — waiting for pos-service`);
    await requirePosUp();
    await orderMgmtReady(page);
  }
  throw new Error(`chip ${id} never answered without an outage alert`);
}

/**
 * Land on Order Management with a list that actually loaded.
 *
 * An outage renders `[role="alert"]` where the table belongs, and in a screenshot — and in a
 * scraped-cell JSON report — that is INDISTINGUISHABLE from "zero rows". The first run of this
 * harness scored eleven verdicts red against exactly that, while the three checks it had just
 * rung were sitting on the server, correctly typed and correctly named. Never score a read that
 * did not happen.
 */
async function orderMgmtReady(page, tries = 10, { requireRows = true } = {}) {
  for (let i = 0; i < tries; i++) {
    await requirePosUp();
    await go(page, "/app/pos", { waitMs: 6000, allowTrouble: true });
    await clearDevOverlay(page);
    const tab = page.locator('button:has-text("Order Management")');
    if (await tab.count()) {
      await tab.first().click();
      await page.waitForTimeout(4500);
    }
    await clearDevOverlay(page);
    const state = await page.evaluate(() => ({
      rows: document.querySelectorAll("table tbody tr").length,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        n.textContent.trim().slice(0, 90),
      ),
    }));
    // A genuinely empty list is a legitimate answer for a fresh tenant; an ALERT never is.
    if (state.alerts.length === 0 && (!requireRows || state.rows > 0)) return state;
    log(`    order management not ready (${i + 1}/${tries}): ${JSON.stringify(state)}`);
    await page.waitForTimeout(8000);
  }
  throw new Error("Order Management never rendered a loaded list — refusing to score an outage");
}

/**
 * Refuse to score anything while pos-service is down.
 *
 * Ten agents share this machine, and one of them restarted pos-service in the middle of this
 * harness's first run. Every rendering verdict went red and the screen said "The order list is
 * unavailable right now" — which in a JSON report is indistinguishable from "the fix does not
 * work". An outage must abort the run, never produce a verdict.
 */
async function requirePosUp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch("http://localhost:8084/actuator/health")
      .then((x) => x.json())
      .catch(() => null);
    if (r?.status === "UP") {
      note("pos-service", `UP before scoring (attempt ${i + 1})`);
      return;
    }
    log(`  pos-service not UP yet (${i + 1}/${tries}) — waiting rather than scoring an outage`);
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error("pos-service never came UP — refusing to score a verdict against an outage");
}

const browser = await newBrowser();

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE A — the manager rings, reads, RELOADS, and walks every chip
// ═══════════════════════════════════════════════════════════════════════════════
async function stageManager() {
  const page = await newPage(browser);
  let branchId = null;
  await signIn(page, PEOPLE.manager);

  // A free table of my own: ten agents keep all seven of this branch's tables occupied.
  const tp = await go(page, "/app/tables", { waitMs: 5000 });
  if (tp.bad.length) throw new Error(`/app/tables showed ${JSON.stringify(tp)}`);
  const freshTable = `RO-${Math.floor(Math.random() * 9000 + 1000)}`;
  await page.locator('button:has-text("Add table")').first().click();
  await page.waitForTimeout(1500);
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('input[name="tableNumber"]').fill(freshTable);
  await dlg.locator('input[name="capacity"]').fill("4");
  await dlg.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  note("freshTable", freshTable);

  await posReady(page);

  async function liveOrders(bearer, extra = "") {
    if (!branchId) {
      const req = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
      if (!req) return [];
      branchId = new URL(req.u).searchParams.get("branchId");
    }
    const r = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=40${extra}`, bearer);
    return r.body?.data ?? [];
  }
  const subOf = (b) =>
    JSON.parse(Buffer.from(b.split(".")[1], "base64url").toString()).sub ?? null;

  async function addTile(tiles, i) {
    await tiles.nth(i).click();
    await page.waitForTimeout(900);
    const d = page.locator("[data-testid=modifier-dialog][data-state=open]");
    if (!(await d.count())) return;
    const req = d.locator('button[aria-pressed], button[role="radio"], button[role="checkbox"]');
    const add = d.locator('button:has-text("Add to order")');
    for (let a = 0; a < 6; a++) {
      if (await add.first().isEnabled()) break;
      const n = await req.count();
      let clicked = false;
      for (let k = 0; k < n; k++) {
        const b = req.nth(k);
        if ((await b.getAttribute("aria-pressed")) === "true") continue;
        await b.click();
        await page.waitForTimeout(400);
        clicked = true;
        if (await add.first().isEnabled()) break;
      }
      if (!clicked) break;
    }
    if (!(await add.first().isEnabled()))
      throw new Error(`modifier dialog refused: ${(await d.innerText()).slice(0, 200)}`);
    await add.first().click();
    await page.locator("[data-testid=modifier-dialog]").waitFor({ state: "detached", timeout: 15000 });
    await page.waitForTimeout(500);
  }

  const rung = {};

  /** Build a cart. `fire=false` leaves it a DRAFT — never sent, still an order on the server. */
  async function ring(label, type, { withTable = false, fire = true, tiles: nTiles = [0, 0, 1] } = {}) {
    log(`\n=== ${label}: ${type}${withTable ? " @table" : ""}${fire ? "" : " (DRAFT, not fired)"} ===`);
    await posReady(page);
    await page.locator(`[data-testid=order-type-${type.toLowerCase()}]`).click();
    await page.waitForTimeout(900);

    let tableName = null;
    if (withTable) {
      await page.locator("[data-testid=table-select-trigger]").click();
      await page.waitForTimeout(1400);
      const opts = page.locator('[data-testid^="table-option-"]:not([aria-disabled="true"])');
      const n = await opts.count();
      if (n === 0) throw new Error("no AVAILABLE table in the picker");
      const wanted = opts.filter({ hasText: freshTable });
      const pick = (await wanted.count()) ? wanted.first() : opts.first();
      tableName = (await pick.getAttribute("data-testid")).replace("table-option-", "");
      await pick.click();
      await page
        .locator('[data-slot="dialog-overlay"]')
        .waitFor({ state: "detached", timeout: 15000 })
        .catch(async () => {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(1200);
        });
      await page.waitForTimeout(1200);
    }

    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 25000 });

    const bearer = await tokenOf(page);
    const me = subOf(bearer);
    // Track by orderID, never by orderNo: an unfired check has NO order number yet, so a
    // number-keyed diff can never see one appear.
    //
    // And the unfired check lives in the DEFAULT list, not in `?status=DRAFT`. The two "drafts"
    // are different things: `settlementStatus=DRAFT` is an empty cart with no items and no
    // number, while the Draft CHIP filters the active list on `derivedStatus=DRAFT` — a check
    // that HAS items and has simply not been fired. That is the row whose Cancel/Continue pair
    // the fix re-gated, so that is the row this must create.
    const beforeAll = new Set((await liveOrders(bearer)).map((o) => o.orderId));

    for (const t of nTiles) await addTile(tiles, t);
    await page.waitForTimeout(1200);

    if (fire) {
      await page.locator("[data-testid=send-to-kitchen-button]").click();
    }

    // The row must be MINE — same cashier, same type, same table — or a concurrent agent's
    // check gets scored as mine. That is exactly how the prior pass produced a false red.
    let mine = null;
    for (let i = 0; i < 20 && !mine; i++) {
      await page.waitForTimeout(1500);
      const pool = await liveOrders(bearer);
      mine =
        pool.find(
          (o) =>
            !beforeAll.has(o.orderId) &&
            o.cashierId === me &&
            o.type === type &&
            (tableName ? o.tableName === tableName : !o.tableName) &&
            (fire ? o.derivedStatus !== "DRAFT" : o.derivedStatus === "DRAFT"),
        ) ?? null;
    }
    if (!mine)
      throw new Error(`${label}: no NEW ${type} order of mine appeared (fire=${fire})`);
    rung[label] = {
      orderNo: mine.orderNo,
      orderId: mine.orderId,
      tableName,
      serverType: mine.type,
      serverCashier: mine.cashierId,
      serverCashierName: mine.cashierName ?? null,
      serverStatus: mine.status ?? mine.settlementStatus ?? null,
      itemQuantity: mine.itemQuantity,
      distinctItemCount: mine.distinctItemCount,
    };
    log(`  → ${JSON.stringify(rung[label])}`);
    return rung[label];
  }

  async function ringRetry(label, type, opts) {
    let last = null;
    for (let a = 1; a <= 3; a++) {
      try {
        return await ring(label, type, opts);
      } catch (e) {
        last = e;
        log(`  ring ${label} ${a}/3 failed: ${e.message.split("\n")[0]}`);
        await page.waitForTimeout(6000);
      }
    }
    throw last;
  }

  await ringRetry("dineInAtTable", "DINE_IN", { withTable: true });
  await ringRetry("dineInNoTable", "DINE_IN");
  await ringRetry("takeaway", "TAKEAWAY");
  // Never fired: this one stays DRAFT, which is the status whose row actions the fix re-gated.
  // Non-fatal — a draft that cannot be created is worth saying out loud, but it must not throw
  // away the three checks already rung and every verdict that depends on them.
  try {
    await ringRetry("draftDineInNoTable", "DINE_IN", { fire: false, tiles: [0] });
  } catch (e) {
    note("draft not created", e.message.split("\n")[0]);
  }
  report.notes.rung = rung;

  // ── Active chip ────────────────────────────────────────────────────────────
  note("active list state", await orderMgmtReady(page));
  await shot(page, "r1-active");

  let rows = await readRows(page);
  note("headers", rows.headers);

  const fired = ["dineInAtTable", "dineInNoTable", "takeaway"];
  for (const label of fired) {
    const r = rung[label];
    const on = rows.seen[r.orderNo];
    if (!on) {
      record(`active row present — ${label}`, false, `${r.orderNo} not on the Active list`);
      continue;
    }
    const want =
      label === "takeaway" ? "Takeaway" : r.tableName ? `Dine-in · ${r.tableName}` : "Dine-in";
    const hasType = on.orderCell.includes(want);
    record(
      `Order/Type reads "${want}" — ${label}`,
      hasType,
      `server type=${r.serverType} table=${r.tableName ?? "none"} → screen "${on.orderCell}"`,
    );
    if (label === "dineInNoTable") {
      record(
        "an untabled DINE_IN is NOT called Takeaway",
        !/Takeaway/i.test(on.orderCell),
        `screen "${on.orderCell}"`,
      );
    }
  }

  // Server/Cashier across EVERY row on screen, not only mine.
  const cashiers = rows.all.map((r) => r.cashier).filter(Boolean);
  const hexes = cashiers.filter((c) => HEX8.test(c));
  record(
    "Server/Cashier prints names, never an 8-char hex fragment (Active)",
    hexes.length === 0 && cashiers.length > 0,
    `${cashiers.length} rows, hex fragments=${hexes.length}; distinct=${JSON.stringify([...new Set(cashiers)])}`,
  );

  // Items nouns across every row.
  const badItems = rows.all
    .map((r) => r.items)
    .filter((s) => s && (/\b1 items\b/i.test(s) || /Items\s*\/.*Items/i.test(s) || /\bQty\b/.test(s)));
  record(
    'Items cell never says "1 Items" and never uses one noun twice',
    badItems.length === 0,
    `sample=${JSON.stringify([...new Set(rows.all.map((r) => r.items))].slice(0, 8))}`,
  );

  // ── THE RELOAD. Nothing in the prior report reloaded this screen. ──────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await clearDevOverlay(page);
  const afterReload = await orderMgmtReady(page);
  await shot(page, "r2-active-after-reload");
  const rows2 = await readRows(page);
  let persisted = 0;
  const persistDetail = [];
  for (const label of fired) {
    const r = rung[label];
    const on = rows2.seen[r.orderNo];
    const want =
      label === "takeaway" ? "Takeaway" : r.tableName ? `Dine-in · ${r.tableName}` : "Dine-in";
    const ok = !!on && on.orderCell.includes(want) && !HEX8.test(on.cashier) && !!on.cashier;
    if (ok) persisted++;
    persistDetail.push(`${label}:${on ? `"${on.orderCell}" / ${on.cashier}` : "MISSING"}`);
  }
  record(
    "the corrected rows SURVIVE a full page reload",
    persisted === fired.length && afterReload.alerts.length === 0,
    persistDetail.join(" ; "),
  );

  // ── The DRAFT chip: the status whose actions were re-gated ─────────────────
  await chip(page, "DRAFT");
  await shot(page, "r3-draft");
  const d = rung.draftDineInNoTable;
  // The terminal cannot produce an unfired check: its cart is LOCAL until "Send to Kitchen", so
  // no derivedStatus=DRAFT row is reachable from this stage. That state is built and scored in
  // its own stage (`node f2-reopen-attempt.mjs draft`), which creates the order, adds a line
  // without firing, and reads the row in the browser. Recording three reds here for a state the
  // harness could not set up would be noise, not a finding — so it is skipped and SAID.
  if (!d) note("draft verdicts", "skipped here — built and scored in the `draft` stage instead");
  // Found by ID: every draft prints "New Order", so text cannot tell one from another.
  const dOn = d ? await readRowByOrderId(page, d.orderId) : null;
  const dCell = dOn ? dOn.cells[0] : "";
  const dCash = dOn ? dOn.cells[3] : "";
  if (d) {
    record(
      "a live DRAFT dine-in with no table reads Dine-in",
      !!dOn && /Dine-in/.test(dCell) && !/Takeaway/i.test(dCell),
      dOn ? `"${dCell}"` : `draft ${d?.orderId ?? "(none)"} not under the Draft chip`,
    );
    record(
      "a LIVE draft still offers Cancel AND Continue (the re-gating did not over-correct)",
      !!dOn &&
        dOn.buttons.some((b) => /^Cancel$/i.test(b)) &&
        dOn.buttons.some((b) => /^Continue$/i.test(b)),
      dOn ? JSON.stringify(dOn.buttons) : "row missing",
    );
    record(
      "a live draft's Server/Cashier is a name, not a hex fragment",
      !!dOn && !!dCash && !HEX8.test(dCash),
      dOn ? `"${dCash}"` : "row missing",
    );
  }

  // ── Every remaining chip: does any of them show a hex id or a guessed type? ─
  const chipReport = {};
  for (const id of ["IN_PROGRESS", "PARTIALLY_SERVED", "SERVED", "CLOSED", "PAID", "VOIDED", "REFUNDED"]) {
    await chip(page, id);
    const r = await readRows(page);
    const trouble = await page.evaluate(() => {
      const t = document.body.innerText || "";
      return /Couldn.t load|Something went wrong|Access denied/i.test(t);
    });
    const cs = r.all.map((x) => x.cashier).filter(Boolean);
    const hex = cs.filter((c) => HEX8.test(c));
    const typesMissing = r.all.filter(
      (x) => !/Dine-in|Takeaway|Delivery|Pickup/i.test(x.orderCell),
    ).length;
    const bad1Items = r.all.filter((x) => /\b1 items\b/i.test(x.items)).length;
    chipReport[id] = {
      rows: r.all.length,
      hex: hex.length,
      typesMissing,
      bad1Items,
      trouble,
      buttons: [...new Set(r.all.flatMap((x) => x.actionButtons))],
      sampleCashiers: [...new Set(cs)].slice(0, 6),
    };
    log(`  chip ${id}: ${JSON.stringify(chipReport[id])}`);
    if (id === "REFUNDED" || id === "VOIDED" || id === "CLOSED") await shot(page, `r4-chip-${id}`);
  }
  report.notes.chips = chipReport;

  const allChips = Object.entries(chipReport);
  const withRows = allChips.filter(([, v]) => v.rows > 0);
  record(
    "no chip anywhere shows an 8-char hex in Server/Cashier",
    withRows.every(([, v]) => v.hex === 0),
    JSON.stringify(Object.fromEntries(allChips.map(([k, v]) => [k, `${v.rows}r/${v.hex}hex`]))),
  );
  record(
    "every row under every chip carries a type word",
    withRows.every(([, v]) => v.typesMissing === 0),
    JSON.stringify(Object.fromEntries(allChips.map(([k, v]) => [k, `${v.rows}r/${v.typesMissing}untyped`]))),
  );
  record(
    'no chip anywhere renders "1 items"',
    allChips.every(([, v]) => v.bad1Items === 0),
    JSON.stringify(Object.fromEntries(allChips.map(([k, v]) => [k, v.bad1Items]))),
  );
  const terminalChips = allChips.filter(([k]) => ["CLOSED", "VOIDED", "REFUNDED"].includes(k));
  record(
    "no terminal chip (Closed/Voided/Refunded) offers Cancel or Continue on any row",
    terminalChips.every(([, v]) => !v.buttons.some((b) => /^(Cancel|Continue)$/i.test(b))),
    JSON.stringify(Object.fromEntries(terminalChips.map(([k, v]) => [k, v.buttons]))),
  );
  const refunded = chipReport.REFUNDED;
  note(
    "REFUNDED chip",
    refunded.rows === 0
      ? "no refunded rows exist in this branch right now — the chip renders its own empty copy, not 'No active orders'"
      : `${refunded.rows} rows scored`,
  );

  // ── Cancel a live draft through the button, to leave nothing behind ────────
  if (d) {
    await chip(page, "DRAFT");
    const cancelBtn = page.locator(`[data-testid=cancel-draft-${d.orderId}]`);
    if (await cancelBtn.count()) {
      await cancelBtn.first().click();
      await page.waitForTimeout(800);
      await page.locator(`[data-testid=cancel-draft-confirm-${d.orderId}]`).first().click();
      await page.waitForTimeout(4500);
      await chip(page, "VOIDED");
      await shot(page, "r3b-cancelled-draft-voided");
      const nowVoided = await readRowByOrderId(page, d.orderId);
      record(
        "the draft I cancelled through the button is now VOIDED, still typed Dine-in, with NO Cancel/Continue",
        !!nowVoided &&
          /Dine-in/.test(nowVoided.cells[0]) &&
          !nowVoided.buttons.some((b) => /^(Cancel|Continue)$/i.test(b)),
        nowVoided
          ? `"${nowVoided.cells[0]}" buttons=${JSON.stringify(nowVoided.buttons)}`
          : "not found under Voided",
      );
    } else {
      record("cancel-draft control reachable on a live draft", false, "no cancel-draft button");
    }
  }

  // Console accounting, with the shared machine separated OUT rather than excused away.
  // A 503 or a dropped order WebSocket is a sibling agent restarting pos-service; it is noise
  // about this change and is recorded, not scored. Anything else is scored.
  const OUTAGE = /503|Service Unavailable|WebSocket connection to .ws:\/\/localhost:8080/i;
  const infra = page.__console.filter((c) => OUTAGE.test(c));
  const real = page.__console.filter((c) => !OUTAGE.test(c));
  report.notes.consoleErrors = { real, infraCount: infra.length, infraSample: infra.slice(0, 2) };
  record(
    "no console errors on the manager's drive that are not a sibling agent's pos-service restart",
    real.length === 0,
    `real=${JSON.stringify(real.slice(0, 4))} ; infra(503/ws)=${infra.length}`,
  );

  await page.context().close();
  return rung;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE B — the long-reason void, read by KEYBOARD, and read again after a reload
// ═══════════════════════════════════════════════════════════════════════════════
async function stageVoid(rung) {
  const page = await newPage(browser);
  await signIn(page, PEOPLE.manager);
  await orderMgmtReady(page);

  // Void a check that is still live, preferring the UNTABLED dine-in: on the Voided chip that is
  // precisely the row the walkthrough found mislabelled thirteen times in a row, so voiding it
  // scores the type on the settlement query rather than only on the active one.
  const bearer0 = await tokenOf(page);
  const listReq0 = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId0 = listReq0 ? new URL(listReq0.u).searchParams.get("branchId") : null;
  const liveNow = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId0}&size=60`, bearer0);
  const liveIds = new Set((liveNow.body?.data ?? []).map((o) => o.orderId));
  const target =
    [rung.dineInNoTable, rung.takeaway, rung.dineInAtTable].find((o) => o && liveIds.has(o.orderId)) ??
    null;
  if (!target) throw new Error("none of the checks I rang is still live — nothing to void");
  note("void target", target.orderNo);
  await page.locator("[data-testid=order-management-search]").fill(target.orderNo);
  await page.waitForTimeout(4000);
  await clearDevOverlay(page);
  const found = await readRows(page);
  record(
    "SEARCH finds the check and types it correctly",
    !!found.seen[target.orderNo] &&
      found.seen[target.orderNo].orderCell.includes("Dine-in") &&
      !HEX8.test(found.seen[target.orderNo].cashier),
    found.seen[target.orderNo]
      ? `"${found.seen[target.orderNo].orderCell}" / ${found.seen[target.orderNo].cashier}`
      : "not found by search",
  );

  await page.locator(`[data-testid=open-order-${target.orderId}]`).first().click();
  await page.waitForTimeout(2500);
  const drawer = page.locator("[data-testid=order-table-detail-drawer]");
  // Scoped: a bare :has-text("Void") also matches the "Voided" chip behind the drawer.
  await drawer.locator('button:has-text("Void")').first().click();
  await page.waitForTimeout(2000);
  const reasonBox = page.locator('textarea, input[name="reason"]').first();
  await reasonBox.fill(LONG_REASON);
  await page.waitForTimeout(500);
  await shot(page, "r5-void-panel");
  await page.locator('button:has-text("Confirm Void")').first().click();
  await page.waitForTimeout(5000);
  await clearDevOverlay(page);

  // The drawer stays up after the void and its overlay swallows every click on the chip row —
  // which reads as "the Voided chip does not exist". Close it explicitly.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  const drawerStillOpen = await page
    .locator("[data-testid=order-table-detail-drawer]")
    .count()
    .catch(() => 0);
  if (drawerStillOpen) {
    await page.locator('[data-testid=order-table-detail-drawer] button[aria-label*="lose" i], [data-testid=order-table-detail-drawer] button:has-text("×")').first().click().catch(() => {});
    await page.waitForTimeout(1200);
  }

  // Server truth for the stored reason: read it off the VOIDED listing, which is the row the
  // screen renders — not a detail endpoint that may name the field differently.
  const bearer = await tokenOf(page);
  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = listReq ? new URL(listReq.u).searchParams.get("branchId") : null;
  const voidedList = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branchId}&size=40&status=VOIDED`,
    bearer,
  );
  const srvRow = (voidedList.body?.data ?? []).find((o) => o.orderId === target.orderId) ?? null;
  const stored = srvRow?.settlement?.reason ?? null;
  note("void stored on the server", {
    found: !!srvRow,
    settlementStatus: srvRow?.settlementStatus,
    type: srvRow?.type,
    tableName: srvRow?.tableName,
    cashierName: srvRow?.cashierName,
    byName: srvRow?.settlement?.byName,
    asked: LONG_REASON.length,
    stored: stored ? stored.length : null,
  });
  record(
    "the void stored the reason UNCLIPPED — every character asked for is on the server",
    stored === LONG_REASON,
    `asked ${LONG_REASON.length} chars, stored ${stored ? stored.length : "null"}`,
  );

  // Voided chip
  await page.locator("[data-testid=order-management-search]").fill("");
  await page.waitForTimeout(1500);
  await chip(page, "VOIDED");
  await shot(page, "r6-voided");
  let vr = await readRows(page);
  let row = vr.seen[target.orderNo];
  record(
    "the voided check offers neither Cancel nor Continue",
    !!row && !row.actionButtons.some((b) => /^(Cancel|Continue)$/i.test(b)),
    row ? JSON.stringify(row.actionButtons) : "row not on Voided",
  );
  const wantVoidedLabel =
    target.serverType === "TAKEAWAY"
      ? "Takeaway"
      : target.tableName
        ? `Dine-in · ${target.tableName}`
        : "Dine-in";
  record(
    `the voided check still reads "${wantVoidedLabel}" on the Voided chip (a void does not erase the type)`,
    !!row && row.orderCell.includes(wantVoidedLabel),
    row ? `"${row.orderCell}"` : "row missing",
  );
  record(
    "the voided row's Server/Cashier is a name, beside a settlement byline naming the actor",
    !!row && !!row.cashier && !HEX8.test(row.cashier) && /by\s+\S/.test(row.settlement ?? ""),
    row ? `cashier="${row.cashier}" settlement="${(row.settlement ?? "").slice(0, 90)}"` : "row missing",
  );

  // KEYBOARD reach on the reason.
  const trigger = page.locator(`[data-testid=settlement-reason-${target.orderId}]`);
  const triggerExists = await trigger.count();
  let kbText = null;
  if (triggerExists) {
    await trigger.first().focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    kbText = await page
      .locator(`[data-testid=settlement-reason-full-${target.orderId}]`)
      .innerText()
      .catch(() => null);
    await shot(page, "r7-reason-keyboard");
  }
  record(
    "the full void reason opens from the KEYBOARD and is readable in full, wrapped",
    !!kbText && kbText.includes(LONG_REASON.slice(0, 80)) && kbText.includes(LONG_REASON.slice(-40)),
    kbText ? `popover text ${kbText.length} chars, reason ${LONG_REASON.length}` : "no popover",
  );
  if (kbText) {
    const wrap = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="settlement-reason-full-${id}"] p`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { whiteSpace: cs.whiteSpace, scrollW: el.scrollWidth, clientW: el.clientWidth };
    }, target.orderId);
    record(
      "the popover text is genuinely wrapped, not merely re-clipped (computed style)",
      !!wrap && wrap.whiteSpace !== "nowrap" && wrap.scrollW <= wrap.clientW + 1,
      JSON.stringify(wrap),
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── RELOAD, then read the reason again. ───────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await orderMgmtReady(page);
  await chip(page, "VOIDED");
  vr = await readRows(page);
  row = vr.seen[target.orderNo];
  const trigger2 = page.locator(`[data-testid=settlement-reason-${target.orderId}]`);
  let after = null;
  if (await trigger2.count()) {
    await trigger2.first().click();
    await page.waitForTimeout(1200);
    after = await page
      .locator(`[data-testid=settlement-reason-full-${target.orderId}]`)
      .innerText()
      .catch(() => null);
    await shot(page, "r8-reason-after-reload");
  }
  record(
    "after a RELOAD the void reason, the byline and the type all survive",
    !!row &&
      row.orderCell.includes("Dine-in") &&
      !!after &&
      after.includes(LONG_REASON.slice(-40)) &&
      /by\s+\S/.test(after),
    `row="${row?.orderCell ?? "MISSING"}" popover=${after ? `${after.length} chars` : "none"}`,
  );
  record(
    "the byline names the manager who voided, not a hex fragment",
    !!after && !/by\s+[0-9a-f]{8}\b/i.test(after),
    after ? after.split("\n").slice(-1)[0] : "no popover",
  );

  report.notes.voidConsole = page.__console.slice(0, 10);
  await page.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE C — the WRONG personas: cashier, waiter, and another tenant
// ═══════════════════════════════════════════════════════════════════════════════
async function stagePersonas(rung) {
  for (const who of [PEOPLE.cashier, WAITER]) {
    const page = await newPage(browser);
    try {
      await signIn(page, who);
      await orderMgmtReady(page, 10, { requireRows: false });
      await shot(page, `r9-${who.email.split("@")[0]}`);
      const r = await readRows(page);
      const cs = r.all.map((x) => x.cashier).filter(Boolean);
      const hex = cs.filter((c) => HEX8.test(c));
      record(
        `${who.email}: Server/Cashier is a name, not a hex fragment`,
        r.all.length > 0 && hex.length === 0,
        `${r.all.length} rows, hex=${hex.length}, distinct=${JSON.stringify([...new Set(cs)].slice(0, 6))}`,
      );
      const untyped = r.all.filter((x) => !/Dine-in|Takeaway|Delivery|Pickup/i.test(x.orderCell));
      record(
        `${who.email}: every row carries a type word`,
        untyped.length === 0,
        `${r.all.length} rows, untyped=${untyped.length}`,
      );
      // Did the fix widen anything? A non-manager must NOT gain the staff directory.
      const bearer = await tokenOf(page);
      if (!report.notes.terraceBranchId) {
        const rq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
        if (rq) report.notes.terraceBranchId = new URL(rq.u).searchParams.get("branchId");
      }
      const users = await apiGet(page, "/api/v1/users?size=5", bearer);
      record(
        `${who.email}: still cannot read the public user directory (no permission was widened)`,
        users.status === 403 || users.status === 401 || users.status === 404,
        `GET /api/v1/users → ${users.status}`,
      );
      report.notes[`${who.email}-console`] = page.__console.slice(0, 6);
    } catch (e) {
      record(`${who.email} drive`, false, e.message.split("\n")[0]);
    }
    await page.context().close();
  }

  // Another tenant: Control Bistro's manager must see none of Floating Terrace's checks or names.
  const cp = await newPage(browser);
  try {
    await signIn(cp, CONTROL);
    await orderMgmtReady(cp, 10, { requireRows: false });
    await shot(cp, "r10-control-tenant");
    const r = await readRows(cp);
    const bearer = await tokenOf(cp);
    // `branchId` is REQUIRED on this route: without it the answer is 400, which proves nothing
    // about tenant isolation. Ask twice — once scoped at Control's own branch, once at Floating
    // Terrace's — and score on whether a ROW ever comes back, not on the status code alone.
    const cReq = cp.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
    const cBranch = cReq ? new URL(cReq.u).searchParams.get("branchId") : null;
    const leak = [];
    for (const label of Object.keys(rung)) {
      const o = rung[label];
      const own = await apiGet(cp, `/api/v1/pos/orders/${o.orderId}?branchId=${cBranch}`, bearer);
      const theirs = await apiGet(
        cp,
        `/api/v1/pos/orders/${o.orderId}?branchId=${report.notes.terraceBranchId}`,
        bearer,
      );
      leak.push({
        label,
        orderNo: o.orderNo,
        ownBranch: own.status,
        terraceBranch: theirs.status,
        anyRow: !!own.body?.data || !!theirs.body?.data,
      });
    }
    report.notes.crossTenantDirect = leak;
    record(
      "Control Bistro cannot read a Floating Terrace order by id, on either branch scope",
      leak.every((l) => !l.anyRow && l.ownBranch !== 200 && l.terraceBranch !== 200),
      JSON.stringify(leak),
    );
    const names = r.all.map((x) => x.cashier).filter(Boolean);
    const terraceNames = names.filter((n) => /Terrace|Shift Cashier/i.test(n));
    record(
      "Control Bistro's order list carries no Floating Terrace staff name",
      terraceNames.length === 0,
      `${r.all.length} rows; names=${JSON.stringify([...new Set(names)].slice(0, 6))}`,
    );
    const noneOfMine = Object.values(rung).every((o) => !r.seen[o.orderNo]);
    record(
      "Control Bistro's order list contains none of my Floating Terrace checks",
      noneOfMine,
      `looked for ${Object.values(rung).map((o) => o.orderNo).join(", ")}`,
    );
  } catch (e) {
    record("control tenant drive", false, e.message.split("\n")[0]);
  }
  await cp.context().close();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE D — the rendering rules, driven with CONTROLLED data.
//
// This is the falsification. Every case below is one the pre-fix component answers
// DIFFERENTLY by construction — `tableName ?? "Takeaway"`, `cashierId.slice(0,8)`,
// `derivedStatus`-gated actions, "N Items", and no isError branch at all.
// ═══════════════════════════════════════════════════════════════════════════════
async function stageSynthetic() {
  const page = await newPage(browser);
  await signIn(page, PEOPLE.manager);
  await orderMgmtReady(page);

  const ORDERS_RE = /\/api\/v1\/pos\/orders\?/;

  // Real UUIDs: `orderId` is `z.string().uuid()`, and a non-uuid rejects the WHOLE page — which
  // is a fine property of the contract but is not what these cases are measuring.
  const uid = (n) => `5f2a0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  const mk = (over) => ({
    orderId: over.orderId,
    orderNo: over.orderNo,
    // Must be a REAL v4 uuid: zod checks the version and variant nibbles, and
    // "1111-1111-1111" fails the variant group — which rejects the whole page.
    tableId: over.tableName ? "5f2a1111-1111-4111-8111-111111111111" : null,
    tableName: over.tableName ?? null,
    type: over.type ?? "DINE_IN",
    derivedStatus: over.derivedStatus ?? "IN_PROGRESS",
    status: over.settlementStatus ?? "OPEN",
    settlementStatus: over.settlementStatus ?? "OPEN",
    cashierId: over.cashierId ?? "deadbeef-0000-4000-8000-000000000001",
    cashierName: over.cashierName === undefined ? "Synthetic Server" : over.cashierName,
    coverCount: 2,
    totalPaisa: 123400,
    amountPaidPaisa: 0,
    paymentStatus: over.paymentStatus ?? "UNPAID",
    openedAt: new Date().toISOString(),
    itemQuantity: over.itemQuantity ?? 3,
    distinctItemCount: over.distinctItemCount ?? 2,
    settlement: over.settlement ?? null,
  });

  /** Replace the order-list response with `rows` (or mutate it with `mutate`). */
  async function withRows(rows, { mutate, abort } = {}) {
    const handler = async (route) => {
      if (abort) return route.abort("failed");
      const res = await route.fetch();
      let body;
      try {
        body = await res.json();
      } catch {
        return route.fulfill({ response: res });
      }
      if (rows) body.data = rows;
      if (mutate) body.data = mutate(body.data ?? []);
      return route.fulfill({
        response: res,
        body: JSON.stringify(body),
        headers: { ...res.headers(), "content-type": "application/json" },
      });
    };
    await page.route(ORDERS_RE, handler);
    await page.locator("[data-testid=order-management-refresh]").click();
    await page.waitForTimeout(3500);
    await clearDevOverlay(page);
    return async () => page.unroute(ORDERS_RE, handler);
  }

  // ── 1. the five row-truth rules, all in one synthetic page ────────────────
  const rows = [
    mk({ orderId: uid(1), orderNo: "SYN-0001", type: "DINE_IN", tableName: null }),
    mk({ orderId: uid(2), orderNo: "SYN-0002", type: "DINE_IN", tableName: "Z-9" }),
    mk({ orderId: uid(3), orderNo: "SYN-0003", type: "TAKEAWAY", tableName: null }),
    mk({ orderId: uid(4), orderNo: "SYN-0004", type: "DELIVERY", tableName: null }),
    mk({ orderId: uid(5), orderNo: "SYN-0005", type: "PICKUP", tableName: null }),
    mk({ orderId: uid(6), orderNo: "SYN-0006", cashierName: null, cashierId: "abcdef12-0000-4000-8000-000000000009" }),
    mk({ orderId: uid(7), orderNo: "SYN-0007", itemQuantity: 1, distinctItemCount: 1 }),
    mk({ orderId: uid(8), orderNo: "SYN-0008", itemQuantity: 4, distinctItemCount: 3 }),
    // a VOIDED check whose FOOD never left DRAFT — the exact row that kept Cancel + Continue
    mk({
      orderId: uid(9),
      orderNo: "SYN-0009",
      derivedStatus: "DRAFT",
      settlementStatus: "VOIDED",
      settlement: { reason: LONG_REASON, byUserId: "fefd7187-0000-4000-8000-000000000002", byName: "Terrace Manager", at: new Date().toISOString() },
    }),
    mk({ orderId: uid(10), orderNo: "SYN-0010", derivedStatus: "DRAFT", settlementStatus: "OPEN" }),
    // A REFUNDED check, so the fourth settlement query's row actions are scored too.
    mk({
      orderId: uid(11),
      orderNo: "SYN-0011",
      derivedStatus: "SERVED",
      settlementStatus: "REFUNDED",
      paymentStatus: "REFUNDED",
      settlement: { reason: LONG_REASON, byUserId: "fefd7187-0000-4000-8000-000000000002", byName: "Terrace Manager", at: new Date().toISOString() },
    }),
  ];
  let un = await withRows(rows);
  await shot(page, "r11-synthetic");
  const s = await readRows(page);
  report.notes.synthetic = s.seen;
  // If the synthetic page failed to parse at all, say so loudly — otherwise every rendering
  // verdict below goes red for a reason that has nothing to do with the code under test.
  const synTrouble = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  );
  if (synTrouble.length) {
    note("SYNTHETIC PAGE DID NOT PARSE", synTrouble.concat(page.__console.slice(-3)));
  }

  const cell = (no) => s.seen[no]?.orderCell ?? "(row missing)";
  record(
    "[synthetic] DINE_IN with NO table renders Dine-in, never Takeaway",
    /Dine-in/.test(cell("SYN-0001")) && !/Takeaway/i.test(cell("SYN-0001")),
    cell("SYN-0001"),
  );
  record(
    "[synthetic] DINE_IN at a table renders BOTH the type and the table",
    /Dine-in/.test(cell("SYN-0002")) && /Z-9/.test(cell("SYN-0002")),
    cell("SYN-0002"),
  );
  record(
    "[synthetic] a real TAKEAWAY still reads Takeaway (positive control — survives a revert)",
    /Takeaway/.test(cell("SYN-0003")),
    cell("SYN-0003"),
  );
  record(
    "[synthetic] DELIVERY and PICKUP render their own words, not Takeaway",
    /Delivery/.test(cell("SYN-0004")) && /Pickup/.test(cell("SYN-0005")),
    `${cell("SYN-0004")} | ${cell("SYN-0005")}`,
  );
  record(
    "[synthetic] a resolved cashier name is printed verbatim",
    s.seen["SYN-0001"]?.cashier === "Synthetic Server",
    `"${s.seen["SYN-0001"]?.cashier}"`,
  );
  record(
    "[synthetic] an UNRESOLVED cashier degrades to the id, never to a blank (positive control)",
    s.seen["SYN-0006"]?.cashier === "abcdef12",
    `"${s.seen["SYN-0006"]?.cashier}"`,
  );
  record(
    '[synthetic] a one-item check says "1 item", never "1 Items"',
    /\b1 item\b/.test(s.seen["SYN-0007"]?.items ?? "") &&
      !/1 Items/i.test(s.seen["SYN-0007"]?.items ?? ""),
    `"${s.seen["SYN-0007"]?.items}"`,
  );
  record(
    "[synthetic] two numbers carry two DIFFERENT nouns",
    /4 items/.test(s.seen["SYN-0008"]?.items ?? "") && /3 lines/.test(s.seen["SYN-0008"]?.items ?? ""),
    `"${s.seen["SYN-0008"]?.items}"`,
  );
  record(
    "[synthetic] a VOIDED check whose food never left DRAFT offers neither Cancel nor Continue",
    !(s.seen["SYN-0009"]?.actionButtons ?? []).some((b) => /^(Cancel|Continue)$/i.test(b)),
    JSON.stringify(s.seen["SYN-0009"]?.actionButtons),
  );
  record(
    "[synthetic] a LIVE draft DOES still offer Cancel and Continue (positive control)",
    (s.seen["SYN-0010"]?.actionButtons ?? []).some((b) => /^Cancel$/i.test(b)) &&
      (s.seen["SYN-0010"]?.actionButtons ?? []).some((b) => /^Continue$/i.test(b)),
    JSON.stringify(s.seen["SYN-0010"]?.actionButtons),
  );
  record(
    "[synthetic] a REFUNDED check offers neither Cancel nor Continue, and no Assign Table",
    !!s.seen["SYN-0011"] &&
      !(s.seen["SYN-0011"].actionButtons ?? []).some((b) =>
        /^(Cancel|Continue|Assign Table)$/i.test(b),
      ),
    JSON.stringify(s.seen["SYN-0011"]?.actionButtons),
  );
  await un();

  // ── 2. a stale server that omits `type` must ERROR, not guess ─────────────
  un = await withRows(null, { mutate: (d) => d.map(({ type, ...rest }) => rest) });
  await shot(page, "r12-missing-type");
  const missing = await page.evaluate(() => ({
    text: (document.body.innerText || "").slice(0, 1500),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }));
  record(
    'a response with no `type` surfaces as an ERROR — never as a guessed Takeaway and never as "No active orders"',
    !/No active orders/i.test(missing.text) && !/Takeaway/i.test(missing.text),
    `alerts=${JSON.stringify(missing.alerts).slice(0, 200)} text="${missing.text.replace(/\s+/g, " ").slice(0, 200)}"`,
  );
  await un();

  // ── 3. a FAILED read must say the read failed ─────────────────────────────
  un = await withRows(null, { abort: true });
  await shot(page, "r13-failed-read");
  const failed = await page.evaluate(() => (document.body.innerText || "").slice(0, 1500));
  record(
    'a FAILED order read says the read failed — it never claims "No active orders"',
    !/No active orders/i.test(failed) && /couldn.t|unavailable|failed|try again|retry/i.test(failed),
    failed.replace(/\s+/g, " ").slice(0, 220),
  );
  await un();

  // Recovery must be asserted on ROWS, not on the absence of one error string. The first
  // version of this check looked only for "couldn't load" and passed happily against a page
  // reading "The order list is unavailable right now" — a different sentence for the same
  // outage. An error state that survives the retry is indistinguishable from a fixed one
  // unless the assertion demands the table back.
  await page.locator("[data-testid=order-management-refresh]").click();
  await page.waitForTimeout(4000);
  const recovered = await page.evaluate(() => ({
    rows: document.querySelectorAll("table tbody tr").length,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
      n.textContent.trim().slice(0, 120),
    ),
  }));
  record(
    "the list recovers on Retry — real rows come back and no alert remains",
    recovered.rows > 0 && recovered.alerts.length === 0,
    JSON.stringify(recovered),
  );

  report.notes.syntheticConsole = page.__console.slice(0, 10);
  await page.context().close();
}

// ─────────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// STAGE E — a REAL live draft: the status whose Cancel/Continue pair the fix re-gated.
//
// The gating moved from `derivedStatus` to `settlementStatus`. That closes the voided-row
// defect, but it could just as easily have removed Cancel from the LIVE drafts it is supposed
// to serve. A synthetic row proves the rule; this proves the rule against a check the terminal
// actually created, and then presses the button.
// ═══════════════════════════════════════════════════════════════════════════════
async function stageDraft() {
  const page = await newPage(browser);
  await signIn(page, PEOPLE.manager);
  await posReady(page);

  const bearer0 = await tokenOf(page);
  const me = JSON.parse(Buffer.from(bearer0.split(".")[1], "base64url").toString()).sub;
  const req = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = req ? new URL(req.u).searchParams.get("branchId") : null;
  const list = async (b) =>
    (await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=40`, b)).body?.data ?? [];

  const before = new Set((await list(bearer0)).map((o) => o.orderId));

  // A derivedStatus=DRAFT row cannot be produced by tapping tiles: the terminal's cart is LOCAL
  // until "Send to Kitchen", so an unfired check never reaches the server from that screen. The
  // state the Draft chip shows — an order that HAS items and has NOT been fired — is reached by
  // creating the order and adding a line without firing. The SETUP is API; every VERDICT below
  // is still read off the rendered table in the browser.
  const menu = await apiGet(page, `/api/v1/pos/menu/items?branchId=${branchId}&size=30`, bearer0);
  const items = menu.body?.data ?? [];
  if (!items.length) throw new Error(`no menu item to build a draft from (${menu.status})`);
  const created = await apiSend(page, "POST", "/api/v1/pos/orders", {
    branchId,
    type: "DINE_IN",
    coverCount: 2,
    clientOrderId: crypto.randomUUID(),
  }, bearer0);
  const draftId = created.body?.data?.orderId ?? created.body?.data?.id ?? null;
  if (!draftId) throw new Error(`could not create a draft order: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  // Most dishes here carry a REQUIRED modifier group ("Spice level: choose exactly 1"), and the
  // server rightly refuses a line without one. Walk the menu until a dish takes a bare line.
  let added = null;
  for (const mi of items) {
    added = await apiSend(page, "POST", `/api/v1/pos/orders/${draftId}/items`, {
      menuItemId: mi.menuItemId ?? mi.id,
      branchId,
      quantity: 1,
    }, bearer0);
    if (added.status < 300) break;
  }
  note("draft build", {
    created: created.status,
    added: added?.status,
    addedBody: (added?.status ?? 500) >= 400 ? JSON.stringify(added?.body).slice(0, 160) : "ok",
    draftId,
  });
  if ((added?.status ?? 500) >= 300)
    throw new Error("no menu item accepted a line without modifiers — cannot build a draft");

  let mine = null;
  for (let i = 0; i < 15 && !mine; i++) {
    await page.waitForTimeout(1500);
    mine = (await list(bearer0)).find((o) => o.orderId === draftId) ?? null;
  }
  if (!mine) throw new Error("the draft I created never appeared in the active list");
  if (mine.derivedStatus !== "DRAFT")
    throw new Error(`built order is derivedStatus=${mine.derivedStatus}, not DRAFT`);
  note("live draft", {
    orderId: mine.orderId,
    orderNo: mine.orderNo,
    derivedStatus: mine.derivedStatus,
    settlementStatus: mine.settlementStatus,
    type: mine.type,
    cashierName: mine.cashierName,
  });

  await orderMgmtReady(page);
  await chip(page, "DRAFT");
  await shot(page, "r14-live-draft");
  const row = await readRowByOrderId(page, mine.orderId);
  record(
    "a live, unfired DINE_IN draft with no table reads Dine-in — not Takeaway",
    !!row && /Dine-in/.test(row.cells[0]) && !/Takeaway/i.test(row.cells[0]),
    row ? `"${row.cells[0]}"` : "row not under the Draft chip",
  );
  record(
    "a live draft still offers Cancel AND Continue — the re-gating did not over-correct",
    !!row && row.buttons.some((b) => /^Cancel$/i.test(b)) && row.buttons.some((b) => /^Continue$/i.test(b)),
    row ? JSON.stringify(row.buttons) : "row missing",
  );
  record(
    "a live draft's Server/Cashier is a name, not a hex fragment",
    !!row && !!row.cells[3] && !HEX8.test(row.cells[3]),
    row ? `"${row.cells[3]}"` : "row missing",
  );

  // Press the button: Cancel must actually void it, and the row must then lose both controls.
  await page.locator(`[data-testid=cancel-draft-${mine.orderId}]`).first().click();
  await page.waitForTimeout(900);
  await page.locator(`[data-testid=cancel-draft-confirm-${mine.orderId}]`).first().click();
  await page.waitForTimeout(5000);
  await chip(page, "VOIDED");
  await shot(page, "r15-draft-after-cancel");
  const after = await readRowByOrderId(page, mine.orderId);
  record(
    "Cancel on a live draft voids it, and the row then offers neither Cancel nor Continue",
    !!after &&
      /Dine-in/.test(after.cells[0]) &&
      !after.buttons.some((b) => /^(Cancel|Continue)$/i.test(b)),
    after ? `"${after.cells[0]}" buttons=${JSON.stringify(after.buttons)}` : "not found under Voided",
  );

  await page.context().close();
}

try {
  await requirePosUp();
  let rung = null;
  if (STAGE === "draft") await stageDraft();
  if (STAGE === "all" || STAGE === "manager") rung = await stageManager();
  if (rung) writeFileSync(`${OUT}/_reopen-rung.json`, JSON.stringify(rung, null, 2));
  if (STAGE === "all" || STAGE === "void") {
    const r = rung ?? JSON.parse(await import("node:fs").then((m) => m.readFileSync(`${OUT}/_reopen-rung.json`, "utf8")));
    await stageVoid(r);
  }
  if (STAGE === "all" || STAGE === "personas") {
    const r = rung ?? JSON.parse(await import("node:fs").then((m) => m.readFileSync(`${OUT}/_reopen-rung.json`, "utf8")));
    await stagePersonas(r);
  }
  if (STAGE === "all" || STAGE === "synthetic") await stageSynthetic();
} catch (e) {
  record("HARNESS", false, e.message.split("\n").slice(0, 3).join(" | "));
  log(e.stack);
} finally {
  flush();
  await browser.close();
}
