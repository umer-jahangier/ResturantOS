/*
 * F2 audit re-drive — the DONE MEANS, start to finish, in one run.
 *
 * Independent of the earlier f2-0x scripts: it rings THREE fresh checks, reads them back off
 * Order Management the way a manager does, voids one with a reason long enough to need wrapping,
 * and scores every claim in the item's DONE MEANS against what is on the screen.
 *
 *   1. dine-in AT a table          → must read "Dine-in · <table>"
 *   2. dine-in with NO table       → must read "Dine-in", never "Takeaway"
 *   3. takeaway                    → must still read "Takeaway"
 *   4. Server/Cashier              → a display name, never an 8-char hex fragment
 *   5. void #2 with a long reason  → readable in full; the voided row loses Cancel/Continue
 *   6. Items                       → one count, or two differently-labelled counts
 *
 * Everything is read from the DOM the user sees. The one out-of-band read (the server's own rows)
 * spends the manager's OWN refresh cookie, so "the column is wrong" can never be confused with
 * "this persona cannot see it".
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
const LONG_REASON =
  "F2 audit — the guest was quoted the wrong price on the specials board, refused the check at " +
  "the pass and walked out before anything was served, so the whole thing comes off the bill";

const HEX8 = /^[0-9a-f]{8}$/i;
const verdicts = [];
const record = (name, pass, detail) => {
  verdicts.push({ name, pass, detail });
  log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

const browser = await newBrowser();
const page = await newPage(browser);
const rung = {};
const report = { rung, longReason: LONG_REASON };

try {
  await login(page, PEOPLE.manager);
  let t = await go(page, "/app/pos", { waitMs: 7000 });
  log("  /app/pos:", JSON.stringify(t));

  // The manager needs their own drawer before the server lets them open a check.
  if (await page.locator('[data-testid="pos-till-closed-notice"]').count()) {
    const openBtn = page.locator('button:has-text("Open Till")');
    if (await openBtn.count()) {
      await openBtn.first().click();
      await page.waitForTimeout(1500);
      const float = page.locator('input[type="number"], input[inputmode="decimal"]');
      if (await float.count()) await float.first().fill("5000");
      await page.locator('button:has-text("Open Till"), button[type="submit"]').last().click();
      await page.waitForTimeout(4000);
    }
  }
  await shot(page, "a1-terminal");

  async function ring(label, type, withTable) {
    log(`\n=== ringing ${label} (${type}, table=${withTable}) ===`);
    await go(page, "/app/pos", { waitMs: 5000, allowTrouble: true });
    await page.locator(`[data-testid=order-type-${type.toLowerCase()}]`).click();
    await page.waitForTimeout(700);

    if (withTable) {
      const trigger = page.locator("[data-testid=table-select-trigger]");
      if (!(await trigger.count())) throw new Error("no table picker on a dine-in order");
      await trigger.click();
      await page.waitForTimeout(1200);
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
          id: n.getAttribute("data-testid"),
          t: n.innerText.replace(/\s+/g, " ").trim(),
        })),
      );
      const free = opts.find((o) => /AVAILABLE|Free|Open/i.test(o.t)) ?? opts[0];
      await page.locator(`[data-testid="${free.id}"]`).click();
      await page.waitForTimeout(1000);
      rung[`${label}TableTile`] = free.t;
      log("  table chosen:", free.t);
    } else {
      // Prove the picker is genuinely absent/unset, so "no table" is real and not a mis-click.
      const picked = await page
        .locator("[data-testid=table-select-trigger]")
        .first()
        .innerText()
        .catch(() => "(no picker)");
      log("  table picker reads:", JSON.stringify(picked.replace(/\s+/g, " ").trim()));
    }

    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 20000 });
    // 3 units across 2 lines, so the Items cell has two numbers that could disagree.
    await tiles.nth(0).click();
    await page.waitForTimeout(250);
    await tiles.nth(0).click();
    await page.waitForTimeout(250);
    await tiles.nth(1).click();
    await page.waitForTimeout(900);

    await page.locator("[data-testid=send-to-kitchen-button]").click();
    await page.waitForTimeout(6500);
    const nos = await page.evaluate(() =>
      Array.from(
        new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])),
      ),
    );
    rung[label] = nos[nos.length - 1] ?? null;
    log("  →", rung[label]);
    await shot(page, `a2-${label}`);
  }

  await ring("dineInAtTable", "DINE_IN", true);
  await ring("dineInNoTable", "DINE_IN", false);
  await ring("takeaway", "TAKEAWAY", false);

  // ── the server's own answer, on the manager's own bearer ────────────────────────────────
  const token = await tokenOf(page);
  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = new URL(listReq.u).searchParams.get("branchId");
  report.branchId = branchId;
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=30`, token);
  const wanted = [rung.dineInAtTable, rung.dineInNoTable, rung.takeaway];
  report.serverRows = (list.body?.data ?? [])
    .filter((r) => wanted.includes(r.orderNo))
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

  // ── what the manager reads on Order Management ──────────────────────────────────────────
  await openOrderManagement(page);
  await page.waitForTimeout(2500);
  await shot(page, "a3-order-management-active");
  const table = await readOrderTable(page);
  report.headers = table.headers;
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
    };
  }
  report.seenActive = Object.fromEntries(
    Object.entries(seen).filter(([no]) => wanted.includes(no)),
  );
  log("\n  the three checks as the manager reads them:");
  for (const no of wanted) log(`    ${no}: ${JSON.stringify(seen[no])}`);

  // 1 — the untabled dine-in check
  const noTable = seen[rung.dineInNoTable];
  record(
    "untabled DINE_IN reads Dine-in, not Takeaway",
    !!noTable && /Dine-in/.test(noTable.orderCell) && !/Takeaway/.test(noTable.orderCell),
    `"${noTable?.orderCell}"`,
  );

  // 2 — the tabled dine-in check keeps its table
  const atTable = seen[rung.dineInAtTable];
  const tableWord = (rung.dineInAtTableTileName ?? rung.dineInAtTableTile ?? "").trim();
  const serverTable = report.serverRows.find((r) => r.orderNo === rung.dineInAtTable)?.tableName;
  record(
    "tabled DINE_IN reads Dine-in AND still shows the table",
    !!atTable &&
      /Dine-in/.test(atTable.orderCell) &&
      !!serverTable &&
      atTable.orderCell.includes(serverTable),
    `"${atTable?.orderCell}" (server tableName=${JSON.stringify(serverTable)}) ${tableWord}`,
  );

  // 3 — a real takeaway still reads Takeaway
  const ta = seen[rung.takeaway];
  record(
    "real TAKEAWAY still reads Takeaway",
    !!ta && /Takeaway/.test(ta.orderCell) && !/Dine-in/.test(ta.orderCell),
    `"${ta?.orderCell}"`,
  );

  // 4 — Server/Cashier is a name, on EVERY row on screen, not only mine
  const allCashierCells = Object.entries(seen).map(([no, v]) => ({ no, cashier: v.cashier }));
  const hexRows = allCashierCells.filter((c) => HEX8.test(c.cashier));
  report.cashierCells = allCashierCells;
  record(
    "Server/Cashier prints a name on every row, never an 8-char hex fragment",
    hexRows.length === 0 && allCashierCells.every((c) => c.cashier.length > 0),
    `${allCashierCells.length} rows on screen, ${hexRows.length} still hex; mine reads "${noTable?.cashier}"`,
  );

  // 6 — the Items cell
  const itemsOk = Object.values(report.seenActive).every((v) => {
    const parts = v.items.split(" / ").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) return true;
    const nouns = parts.map((p) => p.replace(/[\d\s]/g, "").toLowerCase());
    return new Set(nouns).size === nouns.length; // two lines, two DIFFERENT nouns
  });
  record(
    "Items cell states one count, or two clearly distinct labels",
    itemsOk,
    JSON.stringify(Object.values(report.seenActive).map((v) => v.items)),
  );

  // ── void the untabled dine-in with a long reason ────────────────────────────────────────
  const target = rung.dineInNoTable;
  log(`\n=== voiding ${target} with a ${LONG_REASON.length}-character reason ===`);
  await page.locator(`button[aria-label^="Open order ${target}"]`).first().click();
  await page.waitForTimeout(3000);
  const voidTrigger = page.locator('button[aria-label*="Void order" i]');
  await voidTrigger.first().click();
  await page.waitForTimeout(1200);
  await page.locator("textarea, input[placeholder*='reason' i]").first().fill(LONG_REASON);
  await shot(page, "a4-void-panel");
  await page.locator('button:has-text("Confirm Void")').first().click();
  await page.waitForTimeout(5000);
  const alerts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
  );
  report.alertsAfterVoid = alerts;
  log("  alerts after confirm:", JSON.stringify(alerts));
  await shot(page, "a5-after-void");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);

  // ── the Voided chip ─────────────────────────────────────────────────────────────────────
  await page.locator('[data-testid="status-filter-VOIDED"]').click();
  await page.waitForTimeout(3500);
  await shot(page, "a6-voided-list");
  const voided = await readOrderTable(page);
  const vIdx = (re) => voided.headers.findIndex((h) => re.test(h));
  const vOrder = vIdx(/Order/i);
  const vCash = vIdx(/Server\/Cashier/i);
  const vSettle = vIdx(/Voided/i);
  const vRow = voided.rows.find((r) => (r.cells[vOrder]?.text ?? "").includes(target));
  report.voidedRow = vRow
    ? {
        order: vRow.cells[vOrder].text.replace(/\n/g, " | "),
        cashier: vRow.cells[vCash].text.trim(),
        settlement: vRow.cells[vSettle].text.replace(/\n/g, " | "),
        settlementTitles: vRow.cells[vSettle].titles,
        actionButtons: vRow.cells[vRow.cells.length - 1].buttons.map((b) => b.text),
      }
    : null;
  log("\n  voided row:", JSON.stringify(report.voidedRow, null, 2));

  record(
    "the voided row offers neither Cancel nor Continue",
    !!vRow &&
      !report.voidedRow.actionButtons.some((b) => /^(Cancel|Continue)$/i.test(b.trim())) &&
      report.voidedRow.actionButtons.some((b) => /^Open$/i.test(b.trim())),
    JSON.stringify(report.voidedRow?.actionButtons),
  );

  // The Server/Cashier string and the Voided byline must name the SAME actor the same way.
  const bylineName = /by ([^·]+)·/.exec(report.voidedRow?.settlement ?? "")?.[1]?.trim();
  report.bylineName = bylineName;
  record(
    "Server/Cashier prints the same string the Voided column prints for that actor",
    !!bylineName && bylineName === report.voidedRow?.cashier,
    `Server/Cashier="${report.voidedRow?.cashier}"  Voided byline="${bylineName}"`,
  );

  // The reason, in full, by a press — and measured for clipping first.
  const clip = await page.evaluate((no) => {
    const tr = Array.from(document.querySelectorAll("tbody tr")).find((r) =>
      (r.innerText || "").includes(no),
    );
    if (!tr) return null;
    const btn = tr.querySelector('button[data-testid^="settlement-reason-"]');
    if (!btn) return { noButton: true };
    const cs = getComputedStyle(btn);
    return {
      text: btn.textContent.trim(),
      scrollWidth: btn.scrollWidth,
      clientWidth: btn.clientWidth,
      whiteSpace: cs.whiteSpace,
      title: btn.getAttribute("title"),
      ariaLabel: btn.getAttribute("aria-label"),
    };
  }, target);
  report.reasonControl = clip;
  log("\n  reason control:", JSON.stringify(clip, null, 2));

  await page.locator(`button[data-testid^="settlement-reason-"]`).first().click();
  await page.waitForTimeout(1200);
  const popover = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const p = d.querySelector("p");
    return {
      text: d.innerText.trim(),
      whiteSpace: p ? getComputedStyle(p).whiteSpace : null,
      wordBreak: p ? getComputedStyle(p).overflowWrap : null,
      clipped: p ? p.scrollHeight > p.clientHeight + 1 : null,
    };
  });
  report.reasonPopover = popover;
  await shot(page, "a7-voided-reason-open");
  record(
    "the long void reason is readable in full by a press (not hover-only)",
    !!popover && popover.text.includes(LONG_REASON) && popover.clipped === false,
    `popover carries ${LONG_REASON.length} chars, clipped=${popover?.clipped}, whiteSpace=${popover?.whiteSpace}`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── responsive + dark, on the screen that changed ───────────────────────────────────────
  for (const [w, h, tag] of [
    [390, 844, "390"],
    [768, 1024, "768"],
    [1440, 950, "1440"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1200);
    const hOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    report[`bodyScrollsHorizontally@${tag}`] = hOverflow;
    await shot(page, `a8-voided-${tag}`);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(1200);
  await shot(page, "a9-voided-1440-dark");
  await page.emulateMedia({ colorScheme: "light" });

  report.consoleErrors = page.__console.slice(0, 10);
} catch (e) {
  log("  !! ", e.message, e.stack);
  report.error = e.message;
  await shot(page, "a99-failure");
} finally {
  report.verdicts = verdicts;
  writeFileSync(`${OUT}/_audit.json`, JSON.stringify(report, null, 2));
  log("\n──────── SCORE ────────");
  for (const v of verdicts) log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.name}`);
  log(`  ${verdicts.filter((v) => v.pass).length}/${verdicts.length} passed`);
  await page.context().close();
  await browser.close();
}
