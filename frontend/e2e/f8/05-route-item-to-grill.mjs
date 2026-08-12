/*
 * Step 5 — route "Butter Naan" to the GRILL station through the UI, as owner.
 *
 * Butter Naan is chosen because the walkthrough measured it firing to the DEFAULT board. If its
 * ticket lands on the GRILL printer after this and NOT on the DEFAULT one, the binding made on the
 * Printers screen is the thing that moved the paper.
 */
import { newBrowser, newPage, login, go, shot, PEOPLE } from "./lib.mjs";

const ITEM = process.argv[2] ?? "Butter Naan";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  const t = await go(page, "/app/menu/routing", { waitMs: 4000, allowTrouble: true });
  if (t.alerts.length) console.log("alerts:", JSON.stringify(t.alerts));

  // Wait for the DATA, not for a clock. A fixed sleep here scored this screen as empty once today.
  await page.locator('[data-testid="routing-item"]').first().waitFor({ timeout: 30_000 });
  console.log("routing items:", await page.locator('[data-testid="routing-item"]').count());

  const row = page.locator(`[data-testid="routing-item"][data-item-name="${ITEM}"]`).first();
  await row.waitFor({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  console.log(`${ITEM} before:`, await row.getAttribute("data-effective-station"));
  console.log("  destination text:", (await row.locator('[data-testid="routing-item-destination"]').textContent())?.replace(/\s+/g, " "));
  await shot(page, "05a-before-routing");

  const select = row.locator('[data-testid="item-station-select"]');
  const labels = await select.locator("option").allTextContents();
  const grill = labels.find((o) => /GRILL/.test(o));
  if (!grill) throw new Error(`no GRILL option; saw ${JSON.stringify(labels)}`);
  await select.selectOption({ label: grill });
  await page.waitForTimeout(4000);

  const after = page.locator(`[data-testid="routing-item"][data-item-name="${ITEM}"]`).first();
  console.log(`${ITEM} after:`, await after.getAttribute("data-effective-station"));
  console.log("  destination text:", (await after.locator('[data-testid="routing-item-destination"]').textContent())?.replace(/\s+/g, " "));
  await after.scrollIntoViewIfNeeded();
  await shot(page, "05b-item-routed-to-grill");
} finally {
  await browser.close();
}
