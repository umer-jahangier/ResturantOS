/*
 * F16 — /app/settings/tax at 390 / 768 / 1440, light and dark.
 *
 * Every claim here is read from COMPUTED style, never from a class list: `cn()`/tailwind-merge
 * has silently deleted utility classes in this codebase before, so a class in the source is not
 * a class in the DOM.
 *
 *   node e2e/floor/f16-responsive.mjs
 */
import { PEOPLE, newBrowser, newPage, login, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16");
mkdirSync(OUT, { recursive: true });

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

const out = {};
for (const theme of ["light", "dark"]) {
  for (const [w, h] of [
    [390, 844],
    [768, 1024],
    [1440, 950],
  ]) {
    await owner.setViewportSize({ width: w, height: h });
    await owner.emulateMedia({ colorScheme: theme });
    await owner.goto("http://localhost:3000/app/settings/tax", { waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(3500);
    await owner.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.style.colorScheme = t;
    }, theme);
    await owner.waitForTimeout(900);
    await owner.waitForSelector("[data-testid=tax-class-row]", { timeout: 15000 });

    const m = await owner.evaluate(() => {
      const row = document.querySelector("[data-testid=tax-class-row]");
      const codeInput = document.querySelector("[data-testid=tax-class-row] input");
      const body = getComputedStyle(document.body);
      const rowStyle = row ? getComputedStyle(row) : null;
      return {
        sidewaysScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        rowWidth: row ? Math.round(row.getBoundingClientRect().width) : null,
        // The three inputs stack on a phone and sit in one row on a laptop — read from the
        // rendered box, not from the grid class.
        inputWidth: codeInput ? Math.round(codeInput.getBoundingClientRect().width) : null,
        rowsOnOneLine:
          row &&
          Array.from(row.querySelectorAll("input")).length === 3 &&
          new Set(
            Array.from(row.querySelectorAll("input")).map((i) =>
              Math.round(i.getBoundingClientRect().top),
            ),
          ).size === 1,
        bodyBg: body.backgroundColor,
        bodyColor: body.color,
        rowBorder: rowStyle?.borderTopColor ?? null,
        rowCount: document.querySelectorAll("[data-testid=tax-class-row]").length,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
          (n.textContent || "").trim().slice(0, 60),
        ),
      };
    });
    out[`${w}-${theme}`] = m;
    log(`  ▸ ${w}px ${theme}: ${JSON.stringify(m)}`);
    await owner.screenshot({ path: `${OUT}/05-tax-${w}-${theme}.png`, fullPage: false });
  }
}

writeFileSync(`${OUT}/f16-responsive.json`, JSON.stringify(out, null, 2));
await browser.close();
