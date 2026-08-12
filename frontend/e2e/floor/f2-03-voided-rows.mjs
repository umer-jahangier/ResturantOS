/*
 * F2 step 3 — the Voided chip, where three of the five defects live at once:
 *   (c) a VOIDED row still carrying Cancel/Continue,
 *   (d) a long void reason clipped with nowhere to read the rest,
 *   (e) the Items cell stating a count twice, differently.
 * Measured from computed geometry (scrollWidth vs clientWidth), never from the class list.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  openOrderManagement,
  shot,
  readOrderTable,
  log,
} from "./f2-lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.manager);
  await openOrderManagement(page);
  await page.locator('[data-testid="status-filter-VOIDED"]').click();
  await page.waitForTimeout(3000);
  await shot(page, "02-voided-list");

  const t = await readOrderTable(page);
  log("  headers:", JSON.stringify(t.headers));
  const idx = (name) => t.headers.findIndex((h) => new RegExp(name, "i").test(h));
  const iOrder = idx("Order");
  const iCash = idx("Server/Cashier");
  const iItems = idx("Items");
  const iSettle = idx("Voided");
  const iActions = t.headers.length - 1;

  for (const r of t.rows.slice(0, 8)) {
    const order = r.cells[iOrder]?.text.replace(/\n/g, " | ");
    const cashier = r.cells[iCash]?.text;
    const items = r.cells[iItems]?.text.replace(/\n/g, " / ");
    const settle = r.cells[iSettle];
    const actions = (r.cells[iActions]?.buttons ?? []).map((b) => b.text).join(", ");
    log(`    ${order}`);
    log(`        Server/Cashier: "${cashier}"`);
    log(`        Items cell:     "${items}"`);
    log(`        Voided cell:    "${(settle?.text ?? "").replace(/\n/g, " ⏎ ")}"`);
    log(`        clipped:        ${JSON.stringify(settle?.overflow ?? [])}`);
    log(`        row actions:    [${actions}]`);
  }
} finally {
  await page.context().close();
  await browser.close();
}
