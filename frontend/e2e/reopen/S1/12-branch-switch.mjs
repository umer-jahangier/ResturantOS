/* The screen claims "Routing is set per branch". Switch branch and see whether it means it. */
import { newBrowser, newPage, login, PEOPLE, go, shot, log, writeJson, loadState } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const out = {};
try {
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);
  await go(page, "/app/menu/routing", { waitMs: 5000 });

  const read = () =>
    page.evaluate(() => ({
      branchChip: document.querySelector('[aria-label="Switch branch"]')?.textContent?.trim() ?? null,
      summary: document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
      cats: document.querySelectorAll('[data-testid="routing-category"]').length,
      rows: document.querySelectorAll('[data-testid="routing-item"]').length,
      drinks:
        document
          .querySelector('[data-testid="routing-category"][data-category-name="Drinks"] [data-testid="category-station-select"]')
          ?.selectedOptions?.[0]?.text ?? null,
      emptyTitle: /This branch has no stations yet|No menu categories yet/.exec(document.body.innerText || "")?.[0] ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
      body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 320),
    }));

  out.before = await read();
  log("  HQ:", JSON.stringify(out.before));
  await shot(page, "12a-hq");

  const trigger = page.locator('[aria-label="Switch branch"]').first();
  out.switcherPresent = (await trigger.count()) > 0;
  log(`  switcher present: ${out.switcherPresent}`);
  if (out.switcherPresent) {
    await trigger.click();
    await page.waitForTimeout(1000);
    const items = await page.locator('[role="menuitem"]').allInnerTexts();
    out.menu = items;
    log(`  branch menu: ${JSON.stringify(items)}`);
    const other = page.locator('[role="menuitem"]').filter({ hasText: /S4 Reopen|Rooftop/i }).first();
    if (await other.count()) {
      await other.click();
      await page.waitForTimeout(9000);
      out.after = await read();
      log("  OTHER BRANCH:", JSON.stringify(out.after));
      await shot(page, "12b-other-branch");
      out.differs =
        out.after.summary !== out.before.summary ||
        out.after.emptyTitle !== out.before.emptyTitle ||
        out.after.drinks !== out.before.drinks;
      log(`  the screen changed with the branch: ${out.differs}`);
    } else {
      out.after = { error: "no other branch entry" };
    }
  }
  writeJson("12-branch-switch.json", out);
} finally {
  await browser.close();
}
