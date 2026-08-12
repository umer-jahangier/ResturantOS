/*
 * F2 — INDEPENDENT re-verification, written to attack the claim rather than confirm it.
 *
 * The previous pass conceded one thing and never tested four others. This closes all five:
 *
 *   1. A fresh DINE_IN rung AT A TABLE through the real table picker. The earlier run gave up
 *      ("no free table among 7 options") and proved the tabled case against an order it had not
 *      created. DONE MEANS asks for a check to be RUNG at a table, so ring one.
 *   2. The CLOSED chip. Every earlier verdict was measured on Active and Voided only. A settled
 *      row is fetched by a DIFFERENT query (?status=CLOSED) and could easily have been left
 *      un-enriched — the enrichment lives in the controller, but nothing had ever looked.
 *   3. The SEARCH path. Search asks the server across every status and every page; it is a third
 *      code path into the same table and had never been read for names or types.
 *   4. The CASHIER persona. The walkthrough's finding was "for every row, for every PERSONA".
 *      A name resolved through a manager's token proves nothing about a cashier's.
 *   5. Keyboard reach on the void reason. A popover that only opens on a mouse click is not
 *      "readable" on a tablet or by a keyboard user.
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
  tokenOf,
  log,
} from "./f2-lib.mjs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F2");
const HEX8 = /^[0-9a-f]{8}$/i;

const LONG_REASON =
  "F2 independent re-verification — the party of six disputed the cover charge, the duty " +
  "manager agreed it had been applied twice by mistake, and since nothing had left the pass " +
  "the whole check comes off rather than being part-refunded at the till";

const report = { rung: {}, verdicts: [], longReason: LONG_REASON };
const record = (name, pass, detail) => {
  report.verdicts.push({ name, pass, detail });
  log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

/** Read the Order/Type + Server/Cashier + Items + actions of every row on screen, by order no. */
async function readRows(page) {
  const table = await readOrderTable(page);
  const idx = (re) => table.headers.findIndex((h) => re.test(h));
  const iOrder = idx(/Order/i);
  const iCash = idx(/Server\/Cashier/i);
  const iItems = idx(/Items/i);
  const seen = {};
  for (const r of table.rows) {
    const cell = (r.cells[iOrder]?.text ?? "").replace(/\n/g, " | ");
    const no = /ORD-\d{8}-\d+/.exec(cell)?.[0];
    if (!no) continue;
    seen[no] = {
      orderCell: cell,
      cashier: (r.cells[iCash]?.text ?? "").trim(),
      items: (r.cells[iItems]?.text ?? "").replace(/\n/g, " / "),
      actionButtons: (r.cells[r.cells.length - 1]?.buttons ?? []).map((b) => b.text),
    };
  }
  return { headers: table.headers, seen };
}

/**
 * The Next dev-error overlay is a full-screen portal that swallows clicks.
 *
 * It is a DEV artefact of ten agents compiling into one tree, not product UI — but it must never
 * be dismissed silently: whatever it says is recorded first, so a compile error in the code under
 * test can never be swept aside as "just the overlay".
 */
async function clearDevOverlay(p) {
  const text = await p.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    if (!portal) return null;
    const t = (portal.shadowRoot?.textContent || portal.textContent || "").trim();
    portal.remove();
    return t.slice(0, 600);
  });
  if (text) log(`    [next dev overlay removed] ${text || "(no text)"}`);
  return text;
}

/**
 * Land on the till and insist it actually came up.
 *
 * Ten agents share this machine and restart pos-service constantly; a service still warming
 * renders a real `[role=alert]` — "The till is unavailable right now… not answering" — which in a
 * screenshot is indistinguishable from the feature being broken. Reload until it clears, and
 * throw with the alert text if it never does, so an outage can never be scored as a verdict.
 */
async function posReady(p, tries = 8) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await go(p, "/app/pos", { waitMs: 8000, allowTrouble: true });
    const stillDown = last.alerts.some((a) => /till is unavailable|not answering/i.test(a));
    if (!last.bad.length && !stillDown) return last;
    log(
      `    /app/pos not ready (attempt ${i + 1}/${tries}): ${JSON.stringify(last.bad)} ${stillDown ? "[till outage]" : ""}`,
    );
    await p.waitForTimeout(10000);
  }
  throw new Error(`POS never came up: ${JSON.stringify(last)}`);
}

const browser = await newBrowser();
const page = await newPage(browser);
let branchId = null;

/**
 * Sign in, allowing for the login throttle.
 *
 * Repeated runs against one account trip auth-service's failed-login accounting, and a refused
 * login renders as `/login` — which reads exactly like "this persona has no access to the screen".
 * That confusion has already cost this repo weeks, so wait the throttle out and say so.
 */
async function signIn(p, who) {
  try {
    await login(p, who);
  } catch (first) {
    log(`  ${who.email} refused once — waiting out the throttle: ${first.message}`);
    await p.waitForTimeout(70000);
    await login(p, who);
  }
}

try {
  // ───────────────────────── manager rings three checks ─────────────────────────
  await signIn(page, PEOPLE.manager);

  // Ten agents share this branch and by mid-morning all seven of its tables are OCCUPIED by
  // other people's checks — which is exactly why the earlier pass gave up on the tabled case.
  // Rather than disturb another agent's data, the manager opens the floor plan and adds a
  // table, the way a manager who has put a table on the terrace would. That table is then
  // AVAILABLE and can be rung at through the real picker.
  const tp = await go(page, "/app/tables", { waitMs: 5000 });
  if (tp.bad.length) throw new Error(`/app/tables showed ${JSON.stringify(tp)}`);
  const freshTable = `F2-${Math.floor(Math.random() * 9000 + 1000)}`;
  await page.locator('button:has-text("Add table")').first().click();
  await page.waitForTimeout(1500);
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('input[name="tableNumber"]').fill(freshTable);
  await dlg.locator('input[name="capacity"]').fill("4");
  await dlg.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  await shot(page, "i0-table-added");
  report.freshTable = freshTable;
  log(`  added table ${freshTable} on the floor plan`);

  const t = await posReady(page);
  log("  /app/pos:", JSON.stringify(t));

  /**
   * Order numbers the server currently lists for this branch — the ground truth for "was it rung".
   *
   * The bearer is passed IN rather than minted here. `tokenOf()` spends the refresh cookie, and
   * refresh tokens rotate: polling this twenty times in a loop signed the session out mid-run and
   * looked exactly like "the order was never created". One token per ring, reused.
   */
  async function liveOrders(bearer) {
    if (!branchId) {
      const req = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
      if (!req) return [];
      branchId = new URL(req.u).searchParams.get("branchId");
    }
    const r = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=30`, bearer);
    return (r.body?.data ?? []).filter((x) => x.orderNo);
  }

  /** This session's own user id, so a concurrent agent's check is never mistaken for mine. */
  function subOf(bearer) {
    const payload = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString());
    return payload.sub ?? payload.userId ?? null;
  }

  /**
   * Add one menu tile to the cart, working the modifier dialog when the item has one.
   *
   * A menu item with modifiers opens `modifier-dialog` on tap, and its overlay swallows every
   * later click — so a harness that just taps tiles silently stops adding food after the first
   * one. Choose the required options the way a cashier must, then press "Add to order".
   */
  async function addTile(tiles, i) {
    await tiles.nth(i).click();
    await page.waitForTimeout(900);
    const dlg = page.locator("[data-testid=modifier-dialog][data-state=open]");
    if (!(await dlg.count())) return;
    // Satisfy every "Required — choose exactly N" group by taking its first option.
    const required = dlg.locator(
      'button[aria-pressed], button[role="radio"], button[role="checkbox"]',
    );
    const addBtn = dlg.locator('button:has-text("Add to order")');
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await addBtn.first().isEnabled()) break;
      const n = await required.count();
      let clicked = false;
      for (let k = 0; k < n; k++) {
        const b = required.nth(k);
        if ((await b.getAttribute("aria-pressed")) === "true") continue;
        await b.click();
        await page.waitForTimeout(400);
        clicked = true;
        if (await addBtn.first().isEnabled()) break;
      }
      if (!clicked) break;
    }
    if (!(await addBtn.first().isEnabled())) {
      const why = await dlg.innerText();
      throw new Error(`modifier dialog would not accept the item: ${why.slice(0, 300)}`);
    }
    await addBtn.first().click();
    await page
      .locator("[data-testid=modifier-dialog]")
      .waitFor({ state: "detached", timeout: 15000 });
    await page.waitForTimeout(500);
  }

  async function ring(label, type, { withTable = false } = {}) {
    log(`\n=== ringing ${label} (${type}${withTable ? " @table" : ""}) ===`);
    await posReady(page);
    await page.locator(`[data-testid=order-type-${type.toLowerCase()}]`).click();
    await page.waitForTimeout(900);

    let tableName = null;
    if (withTable) {
      // The real picker, the way a waiter uses it — it lists AVAILABLE tables only.
      await page.locator("[data-testid=table-select-trigger]").click();
      await page.waitForTimeout(1400);
      // Occupied tables are rendered but aria-disabled — a free one is the only clickable one.
      const opts = page.locator('[data-testid^="table-option-"]:not([aria-disabled="true"])');
      const n = await opts.count();
      if (n === 0) {
        const shown = await page.evaluate(() => document.body.innerText.slice(-600));
        throw new Error(`no AVAILABLE table in the picker; picker said: ${shown}`);
      }
      const wanted = opts.filter({ hasText: report.freshTable });
      const pick = (await wanted.count()) ? wanted.first() : opts.first();
      tableName = (await pick.getAttribute("data-testid")).replace("table-option-", "");
      await pick.click();
      // The picker is a dialog; its overlay swallows clicks on the menu grid until it unmounts.
      await page
        .locator('[data-slot="dialog-overlay"]')
        .waitFor({ state: "detached", timeout: 15000 })
        .catch(async () => {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(1200);
        });
      await page.waitForTimeout(1200);
      log(`  picked table ${tableName} (of ${n} available)`);
    }

    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 25000 });
    await addTile(tiles, 0);
    await addTile(tiles, 0);
    await addTile(tiles, 1);
    await page.waitForTimeout(1100);
    // Which check this was is settled by the SERVER, not by scraping the terminal: firing can
    // navigate, and an evaluate() that loses its execution context mid-render would otherwise
    // report a null order number for a check that was rung perfectly well.
    const bearer = await tokenOf(page);
    const me = subOf(bearer);
    const before = new Set((await liveOrders(bearer)).map((o) => o.orderNo));
    await page.locator("[data-testid=send-to-kitchen-button]").click();

    // Ten agents ring checks into this branch at once. A plain before/after diff picked up
    // ORD-20260812-0288 — another agent's TAKEAWAY, rung by Shift Cashier 984155 — and scored my
    // screen as lying about it. The new row must be MINE, and must match what I actually asked
    // for, or this is not the check I rang.
    let mine = null;
    for (let i = 0; i < 20 && !mine; i++) {
      await page.waitForTimeout(1500);
      const after = await liveOrders(bearer);
      mine =
        after.find(
          (o) =>
            !before.has(o.orderNo) &&
            o.cashierId === me &&
            o.type === type &&
            (tableName ? o.tableName === tableName : !o.tableName),
        ) ?? null;
    }
    if (!mine) {
      throw new Error(
        `${label}: no NEW ${type} order of mine (cashier ${me}${tableName ? `, table ${tableName}` : ", untabled"}) appeared after firing`,
      );
    }
    const orderNo = mine.orderNo;
    report.rung[label] = { orderNo, tableName };
    log("  →", JSON.stringify(report.rung[label]));
    await shot(page, `i1-${label}`);
  }

  /**
   * Ring, and forgive the shared machine.
   *
   * The Next dev server recompiles whenever another agent saves a frontend file, which navigates
   * the page out from under a click. That is noise from ten agents sharing one tree, not a
   * product defect, so retry the whole check rather than scoring it.
   */
  async function ringWithRetry(label, type, opts) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await ring(label, type, opts);
        return;
      } catch (e) {
        lastErr = e;
        log(`  ring ${label} attempt ${attempt}/3 failed: ${e.message.split("\n")[0]}`);
        await page.waitForTimeout(6000);
      }
    }
    throw lastErr;
  }

  await ringWithRetry("dineInAtTable", "DINE_IN", { withTable: true });
  await ringWithRetry("dineInNoTable", "DINE_IN");
  await ringWithRetry("takeaway", "TAKEAWAY");

  // ───────────────────────── server truth, on the manager's own bearer ─────────────────────────
  const token = await tokenOf(page);
  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  branchId = new URL(listReq.u).searchParams.get("branchId");
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=60`, token);
  const rows = list.body?.data ?? [];
  const byNo = Object.fromEntries(rows.map((r) => [r.orderNo, r]));
  report.serverRows = Object.values(report.rung)
    .map((v) => byNo[v.orderNo])
    .filter(Boolean)
    .map((r) => ({
      orderNo: r.orderNo,
      type: r.type,
      tableName: r.tableName,
      cashierId: r.cashierId,
      cashierName: r.cashierName,
      itemQuantity: r.itemQuantity,
      distinctItemCount: r.distinctItemCount,
    }));
  log("\n  server rows:", JSON.stringify(report.serverRows, null, 2));

  // ───────────────────────── (1) the Active list ─────────────────────────
  await openOrderManagement(page);
  await page.waitForTimeout(3000);
  await shot(page, "i2-active-list");
  const active = await readRows(page);
  report.headers = active.headers;
  report.activeSeen = active.seen;

  const atTable = active.seen[report.rung.dineInAtTable.orderNo];
  const wantTable = report.rung.dineInAtTable.tableName;
  record(
    "a FRESHLY RUNG dine-in AT A TABLE reads Dine-in and still shows its table",
    !!atTable && /Dine-in/.test(atTable.orderCell) && atTable.orderCell.includes(wantTable),
    `"${atTable?.orderCell}" (picked table ${wantTable})`,
  );

  const noTable = active.seen[report.rung.dineInNoTable.orderNo];
  record(
    "a freshly rung dine-in with NO table reads Dine-in, not Takeaway",
    !!noTable && /Dine-in/.test(noTable.orderCell) && !/Takeaway/.test(noTable.orderCell),
    `"${noTable?.orderCell}"`,
  );

  const ta = active.seen[report.rung.takeaway.orderNo];
  record(
    "a real takeaway still reads Takeaway (positive control)",
    !!ta && /Takeaway/.test(ta.orderCell) && !/Dine-in/.test(ta.orderCell),
    `"${ta?.orderCell}"`,
  );

  const cells = Object.entries(active.seen).map(([no, v]) => ({ no, cashier: v.cashier }));
  const hex = cells.filter((c) => HEX8.test(c.cashier));
  record(
    "Server/Cashier prints a name on every Active row, never an 8-char hex fragment",
    cells.length > 0 && hex.length === 0 && cells.every((c) => c.cashier.length > 0),
    `${cells.length} rows, ${hex.length} hex; names: ${JSON.stringify([...new Set(cells.map((c) => c.cashier))])}`,
  );

  const itemsOk = [atTable, noTable, ta].filter(Boolean).every((v) => {
    const parts = v.items
      .split(" / ")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 1) return !/^1 items$/i.test(parts[0]);
    const nouns = parts.map((p) => p.replace(/[\d\s]/g, "").toLowerCase());
    return new Set(nouns).size === nouns.length;
  });
  record(
    "the Items cell states one count, or two clearly distinct labels",
    itemsOk,
    JSON.stringify([atTable?.items, noTable?.items, ta?.items]),
  );

  // ───────────────────────── (2) the CLOSED chip — a different query ─────────────────────────
  await page.locator("[data-testid=status-filter-CLOSED]").click();
  await page.waitForTimeout(3500);
  await shot(page, "i3-closed-list");
  const closed = await readRows(page);
  report.closedSeen = closed.seen;
  const closedCells = Object.entries(closed.seen).map(([no, v]) => ({
    no,
    cashier: v.cashier,
    cell: v.orderCell,
    actions: v.actionButtons,
  }));
  report.closedCells = closedCells;
  record(
    "the CLOSED chip (a separate server query) also prints names, never hex",
    closedCells.length > 0 &&
      closedCells.every((c) => c.cashier.length > 0 && !HEX8.test(c.cashier)),
    `${closedCells.length} closed rows; names: ${JSON.stringify([...new Set(closedCells.map((c) => c.cashier))])}`,
  );
  record(
    "no CLOSED row offers Cancel or Continue",
    closedCells.length > 0 &&
      closedCells.every((c) => !c.actions.some((b) => /Cancel|Continue/i.test(b))),
    JSON.stringify([...new Set(closedCells.flatMap((c) => c.actions))]),
  );

  // ───────────────────────── (3) the SEARCH path — a third query ─────────────────────────
  await page.locator("[data-testid=status-filter-ALL]").click();
  await page.waitForTimeout(1500);
  await page.locator("[data-testid=order-management-search]").fill(report.rung.takeaway.orderNo);
  await page.waitForTimeout(4000);
  await shot(page, "i4-search");
  const searched = await readRows(page);
  report.searchSeen = searched.seen;
  const hit = searched.seen[report.rung.takeaway.orderNo];
  record(
    "a SEARCH result (third query path) carries the type and the cashier's name",
    !!hit && /Takeaway/.test(hit.orderCell) && hit.cashier.length > 0 && !HEX8.test(hit.cashier),
    `"${hit?.orderCell}" cashier="${hit?.cashier}"`,
  );
  await page.locator("[data-testid=order-management-search]").fill("");
  await page.waitForTimeout(2000);

  // ───────────────────────── void one, with a long reason ─────────────────────────
  const victim = report.rung.dineInAtTable.orderNo;
  report.voidTarget = victim;
  log(`\n=== voiding ${victim} through the drawer, with a ${LONG_REASON.length}-char reason ===`);
  await page.locator("[data-testid=order-management-search]").fill(victim);
  await page.waitForTimeout(5000);
  await shot(page, "i4b-search-victim");
  const victimRow = page.locator("tbody tr", { hasText: victim });
  await victimRow.first().waitFor({ timeout: 30000 });
  report.devOverlayAtVoid = await clearDevOverlay(page);
  await victimRow.first().locator('[data-testid^="open-order-"]').click();
  await page.waitForTimeout(3500);
  await shot(page, "i5-drawer-before-void");
  // Scope every void control to the drawer: the "Voided" status chip on the table BEHIND it
  // also matches a naive :has-text("Void").
  const drawer = page.locator("[data-testid=order-table-detail-drawer]");
  await drawer.locator('button[aria-label="Void order"]').click();
  await page.waitForTimeout(2000);
  const panel = drawer.locator("[data-testid=void-refund-panel]");
  await panel.locator("textarea").fill(LONG_REASON);
  await page.waitForTimeout(500);
  await shot(page, "i6-void-panel");
  await panel.locator('button:has-text("Confirm Void")').click();
  await page.waitForTimeout(6000);
  await shot(page, "i7-after-void");
  // The void panel closes itself; the DRAWER stays open on the now-voided check, which is
  // right — but it must be dismissed before the table underneath can be clicked again.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);

  // ───────────────────────── (4) the VOIDED chip ─────────────────────────
  await openOrderManagement(page);
  await page.waitForTimeout(2500);
  await clearDevOverlay(page);
  await page.locator("[data-testid=status-filter-VOIDED]").click();
  await page.waitForTimeout(4000);
  await shot(page, "i8-voided-list");
  const voided = await readRows(page);
  report.voidedHeaders = voided.headers;
  const vrow = voided.seen[victim];
  report.voidedRow = vrow;

  const srv = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branchId}&status=VOIDED&size=60`,
    token,
  );
  const srvRow = (srv.body?.data ?? []).find((r) => r.orderNo === victim);
  report.serverVoidedRow = srvRow && {
    orderNo: srvRow.orderNo,
    type: srvRow.type,
    tableName: srvRow.tableName,
    settlementStatus: srvRow.settlementStatus,
    cashierName: srvRow.cashierName,
    settlement: srvRow.settlement,
  };

  record(
    "the whole void reason reached the server unclipped",
    srvRow?.settlement?.reason === LONG_REASON,
    `${LONG_REASON.length} chars asked, ${srvRow?.settlement?.reason?.length ?? 0} stored`,
  );
  record(
    "the voided row still reads Dine-in (a void does not turn a check into a takeaway)",
    !!vrow && /Dine-in/.test(vrow.orderCell) && !/Takeaway/.test(vrow.orderCell),
    `"${vrow?.orderCell}"`,
  );
  record(
    "the voided row offers neither Cancel nor Continue",
    !!vrow && !vrow.actionButtons.some((b) => /Cancel|Continue/i.test(b)),
    JSON.stringify(vrow?.actionButtons),
  );
  record(
    "Server/Cashier prints the same string the Voided column prints for that actor",
    !!vrow && vrow.cashier.length > 0 && srvRow?.settlement?.byName === srvRow?.cashierName,
    `Server/Cashier="${vrow?.cashier}"  settlement.byName="${srvRow?.settlement?.byName}"  cashierName="${srvRow?.cashierName}"`,
  );

  // (5) the reason must be reachable by KEYBOARD, not only by mouse.
  const reasonSel = `[data-testid="settlement-reason-${srvRow?.orderId}"]`;
  const clip = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: el.textContent.trim(),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      whiteSpace: cs.whiteSpace,
      title: el.getAttribute("title"),
      tag: el.tagName,
    };
  }, reasonSel);
  report.reasonControl = clip;

  await page.locator(reasonSel).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  await shot(page, "i9-reason-popover-keyboard");
  const pop = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="settlement-reason-full-${id}"]`);
    if (!el) return null;
    const p = el.querySelector("p");
    return {
      text: el.innerText.trim(),
      whiteSpace: getComputedStyle(p).whiteSpace,
      clipped: p.scrollHeight > p.clientHeight + 1,
    };
  }, srvRow?.orderId);
  report.reasonPopover = pop;
  record(
    "the long reason opens IN FULL from the KEYBOARD (Enter), wrapped, not clipped",
    !!pop && pop.text.includes(LONG_REASON) && pop.whiteSpace === "normal" && !pop.clipped,
    pop
      ? `popover carries all ${LONG_REASON.length} chars=${pop.text.includes(LONG_REASON)}, whiteSpace=${pop.whiteSpace}, clipped=${pop.clipped}`
      : "no popover opened on Enter",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  report.managerConsoleErrors = page.__console.slice(0, 8);
} catch (e) {
  log("  !! ", e.message);
  report.error = e.message;
  await shot(page, "i98-manager-failure");
} finally {
  await page.context().close();
}

// ───────────────────────── (6) the CASHIER persona sees names too ─────────────────────────
const cpage = await newPage(browser);
try {
  await signIn(cpage, PEOPLE.cashier);
  const t = await posReady(cpage);
  log("  cashier /app/pos:", JSON.stringify(t));
  await openOrderManagement(cpage);
  await cpage.waitForTimeout(3000);
  // The cashier defaults to "My Orders"; the finding was about every row, so widen if allowed.
  const all = cpage.locator("[data-testid=toggle-all-branch]");
  if (await all.count()) {
    await all.first().click();
    await cpage.waitForTimeout(3000);
  }
  await shot(cpage, "i10-cashier-active-list");
  const crows = await readRows(cpage);
  const ccells = Object.entries(crows.seen).map(([no, v]) => ({
    no,
    cashier: v.cashier,
    cell: v.orderCell,
  }));
  report.cashierCells = ccells;
  record(
    "the CASHIER persona also sees names, never hex, and a real type on every row",
    ccells.length > 0 &&
      ccells.every(
        (c) =>
          c.cashier.length > 0 &&
          !HEX8.test(c.cashier) &&
          /Dine-in|Takeaway|Delivery|Pickup/.test(c.cell),
      ),
    `${ccells.length} rows as cashier; names: ${JSON.stringify([...new Set(ccells.map((c) => c.cashier))])}`,
  );
  report.cashierConsoleErrors = cpage.__console.slice(0, 8);
} catch (e) {
  log("  !! cashier: ", e.message);
  report.cashierError = e.message;
  await shot(cpage, "i99-cashier-failure");
} finally {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  report.finishedAt = stamp;
  writeFileSync(`${OUT}/_independent-${stamp}.json`, JSON.stringify(report, null, 2));
  // Only let a run that actually completed overwrite the headline report — a later crashed run
  // must not erase a clean one.
  if (!report.error) writeFileSync(`${OUT}/_independent.json`, JSON.stringify(report, null, 2));
  log("\n──────── SCORE ────────");
  for (const v of report.verdicts) log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.name}`);
  log(`  ${report.verdicts.filter((v) => v.pass).length}/${report.verdicts.length} passed`);
  await cpage.context().close();
  await browser.close();
}
