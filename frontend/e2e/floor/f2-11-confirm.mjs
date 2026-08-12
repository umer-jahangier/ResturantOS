/*
 * F2 confirmation, re-driven after pos-service was rebuilt and restarted (check-stale-jars:
 * checked=16 stale=0).
 *
 * Same claims as f2-09, with one concession to a shared machine: by late morning every one of the
 * branch's seven tables is occupied by another agent's check, so a fresh dine-in-AT-a-table cannot
 * be rung. The tabled case is therefore proved against a LIVE tabled dine-in check instead — the
 * server is asked which orders have a tableName, and the screen is required to say "Dine-in · X"
 * for that exact order. That is a stronger read than ringing one, not a weaker one: it is data
 * this harness did not create.
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
const report = { rung: {}, verdicts: [] };
const record = (name, pass, detail) => {
  report.verdicts.push({ name, pass, detail });
  log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

const browser = await newBrowser();
const page = await newPage(browser);

try {
  await login(page, PEOPLE.manager);
  const t = await go(page, "/app/pos", { waitMs: 7000 });
  log("  /app/pos:", JSON.stringify(t));
  if (t.bad.length || t.alerts.length) throw new Error(`POS showed ${JSON.stringify(t)}`);

  async function ring(label, type) {
    log(`\n=== ringing ${label} (${type}) ===`);
    await go(page, "/app/pos", { waitMs: 5000, allowTrouble: true });
    await page.locator(`[data-testid=order-type-${type.toLowerCase()}]`).click();
    await page.waitForTimeout(700);
    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 20000 });
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
    report.rung[label] = nos[nos.length - 1] ?? null;
    log("  →", report.rung[label]);
    await shot(page, `c1-${label}`);
  }

  await ring("dineInNoTable", "DINE_IN");
  await ring("takeaway", "TAKEAWAY");

  const token = await tokenOf(page);
  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = new URL(listReq.u).searchParams.get("branchId");
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=50`, token);
  const rows = list.body?.data ?? [];
  // A live DINE_IN check that HAS a table — not one this harness rang.
  const tabled = rows.find((r) => r.type === "DINE_IN" && r.tableName);
  report.serverRows = [report.rung.dineInNoTable, report.rung.takeaway, tabled?.orderNo]
    .filter(Boolean)
    .map((no) => {
      const r = rows.find((x) => x.orderNo === no);
      return {
        orderNo: r.orderNo,
        type: r.type,
        tableName: r.tableName,
        cashierId: r.cashierId,
        cashierName: r.cashierName,
        itemQuantity: r.itemQuantity,
        distinctItemCount: r.distinctItemCount,
      };
    });
  log("\n  server rows:", JSON.stringify(report.serverRows, null, 2));

  await openOrderManagement(page);
  await page.waitForTimeout(2500);
  await shot(page, "c2-order-management-active");
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
  report.seen = seen;

  const noTable = seen[report.rung.dineInNoTable];
  record(
    "untabled DINE_IN reads Dine-in, not Takeaway",
    !!noTable && /Dine-in/.test(noTable.orderCell) && !/Takeaway/.test(noTable.orderCell),
    `"${noTable?.orderCell}"`,
  );

  const ta = seen[report.rung.takeaway];
  record(
    "real TAKEAWAY still reads Takeaway",
    !!ta && /Takeaway/.test(ta.orderCell) && !/Dine-in/.test(ta.orderCell),
    `"${ta?.orderCell}"`,
  );

  const tabledCell = tabled ? seen[tabled.orderNo] : null;
  record(
    "a live tabled DINE_IN reads Dine-in AND still shows its table",
    !!tabledCell &&
      /Dine-in/.test(tabledCell.orderCell) &&
      tabledCell.orderCell.includes(tabled.tableName),
    `"${tabledCell?.orderCell}" (server tableName=${JSON.stringify(tabled?.tableName)})`,
  );

  const cells = Object.entries(seen).map(([no, v]) => ({ no, cashier: v.cashier }));
  const hex = cells.filter((c) => HEX8.test(c.cashier));
  report.cashierCells = cells;
  record(
    "Server/Cashier prints a name on every row, never an 8-char hex fragment",
    hex.length === 0 && cells.every((c) => c.cashier.length > 0),
    `${cells.length} rows on screen, ${hex.length} hex; distinct names: ${JSON.stringify([...new Set(cells.map((c) => c.cashier))])}`,
  );

  const itemsOk = [noTable, ta, tabledCell].filter(Boolean).every((v) => {
    const parts = v.items.split(" / ").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) return !/^1 items$/i.test(parts[0]);
    const nouns = parts.map((p) => p.replace(/[\d\s]/g, "").toLowerCase());
    return new Set(nouns).size === nouns.length;
  });
  record(
    "Items cell states one count, or two clearly distinct labels",
    itemsOk,
    JSON.stringify([noTable?.items, ta?.items, tabledCell?.items]),
  );

  report.consoleErrors = page.__console.slice(0, 8);
} catch (e) {
  log("  !! ", e.message);
  report.error = e.message;
  await shot(page, "c99-failure");
} finally {
  writeFileSync(`${OUT}/_confirm.json`, JSON.stringify(report, null, 2));
  log("\n──────── SCORE ────────");
  for (const v of report.verdicts) log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.name}`);
  log(`  ${report.verdicts.filter((v) => v.pass).length}/${report.verdicts.length} passed`);
  await page.context().close();
  await browser.close();
}
