/*
 * F2 step 5 — the Voided chip, which is where three of the five defects lived.
 *
 *   (a) the Server/Cashier column beside a settlement column that already printed a name,
 *   (c) Cancel / Continue offered on a check that is already dead,
 *   (d) a long reason clipped with nowhere to read the rest.
 *
 * Truncation is measured from computed geometry (scrollWidth vs clientWidth) and the reveal is
 * driven by a real CLICK, because `title` is a hover affordance and this screen is used on a
 * tablet.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  shot,
  openOrderManagement,
  readOrderTable,
  loadState,
  log,
} from "./f2-lib.mjs";

const st = loadState();
const TARGET = st.rung?.dineInNoTable;
const LONG = st.longReason;
if (!TARGET) throw new Error("run f2-04-prove.mjs first");

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.manager);
  await openOrderManagement(page);
  // The stack is shared with nine other agents and pos-service is being cycled; never score a
  // screen mid-outage. Press the chip until the list actually answers.
  let t = { rows: [], headers: [] };
  for (let attempt = 1; attempt <= 12; attempt++) {
    await page.locator('[data-testid="status-filter-VOIDED"]').click();
    await page.waitForTimeout(4000);
    t = await readOrderTable(page);
    const outage = await page.evaluate(
      () => !!document.querySelector('[data-testid="query-error"]'),
    );
    log(`  attempt ${attempt}: rows=${t.rows.length} outageOnScreen=${outage}`);
    if (t.rows.length > 0) break;
    const retry = page.locator('button:has-text("Try again")');
    if (await retry.count()) await retry.first().click();
    await page.waitForTimeout(6000);
  }
  await shot(page, "10-voided-list");
  log("  headers:", JSON.stringify(t.headers));
  const idx = (re) => t.headers.findIndex((h) => re.test(h));
  const iOrder = idx(/Order/i);
  const iCash = idx(/Server\/Cashier/i);
  const iItems = idx(/Items/i);
  const iSettle = idx(/^Voided$/i);
  const iActions = t.headers.length - 1;

  let target = null;
  const takeawayLabelled = [];
  for (const r of t.rows) {
    const cell = r.cells[iOrder]?.text.replace(/\n/g, " | ") ?? "";
    if (/Takeaway/.test(cell)) takeawayLabelled.push(cell);
    if (cell.includes(TARGET)) target = r;
  }

  // Nine other agents are voiding checks on this branch, so the target drops off page 1 within
  // minutes. Search for it — the chip stays on Voided, so the settlement column is still there.
  if (!target) {
    log(`\n  ${TARGET} has aged off page 1; searching for it with the Voided chip still selected`);
    await page.locator('[data-testid="order-management-search"]').fill(TARGET);
    await page.waitForTimeout(7000);
    const s = await readOrderTable(page);
    log("  search headers:", JSON.stringify(s.headers));
    target = s.rows.find((r) => (r.cells[iOrder]?.text ?? "").includes(TARGET)) ?? null;
    await shot(page, "10b-voided-search");
  }
  log(`\n  rows on this page labelled Takeaway: ${takeawayLabelled.length}/${t.rows.length}`);
  log("  (the walkthrough photographed thirteen consecutive Takeaway rows here)");
  for (const r of t.rows.slice(0, 6)) {
    log(`    ${r.cells[iOrder]?.text.replace(/\n/g, " | ")}   cashier="${r.cells[iCash]?.text}"   actions=[${(r.cells[iActions]?.buttons ?? []).map((b) => b.text).join(", ")}]`);
  }

  if (!target) throw new Error(`${TARGET} is not on the Voided chip`);
  log(`\n  === ${TARGET} ===`);
  log(`    Order / Type:   "${target.cells[iOrder]?.text.replace(/\n/g, " | ")}"`);
  log(`    Server/Cashier: "${target.cells[iCash]?.text}"`);
  log(`    Items:          "${target.cells[iItems]?.text.replace(/\n/g, " / ")}"`);
  log(`    Voided cell:    "${target.cells[iSettle]?.text.replace(/\n/g, " ⏎ ")}"`);
  log(`    clipped:        ${JSON.stringify(target.cells[iSettle]?.overflow ?? [])}`);
  const actions = (target.cells[iActions]?.buttons ?? []).map((b) => b.text);
  log(`    row actions:    [${actions.join(", ")}]`);
  log(`    offers Cancel:   ${actions.some((a) => /^Cancel$/.test(a))}`);
  log(`    offers Continue: ${actions.some((a) => /^Continue$/.test(a))}`);

  // ── Can the whole reason be READ? Press THIS ROW's control and look. ─────────────────────
  // `.first()` would open a different check's reason and prove nothing about this one.
  const trigger = page.locator(`button[aria-label*="full reason for order ${TARGET}" i]`);
  log(`\n  reason controls on the page: ${await page.locator('button[aria-label*="full reason" i]').count()}`);
  log(`  control for ${TARGET}: ${await trigger.count()}`);
  await trigger.first().click();
  await page.waitForTimeout(1200);
  await shot(page, "11-voided-reason-open");
  const revealed = await page.evaluate(() => {
    const box = document.querySelector('[data-slot="popover-content"]');
    if (!box) return null;
    const p = box.querySelector("p");
    return {
      text: box.innerText.replace(/\n/g, " ⏎ "),
      whiteSpace: p ? getComputedStyle(p).whiteSpace : null,
      clipped: p ? p.scrollWidth > p.clientWidth + 1 : null,
      role: box.getAttribute("role"),
    };
  });
  log("  revealed:", JSON.stringify(revealed, null, 1));
  log(`  contains the WHOLE reason: ${revealed?.text?.includes(LONG)}`);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── The same page at 390 and 768, and in dark ────────────────────────────────────────────
  for (const [w, h, name] of [
    [390, 844, "12-voided-390"],
    [768, 1024, "13-voided-768"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1800);
    await shot(page, name);
    const overflowsX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    log(`  ${w}px — page scrolls horizontally: ${overflowsX}`);
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(1500);
  await shot(page, "14-voided-dark");
  const darkTrigger = page.locator('button[aria-label*="full reason" i]').first();
  if (await darkTrigger.count()) {
    await darkTrigger.click();
    await page.waitForTimeout(1000);
    await shot(page, "15-voided-reason-dark");
  }
} finally {
  await page.context().close();
  await browser.close();
}
