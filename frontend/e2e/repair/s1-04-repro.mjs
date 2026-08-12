/*
 * S1 #11 reproduction — drive the REAL board as kitchen@terrace.local and measure:
 *
 *   1. every page's per-column occupancy (the register saw NEW 16 / STARTED 0 / PREPARING 0
 *      / READY 0 on page 1 of 3);
 *   2. how many rendered cards carry NO position number;
 *   3. what happens to a ticket the cook bumps with the MOUSE — does it stay on screen?
 *
 *   node e2e/repair/s1-04-repro.mjs before|after
 */
import { chromium } from "@playwright/test";
import { BASE, login, probeBoard, fmt, shot, walkPages } from "./s1-04-lib.mjs";

const LABEL = process.argv[2] ?? "run";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("    [console.error]", m.text().slice(0, 160));
  });

  await login(page);
  await page.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="kds-board"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(3500);

  const first = await probeBoard(page);
  if (first.alerts.length) {
    console.log("!! board is in an ERROR state, not an empty state:", first.alerts);
  }
  console.log("\n== 1. page walk ==");
  const pages = await walkPages(page);
  pages.forEach((p, i) => console.log(`  p${i + 1}: ${fmt(p)}`));
  const worst = pages.reduce((a, p) => a + p.unnumbered.length, 0);
  console.log(`  TOTAL rendered cards with no position number across all pages: ${worst}`);
  const starved = pages.filter(
    (p) => p.columns[0].n > 0 && p.columns.slice(1).every((c) => c.n === 0),
  ).length;
  console.log(`  pages where NEW is occupied and all three progress columns are EMPTY: ${starved}`);

  // back to page 1
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("PageUp");
  await page.waitForTimeout(500);
  await shot(page, `${LABEL}-01-page1`);

  console.log("\n== 2. mouse bump: does the ticket stay on the cook's screen? ==");
  const before = await probeBoard(page);
  console.log("  before:", fmt(before));
  const firstNew = before.columns[0].rendered[0];
  if (!firstNew) {
    console.log("  no NEW card on page 1 — cannot run the bump probe");
  } else {
    const ticketId = firstNew.key.split(":")[1];
    console.log(`  bumping NEW card ${firstNew.key} (pos "${firstNew.pos}")`);
    const btn = page
      .locator(`[data-fragment-key="NEW:${ticketId}"] button[data-testid^="column-move-"]`)
      .first();
    await btn.click();
    await page.waitForTimeout(4000);
    const after = await probeBoard(page);
    console.log("  after :", fmt(after));
    const stillOnScreen = after.columns
      .flatMap((c) => c.rendered.map((r) => r.key))
      .filter((k) => k.endsWith(ticketId));
    console.log(
      stillOnScreen.length
        ? `  VISIBLE on this page as ${stillOnScreen.join(", ")}`
        : `  *** VANISHED — ticket ${ticketId.slice(0, 8)} is on NO column of the page the cook is looking at`,
    );
    await shot(page, `${LABEL}-02-after-bump`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
