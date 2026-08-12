/*
 * F2 step 4 — the DONE MEANS, driven end to end as the manager who reads this screen all day.
 *
 *   1. Ring a dine-in check AT A TABLE.
 *   2. Ring a dine-in check with NO TABLE — the row the product used to call "Takeaway".
 *   3. Ring a TAKEAWAY check.
 *   4. Read all three off Order Management: type, table, Server/Cashier, Items.
 *   5. Void one with a long reason; read it back on the Voided chip.
 *
 * No token injection anywhere: the manager signs in and every out-of-band read spends their own
 * refresh cookie, so "the column is broken" cannot be confused with "this persona cannot see it".
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
  saveState,
  log,
} from "./f2-lib.mjs";

const LONG_REASON =
  "F2 proof — the guest was quoted the wrong price on the board, refused the check at the pass and left before service, so the whole thing is coming off";

const browser = await newBrowser();
const page = await newPage(browser);
const rung = {};

try {
  await login(page, PEOPLE.manager);
  let t = await go(page, "/app/pos", { waitMs: 7000 });
  log("  /app/pos:", JSON.stringify(t));

  // ── The manager needs their own drawer before the server will let them open a check ────────
  const tillClosed = await page.locator('[data-testid="pos-till-closed-notice"]').count();
  log("  till closed notice:", tillClosed);
  if (tillClosed) {
    const openBtn = page.locator('button:has-text("Open Till")');
    if (await openBtn.count()) {
      await openBtn.first().click();
      await page.waitForTimeout(1500);
      const float = page.locator('input[type="number"], input[inputmode="decimal"]');
      if (await float.count()) await float.first().fill("5000");
      await shot(page, "03-open-till-dialog");
      const confirm = page.locator('button:has-text("Open Till"), button[type="submit"]').last();
      await confirm.click();
      await page.waitForTimeout(4000);
    }
  }
  await shot(page, "04-terminal");

  /** Ring a check: choose the type, optionally a table, add two dishes, fire it. */
  async function ring(label, type, withTable) {
    log(`\n=== ringing ${label} (${type}, table=${withTable}) ===`);
    await page.locator(`[data-testid=order-type-${type.toLowerCase()}]`).click();
    await page.waitForTimeout(600);

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
      log("  table chosen:", JSON.stringify(free));
      await page.locator(`[data-testid="${free.id}"]`).click();
      await page.waitForTimeout(1000);
      rung[`${label}Table`] = free.t;
    }

    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 20000 });
    // Two DIFFERENT dishes, one of them twice: 3 units across 2 lines, so the Items cell has
    // two numbers to disagree about.
    await tiles.nth(0).click();
    await page.waitForTimeout(250);
    await tiles.nth(0).click();
    await page.waitForTimeout(250);
    await tiles.nth(1).click();
    await page.waitForTimeout(900);

    await page.locator("[data-testid=send-to-kitchen-button]").click();
    await page.waitForTimeout(6500);
    const nos = await page.evaluate(() =>
      Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
    );
    log("  order numbers visible after fire:", JSON.stringify(nos));
    rung[label] = nos[nos.length - 1] ?? null;
    await shot(page, `05-${label}-fired`);

    // Back to a clean terminal for the next check.
    await go(page, "/app/pos", { waitMs: 5000 });
  }

  await ring("dineInAtTable", "DINE_IN", true);
  await ring("dineInNoTable", "DINE_IN", false);
  await ring("takeaway", "TAKEAWAY", false);
  log("\n  rang:", JSON.stringify(rung));
  saveState({ rung });

  // ── What the server holds for those three, on the manager's own bearer ────────────────────
  const token = await tokenOf(page);
  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = new URL(listReq.u).searchParams.get("branchId");
  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=20`, token);
  const mine = (list.body?.data ?? []).filter((r) =>
    Object.values(rung).includes(r.orderNo),
  );
  log("\n  the server's own rows for the three checks:");
  for (const r of mine) {
    log(
      `    ${r.orderNo}  type=${r.type}  tableName=${JSON.stringify(r.tableName)}  cashierName=${JSON.stringify(r.cashierName)}  cashierId=${r.cashierId?.slice(0, 8)}  items=${r.itemQuantity}/${r.distinctItemCount}`,
    );
  }

  // ── What the MANAGER sees on Order Management ────────────────────────────────────────────
  await openOrderManagement(page);
  await page.waitForTimeout(2500);
  await shot(page, "06-order-management-active");
  const table = await readOrderTable(page);
  log("\n  headers:", JSON.stringify(table.headers));
  const idx = (re) => table.headers.findIndex((h) => re.test(h));
  const iOrder = idx(/Order/i);
  const iCash = idx(/Server\/Cashier/i);
  const iItems = idx(/Items/i);

  const seen = {};
  for (const r of table.rows) {
    const cell = r.cells[iOrder]?.text.replace(/\n/g, " | ") ?? "";
    const no = /ORD-\d{8}-\d+/.exec(cell)?.[0];
    if (!no || !Object.values(rung).includes(no)) continue;
    seen[no] = {
      orderCell: cell,
      cashier: r.cells[iCash]?.text,
      items: r.cells[iItems]?.text.replace(/\n/g, " / "),
    };
  }
  log("\n  the three checks as the manager reads them:");
  for (const [no, v] of Object.entries(seen)) {
    log(`    ${no}`);
    log(`        Order / Type:   "${v.orderCell}"`);
    log(`        Server/Cashier: "${v.cashier}"`);
    log(`        Items:          "${v.items}"`);
  }

  const HEX8 = /^[0-9a-f]{8}$/i;
  const hexCells = Object.values(seen).filter((v) => HEX8.test(v.cashier ?? ""));
  log(`\n  rows still showing an 8-char hex fragment: ${hexCells.length}/${Object.keys(seen).length}`);
  saveState({ seenActive: seen, branchId });

  // ── Void the untabled dine-in check with a LONG reason ───────────────────────────────────
  const target = rung.dineInNoTable;
  log(`\n=== voiding ${target} with a ${LONG_REASON.length}-character reason ===`);
  const openBtn = page.locator(`button[aria-label^="Open order ${target}"]`);
  await openBtn.first().click();
  await page.waitForTimeout(3000);
  await shot(page, "07-drawer-before-void");
  const voidTrigger = page.locator('button[aria-label*="Void order" i]');
  log("  void trigger count:", await voidTrigger.count());
  await voidTrigger.first().click();
  await page.waitForTimeout(1200);
  const reasonBox = page.locator("textarea, input[placeholder*='reason' i]");
  await reasonBox.first().fill(LONG_REASON);
  await shot(page, "08-void-panel");
  await page.locator('button:has-text("Confirm Void")').first().click();
  await page.waitForTimeout(5000);
  await shot(page, "09-after-void");
  const alerts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
  );
  log("  alerts after confirm:", JSON.stringify(alerts));

  // close the drawer
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
} catch (e) {
  log("  !! ", e.message);
  await shot(page, "99-failure");
  throw e;
} finally {
  saveState({ rung, longReason: LONG_REASON });
  await page.context().close();
  await browser.close();
}
