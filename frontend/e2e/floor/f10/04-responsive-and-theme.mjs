/*
 * F10 step 4 — the search box at 390 / 768 / 1440, in both themes.
 *
 * Computed style is read, never the class list: `cn()`/tailwind-merge has silently dropped
 * utility classes in this repo before, and a class in the source is not a class in the DOM.
 *
 * ONE sign-in, then resize and re-emulate. Six separate logins tripped a rate limit on the fifth.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, log } from "./lib.mjs";

const browser = await newBrowser();
const results = [];

try {
  const page = await newPage(browser, { width: 1440, height: 950 });
  await login(page, PEOPLE.owner);

  for (const theme of ["light", "dark"]) {
    for (const [label, width, height] of [
      ["390", 390, 844],
      ["768", 768, 1024],
      ["1440", 1440, 950],
    ]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height });
      await go(page, "/app/finance/journal-entries", { waitMs: 4500 });

      const probe = await page.evaluate(() => {
        const input = document.querySelector(
          'input[aria-label="Search journal entries by entry number or description"]',
        );
        if (!input) return { missing: true };
        const r = input.getBoundingClientRect();
        const cs = getComputedStyle(input);
        const count = document.querySelector('[data-testid="je-result-count"]');
        const table = document.querySelector("table");
        const scroller = table?.closest("div");
        return {
          missing: false,
          inputVisible: r.width > 0 && r.height > 0,
          inputWidth: Math.round(r.width),
          inputRight: Math.round(r.right),
          viewport: window.innerWidth,
          color: cs.color,
          background: cs.backgroundColor,
          borderColor: cs.borderTopColor,
          fontSize: cs.fontSize,
          countText: count?.textContent?.trim() ?? null,
          // The page body must never scroll horizontally; the table gets its own scroller.
          bodyOverflowsX: document.documentElement.scrollWidth > window.innerWidth + 1,
          tableScrollerOverflowX: scroller ? getComputedStyle(scroller).overflowX : null,
        };
      });
      log(`  ${theme} @${label}:`, JSON.stringify(probe));
      results.push({ theme, width: label, ...probe });
      await shot(page, `04-${theme}-${label}`);
    }
  }

  // And the search actually works at the smallest size, not merely renders there.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, "/app/finance/journal-entries", { waitMs: 4500 });
  const box = page.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box.fill("ORD-20260812-0193");
  await page.waitForTimeout(4000);
  await shot(page, "04-dark-390-searched");
  const mobileHit = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll("tbody tr")).map((tr) => tr.innerText.replace(/\s+/g, " ").trim()),
    count: document.querySelector('[data-testid="je-result-count"]')?.textContent?.trim() ?? null,
  }));
  log("  dark @390 after searching:", JSON.stringify(mobileHit));
  results.push({ mobileSearch: mobileHit });

  saveState({ responsive: results });

  const bad = results.filter(
    (r) => r.missing || (r.viewport && (!r.inputVisible || r.bodyOverflowsX || r.inputRight > r.viewport)),
  );
  log(bad.length ? `\n  ✗ problems: ${JSON.stringify(bad)}` : "\n  ✓ all six viewports passed");
} finally {
  await browser.close();
}
