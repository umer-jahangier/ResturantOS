/*
 * F2 — RE-OPEN attempt. Written to break the claim, not to reproduce its confirmation.
 *
 * The prior pass drove DINE_IN and TAKEAWAY. This adds the paths it never touched:
 *
 *   1. PICKUP. The terminal offers a THREE-way toggle (order-type-toggle.tsx) — Dine-in,
 *      Takeaway, Pickup — and the enum carries a fourth, DELIVERY. Under the old code a
 *      PICKUP check with no table read "Takeaway" for exactly the same reason a DINE_IN did.
 *      Nobody has ever rung one and looked. If the label is wrong here the finding is only
 *      two-thirds closed.
 *   2. A ONE-ITEM check. "1 item" vs "1 Items" is the whole of defect (e), and the singular
 *      is the case the plural bug actually shows up in. The prior pass observed "1 item" on
 *      somebody else's row; ring one deliberately.
 *   3. RELOAD. DONE MEANS is a browser task: it has to survive F5, not just a first render.
 *   4. The REFUNDED chip — a fourth server query (?status=REFUNDED) with its own settlement
 *      column, never read by anyone.
 *   5. Console errors on every screen, and the network status of every /pos/orders read, so a
 *      silent 500 rendered as an empty list cannot pass as "no rows".
 */
import {
  PEOPLE,
  BASE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  openOrderManagement,
  readOrderTable,
  apiGet,
  tokenOf,
  log,
} from "./f2-lib.mjs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F2");
const HEX8 = /^[0-9a-f]{8}$/i;

const LONG_REASON =
  "F2 re-open — table of four sent the whole order back: the biryani arrived cold, the second " +
  "round of drinks never came, and the duty manager comped the entire check rather than argue " +
  "at the pass in front of the room. Nothing had been paid, so this is a void and not a refund.";

const report = { startedAt: new Date().toISOString(), rung: {}, verdicts: [], LONG_REASON };
const record = (name, pass, detail) => {
  report.verdicts.push({ name, pass, detail });
  log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

/** Rows on screen, keyed by order number, exactly as a human reads them. */
async function readRows(page) {
  const table = await readOrderTable(page);
  const idx = (re) => table.headers.findIndex((h) => re.test(h));
  const iOrder = idx(/Order/i);
  const iCash = idx(/Server\/Cashier/i);
  const iItems = idx(/^Items$/i);
  const out = {};
  for (const r of table.rows) {
    const cell = (r.cells[iOrder]?.text ?? "").replace(/\n/g, " | ");
    const no = /ORD-\d{8}-\d+/.exec(cell)?.[0];
    if (!no) continue;
    out[no] = {
      orderCell: cell,
      cashier: (r.cells[iCash]?.text ?? "").trim(),
      items: (r.cells[iItems]?.text ?? "").replace(/\n/g, " | ").trim(),
      buttons: (r.cells[r.cells.length - 1]?.buttons ?? []).map((b) => b.text),
      allButtons: r.cells.flatMap((c) => (c.buttons ?? []).map((b) => b.text)),
    };
  }
  return { headers: table.headers, rows: out, count: Object.keys(out).length };
}

async function consoleClean(page, where) {
  const errs = (page.__console ?? []).filter(
    (e) => !/favicon|ResizeObserver|Download the React DevTools/i.test(e),
  );
  return { where, count: errs.length, sample: errs.slice(0, 4) };
}

const browser = await newBrowser();
const page = await newPage(browser);
let branchId = null;

try {
  // ────────────────────────────── manager signs in and rings ──────────────────────────────
  await login(page, PEOPLE.manager);

  async function posReady() {
    if (!page.url().includes("/app/pos")) {
      await go(page, "/app/pos", { waitMs: 4000, allowTrouble: true });
    }
    await page
      .locator('[data-testid="menu-grid"] button[aria-pressed]')
      .first()
      .waitFor({ timeout: 30000 });
    return true;
  }

  async function addTile(tiles, i) {
    await tiles.nth(i).click();
    await page.waitForTimeout(900);
    const dlg = page.locator("[data-testid=modifier-dialog][data-state=open]");
    if (!(await dlg.count())) return;
    const opts = dlg.locator('button[aria-pressed], button[role="radio"], button[role="checkbox"]');
    const addBtn = dlg.locator('button:has-text("Add to order")');
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await addBtn.first().isEnabled()) break;
      const n = await opts.count();
      let clicked = false;
      for (let k = 0; k < n; k++) {
        const b = opts.nth(k);
        if ((await b.getAttribute("aria-pressed")) === "true") continue;
        await b.click();
        await page.waitForTimeout(400);
        clicked = true;
        if (await addBtn.first().isEnabled()) break;
      }
      if (!clicked) break;
    }
    if (!(await addBtn.first().isEnabled())) {
      throw new Error(`modifier dialog refused: ${(await dlg.innerText()).slice(0, 240)}`);
    }
    await addBtn.first().click();
    await page.locator("[data-testid=modifier-dialog]").waitFor({ state: "detached", timeout: 15000 });
    await page.waitForTimeout(500);
  }

  async function liveOrders(bearer) {
    if (!branchId) {
      const req = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
      if (!req) return [];
      branchId = new URL(req.u).searchParams.get("branchId");
    }
    const r = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=40`, bearer);
    return (r.body?.data ?? []).filter((x) => x.orderNo);
  }

  const subOf = (b) =>
    JSON.parse(Buffer.from(b.split(".")[1], "base64url").toString()).sub ?? null;

  /**
   * Ring one check. `tiles` says how many DISTINCT menu tiles and how many taps each — a
   * one-tap/one-tile check is the "1 item" case, which is the singular the plural bug lives in.
   */
  async function ring(label, type, { withTable = false, taps = [0, 0, 1] } = {}) {
    log(`\n=== ringing ${label} (${type}${withTable ? " @table" : ""}, ${taps.length} taps) ===`);
    await posReady();
    await page.locator(`[data-testid=order-type-${type.toLowerCase()}]`).click();
    await page.waitForTimeout(900);

    let tableName = null;
    if (withTable) {
      await page.locator("[data-testid=table-select-trigger]").click();
      await page.waitForTimeout(1400);
      const opts = page.locator('[data-testid^="table-option-"]:not([aria-disabled="true"])');
      const n = await opts.count();
      if (n === 0) throw new Error("no AVAILABLE table in the picker");
      const wanted = opts.filter({ hasText: report.freshTable ?? "@@none@@" });
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
      log(`  picked table ${tableName} (of ${n} free)`);
    }

    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 25000 });
    for (const t of taps) await addTile(tiles, t);
    await page.waitForTimeout(1100);

    const bearer = await tokenOf(page);
    const me = subOf(bearer);
    const before = new Set((await liveOrders(bearer)).map((o) => o.orderNo));
    await page.locator("[data-testid=send-to-kitchen-button]").click();

    // Ten agents ring into this branch. The new row must be MINE and must match what I asked
    // for — cashier id, type and table — or it is somebody else's check.
    let mine = null;
    for (let i = 0; i < 20 && !mine; i++) {
      await page.waitForTimeout(1500);
      const after = await liveOrders(bearer);
      mine = after.find(
        (o) =>
          !before.has(o.orderNo) &&
          o.cashierId === me &&
          o.type === type &&
          (withTable ? o.tableName === tableName : !o.tableName),
      );
    }
    if (!mine) throw new Error(`${label}: no new ${type} row attributable to me`);
    report.rung[label] = {
      orderNo: mine.orderNo,
      orderId: mine.orderId,
      type: mine.type,
      tableName: mine.tableName ?? null,
      cashierId: mine.cashierId,
      cashierName: mine.cashierName ?? null,
      itemQuantity: mine.itemQuantity,
      distinctItemCount: mine.distinctItemCount,
    };
    log(`  → ${mine.orderNo} type=${mine.type} table=${mine.tableName ?? "—"} qty=${mine.itemQuantity} lines=${mine.distinctItemCount}`);
    await shot(page, `r-fired-${label}`);
  }

  async function ringRetry(label, type, opts) {
    let last = null;
    for (let a = 1; a <= 3; a++) {
      try {
        return await ring(label, type, opts);
      } catch (e) {
        last = e;
        log(`  ring ${label} attempt ${a}/3: ${e.message.split("\n")[0]}`);
        await page.waitForTimeout(6000);
      }
    }
    throw last;
  }

  // A table of my own, so another agent's occupied floor cannot block the tabled case.
  await go(page, "/app/tables", { waitMs: 4000, allowTrouble: true });
  const freshTable = `F2R-${String(Date.now()).slice(-6)}`;
  await page.locator('button:has-text("Add table")').first().click();
  await page.waitForTimeout(1500);
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator("input").first().waitFor({ timeout: 20000 });
  const inputs = dlg.locator("input");
  await inputs.nth(0).fill(freshTable); // Name or number
  if ((await inputs.count()) > 1) await inputs.nth(1).fill("4"); // Seats
  await dlg.locator('button:has-text("Add table")').last().click();
  await page.waitForTimeout(3500);
  report.freshTable = freshTable;
  log(`  added table ${freshTable}`);
  await shot(page, "r0-table-added");

  await ringRetry("dineInAtTable", "DINE_IN", { withTable: true, taps: [0, 0, 1] });
  await ringRetry("dineInNoTable", "DINE_IN", { taps: [0, 1] });
  await ringRetry("takeaway", "TAKEAWAY", { taps: [0] });
  // The path nobody has ever rung. Old code: tableless ⇒ "Takeaway".
  await ringRetry("pickup", "PICKUP", { taps: [0] });

  // ─────────────────────────────── Active chip: read the rows ───────────────────────────────
  await openOrderManagement(page, { waitMs: 4500 });
  await shot(page, "r1-active");
  let view = await readRows(page);
  log(`\n  headers: ${JSON.stringify(view.headers)}  rows=${view.count}`);

  const expectLabel = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", PICKUP: "Pickup" };

  function scoreTypes(v, tag) {
    for (const [label, rung] of Object.entries(report.rung)) {
      const row = v.rows[rung.orderNo];
      if (!row) {
        record(`${tag}: ${label} row present`, false, `${rung.orderNo} not on screen`);
        continue;
      }
      const want = expectLabel[rung.type];
      const hasLabel = new RegExp(`\\b${want}\\b`).test(row.orderCell);
      // A DINE_IN must not read Takeaway; a PICKUP must not read Takeaway either.
      const wrongly =
        rung.type !== "TAKEAWAY" && /\bTakeaway\b/.test(row.orderCell) ? " (reads Takeaway!)" : "";
      record(
        `${tag}: ${label} reads "${want}"`,
        hasLabel && !wrongly,
        `${rung.orderNo} → "${row.orderCell}"${wrongly}`,
      );
      if (rung.tableName) {
        record(
          `${tag}: ${label} still shows its table`,
          row.orderCell.includes(rung.tableName),
          `expected "${rung.tableName}" in "${row.orderCell}"`,
        );
      }
    }
  }

  function scoreCashiers(v, tag) {
    const cells = Object.entries(v.rows).map(([no, r]) => [no, r.cashier]);
    const hex = cells.filter(([, c]) => HEX8.test(c));
    const blank = cells.filter(([, c]) => !c || c === "—");
    record(
      `${tag}: no 8-char hex in Server/Cashier`,
      hex.length === 0,
      `${cells.length} rows scanned; hex=${JSON.stringify(hex.slice(0, 4))}; blank=${blank.length}`,
    );
    const names = [...new Set(cells.map(([, c]) => c))];
    log(`    distinct Server/Cashier values: ${JSON.stringify(names)}`);
    return names;
  }

  function scoreItems(v, tag) {
    const bad = [];
    for (const [no, r] of Object.entries(v.rows)) {
      if (/\b1 Items\b/i.test(r.items) || /\b1 lines\b/i.test(r.items)) bad.push([no, r.items, "singular/plural"]);
      // Two numbers in a cell must not share one noun.
      const nouns = [...r.items.matchAll(/\d+\s+(items?|lines?|Items|Qty)/gi)].map((m) =>
        m[1].toLowerCase().replace(/s$/, ""),
      );
      if (nouns.length > 1 && new Set(nouns).size === 1) bad.push([no, r.items, "same noun twice"]);
    }
    record(
      `${tag}: Items cell labels each number distinctly`,
      bad.length === 0,
      bad.length ? JSON.stringify(bad.slice(0, 4)) : `${v.count} cells clean`,
    );
  }

  scoreTypes(view, "active");
  scoreCashiers(view, "active");
  scoreItems(view, "active");

  // The deliberate singular: the takeaway and pickup were one tap each.
  const single = report.rung.takeaway;
  const singleRow = view.rows[single.orderNo];
  record(
    "active: a one-item check reads \"1 item\", never \"1 Items\"",
    !!singleRow && /\b1 item\b/.test(singleRow.items) && !/\b1 Items\b/i.test(singleRow.items),
    `${single.orderNo} qty=${single.itemQuantity} → "${singleRow?.items}"`,
  );

  // ─────────────────────────────── RELOAD: does it persist ───────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await openOrderManagement(page, { waitMs: 4500 });
  const afterReload = await readRows(page);
  await shot(page, "r2-active-after-reload");
  scoreTypes(afterReload, "reload");
  scoreCashiers(afterReload, "reload");
  scoreItems(afterReload, "reload");

  // ─────────────────────────────── void with a long reason ───────────────────────────────
  const target = report.rung.dineInAtTable;
  log(`\n=== voiding ${target.orderNo} ===`);
  const search = page.locator('input[type="search"]');
  await search.first().fill(target.orderNo);
  await page.waitForTimeout(3000);
  const searched = await readRows(page);
  await shot(page, "r3-search");
  record(
    "search path: the row keeps its type and its cashier name",
    !!searched.rows[target.orderNo] &&
      /\bDine-in\b/.test(searched.rows[target.orderNo].orderCell) &&
      !HEX8.test(searched.rows[target.orderNo].cashier),
    JSON.stringify(searched.rows[target.orderNo] ?? null),
  );

  await page.locator(`[data-testid=open-order-${target.orderId}]`).click();
  await page.waitForTimeout(3000);
  await shot(page, "r4-drawer");
  const drawer = page.locator("[data-testid=order-table-detail-drawer]");
  await drawer.locator('button:has-text("Void")').first().click();
  await page.waitForTimeout(2000);
  const voidPanel = page.locator('[role="dialog"]');
  await voidPanel.locator("textarea").first().fill(LONG_REASON);
  await page.waitForTimeout(500);
  await shot(page, "r5-void-panel");
  await voidPanel.locator('button:has-text("Confirm Void")').first().click();
  await page.waitForTimeout(5000);
  await shot(page, "r6-after-void");

  const tok = await tokenOf(page);
  const srv = await apiGet(page, `/api/v1/pos/orders/${target.orderId}?branchId=${branchId}`, tok);
  const stored = srv.body?.data?.voidReason ?? srv.body?.data?.settlementReason ?? null;
  log(`  server voidReason length: ${stored?.length ?? "null"} (asked ${LONG_REASON.length})`);

  // ─────────────────────────────── VOIDED chip ───────────────────────────────
  await go(page, "/app/pos", { waitMs: 3500, allowTrouble: true });
  await openOrderManagement(page, { waitMs: 4000 });
  await page.locator('button:has-text("Voided")').first().click();
  await page.waitForTimeout(4000);
  await shot(page, "r7-voided");
  const voided = await readRows(page);
  const vrow = voided.rows[target.orderNo];
  record(
    "voided: the row still reads Dine-in with its table",
    !!vrow && /\bDine-in\b/.test(vrow.orderCell) && vrow.orderCell.includes(target.tableName),
    `"${vrow?.orderCell}"`,
  );
  record(
    "voided: offers neither Cancel nor Continue",
    !!vrow && !vrow.allButtons.some((b) => /^(Cancel|Continue)$/.test(b.trim())),
    `buttons on the row: ${JSON.stringify(vrow?.allButtons)}`,
  );
  scoreCashiers(voided, "voided");
  scoreTypes(voided, "voided-mine");

  // The reason, reached by KEYBOARD only — no mouse anywhere in this block.
  const trigger = page.locator(`[data-testid=settlement-reason-${target.orderId}]`);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const pop = page.locator(`[data-testid=settlement-reason-full-${target.orderId}]`);
  const popText = (await pop.count()) ? (await pop.first().innerText()).trim() : "";
  await shot(page, "r8-reason-popover-keyboard");
  record(
    "voided: the full reason opens from the KEYBOARD and is readable unclipped",
    popText.includes(LONG_REASON),
    `popover ${popText.length} chars vs reason ${LONG_REASON.length}; wrapped=${
      (await pop.count()) ? await pop.first().evaluate((n) => getComputedStyle(n.querySelector("p")).whiteSpace) : "n/a"
    }`,
  );
  record(
    "voided: the popover names WHO voided it, by name",
    /by\s+[A-Za-z]/.test(popText) && !/by\s+[0-9a-f]{8}\b/i.test(popText),
    popText.replace(/\n/g, " | ").slice(0, 200),
  );

  // ─────────────────────────────── CLOSED and REFUNDED chips ───────────────────────────────
  for (const chip of ["Closed", "Refunded"]) {
    await go(page, "/app/pos", { waitMs: 3000, allowTrouble: true });
    await openOrderManagement(page, { waitMs: 3500 });
    const btn = page.locator(`button:has-text("${chip}")`);
    if (!(await btn.count())) {
      record(`${chip} chip exists`, false, "no chip with that label");
      continue;
    }
    await btn.first().click();
    await page.waitForTimeout(4000);
    await shot(page, `r9-${chip.toLowerCase()}`);
    const v = await readRows(page);
    const alert = await page.locator('[role="alert"]').count();
    log(`  ${chip}: ${v.count} rows, alerts=${alert}`);
    if (v.count === 0) {
      record(`${chip}: rows render without error`, alert === 0, `0 rows, ${alert} alert(s)`);
      continue;
    }
    scoreCashiers(v, chip.toLowerCase());
    scoreItems(v, chip.toLowerCase());
    const takeawayish = Object.entries(v.rows).filter(([, r]) => /\bTakeaway\b/.test(r.orderCell));
    record(
      `${chip}: no row offers Cancel or Continue`,
      !Object.values(v.rows).some((r) => r.allButtons.some((b) => /^(Cancel|Continue)$/.test(b.trim()))),
      `Takeaway-labelled rows: ${takeawayish.length}/${v.count}`,
    );
  }

  report.console = await consoleClean(page, "manager");
  record("manager: zero console errors", report.console.count === 0, JSON.stringify(report.console));
} catch (e) {
  report.fatal = e.message;
  log(`\nFATAL: ${e.message}`);
  await shot(page, "r99-fatal").catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  report.passed = report.verdicts.filter((v) => v.pass).length;
  report.failed = report.verdicts.filter((v) => !v.pass).length;
  writeFileSync(`${OUT}/_reopen.json`, JSON.stringify(report, null, 2));
  log(`\n${report.passed} pass / ${report.failed} fail`);
  for (const v of report.verdicts.filter((v) => !v.pass)) log(`  FAIL  ${v.name} — ${v.detail}`);
  await browser.close();
}
