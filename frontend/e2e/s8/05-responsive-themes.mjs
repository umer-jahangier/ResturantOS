/*
 * S8 step 5 — the screen at 390 / 768 / 1440, in both themes.
 *
 * COMPUTED style and the document scroll width, never the class list: `cn()`/tailwind-merge has
 * silently dropped utility classes in this codebase before, and a class in the source is not a
 * class in the DOM.
 */
import { newBrowser, login, go, shot, PEOPLE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const SIZES = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 950 },
];

const results = [];
const browser = await newBrowser();

for (const theme of ["light", "dark"]) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    await login(page, PEOPLE.owner);
    await go(page, "/app/settings/printers", { waitMs: 6000 });
    await page.waitForTimeout(2500);

    const measured = await page.evaluate(() => {
      const picker = document.querySelector('[data-testid="system-printer-picker"]');
      const alert = document.querySelector('[data-testid="printers-failing"]');
      const badge = document.querySelector('[data-testid="printer-delivery"]');
      const read = (el) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          color: s.color,
          background: s.backgroundColor,
          fontSize: s.fontSize,
          width: Math.round(r.width),
          visible: r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none",
        };
      };
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        rootTheme: document.documentElement.getAttribute("data-theme") ?? document.documentElement.className,
        picker: read(picker),
        alert: read(alert),
        badge: read(badge),
        badgeText: badge ? badge.textContent.trim() : null,
      };
    });
    measured.theme = theme;
    measured.size = size.name;
    measured.horizontalScroll = measured.docScrollWidth > measured.clientWidth + 1;
    results.push(measured);
    console.log(
      `  ${theme} ${size.name}: hScroll=${measured.horizontalScroll} picker=${measured.picker?.visible} badge=${JSON.stringify(measured.badgeText)}`,
    );
    await shot(page, `05-${theme}-${size.name}`);
    await ctx.close();
  }
}

writeFileSync(`${OUT}/05-responsive-themes.json`, JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.horizontalScroll || r.picker?.visible === false);
console.log(bad.length === 0 ? "\n  ALL SIX PASS" : `\n  PROBLEMS: ${JSON.stringify(bad, null, 2)}`);
await browser.close();
