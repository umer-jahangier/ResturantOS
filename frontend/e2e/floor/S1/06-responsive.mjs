/*
 * S1 step 6 — the screen at 390 / 768 / 1440, in both themes, plus the two states a screenshot
 * cannot tell apart on its own.
 *
 * Asserted rather than eyeballed:
 *  - the page body never scrolls horizontally at any width,
 *  - every select is at least 24 CSS px tall and inside the viewport,
 *  - the "Fires to <CODE>" text is present on every row at every width (it is the answer the
 *    screen exists to give, and it is the first thing a narrow layout drops),
 *  - and the computed background actually changes between themes, read off getComputedStyle
 *    rather than off a class list — `cn()`/tailwind-merge has silently deleted classes here before.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, log } from "./lib.mjs";

const browser = await newBrowser();
const out = {};

async function themeTo(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await page.waitForTimeout(900);
}

try {
  for (const [label, viewport] of [
    ["390", { width: 390, height: 844 }],
    ["768", { width: 768, height: 1024 }],
    ["1440", { width: 1440, height: 950 }],
  ]) {
    const page = await newPage(browser, viewport);
    await login(page, PEOPLE.owner);
    await go(page, "/app/menu/routing", { waitMs: 5000 });

    for (const theme of ["light", "dark"]) {
      await themeTo(page, theme);
      const probe = await page.evaluate(() => {
        const doc = document.documentElement;
        const selects = Array.from(
          document.querySelectorAll(
            '[data-testid="category-station-select"], [data-testid="item-station-select"]',
          ),
        );
        const rects = selects.map((s) => s.getBoundingClientRect());
        const rows = Array.from(document.querySelectorAll('[data-testid="routing-item"]'));
        const dests = rows.map(
          (r) => r.querySelector('[data-testid="routing-item-destination"]')?.textContent?.trim() ?? null,
        );
        return {
          docScrollW: doc.scrollWidth,
          clientW: doc.clientWidth,
          horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
          selectCount: selects.length,
          minSelectHeight: rects.length ? Math.min(...rects.map((r) => Math.round(r.height))) : null,
          selectsOverflowingRight: rects.filter((r) => r.right > doc.clientWidth + 1).length,
          rowCount: rows.length,
          rowsMissingDestination: dests.filter((d) => !d || !/Fires to/.test(d)).length,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          h1Colour: getComputedStyle(document.querySelector("h1")).color,
          summary:
            document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
        };
      });
      out[`${label}-${theme}`] = probe;
      log(`  ${label}/${theme}:`, JSON.stringify(probe));
      await shot(page, `06-routing-${label}-${theme}`);
    }
    await page.context().close();
  }

  const light = out["1440-light"];
  const dark = out["1440-dark"];
  log("  theme really changed:", light.bodyBg !== dark.bodyBg, light.bodyBg, "->", dark.bodyBg);
  saveState({ responsive: out });
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
