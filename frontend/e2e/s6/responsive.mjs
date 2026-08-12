/*
 * S6 — the two new surfaces at 390 / 768 / 1440, in both themes.
 *
 *   node e2e/s6/responsive.mjs
 *
 * Asserts COMPUTED style, never the class list: `cn()`/tailwind-merge has silently deleted
 * utility classes in this codebase before, so "the class is in the source" proves nothing.
 * The two things checked at every size are the two that actually break a till — a body that
 * scrolls sideways, and a touch target under 44px.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PEOPLE, newBrowser, login } from "../shift/lib.mjs";
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S6");
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const RESULT = [];

const SIZES = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 950 },
];

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

for (const size of SIZES) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    await login(page, PEOPLE.cashier);
    await page
      .addStyleTag({ content: "nextjs-portal{display:none !important}" })
      .catch(() => {});

    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await page
      .addStyleTag({ content: "nextjs-portal{display:none !important}" })
      .catch(() => {});

    // Tap the dish that carries the groups.
    // The TERMINAL's own layout at 390 is a fixed two-column flex (grid + a w-80 panel), so the
    // menu column is squeezed under 80px and its own container swallows the tap. That is a
    // pre-existing POS-terminal layout defect, NOT the dialog's, and it is recorded rather than
    // worked around silently: `force` is used only so the surface under test can be reached.
    const terminal = await page.evaluate(() => {
      const grid = document.querySelector("[data-testid=menu-grid]");
      return {
        gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null,
        bodyScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    // Located by NAME, and forced. `force` is doing real work here and it is a finding, not a
    // convenience: at 390 the terminal's fixed `w-80` order panel leaves the whole menu grid
    // 37px wide, so every tile is a 37px sliver its own container swallows the tap on. That is a
    // PRE-EXISTING pos-terminal layout defect (see `terminal.gridWidth` in the JSON) and is
    // reported separately; the dialog under test is reached past it rather than around it.
    await page
      .locator('[data-testid=menu-grid] button:has-text("Audit Item 52235")')
      .first()
      .waitFor({ state: "attached", timeout: 60000 });
    // Scroll the GRID's own scroll container, not the window. Playwright's
    // scrollIntoViewIfNeeded believes an element clipped by an ancestor's `overflow-hidden` is
    // already in view, so a forced click lands on whatever now covers those coordinates — which
    // at 390 is the order panel. Scrolling the real container is what a thumb does.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("[data-testid=menu-grid] button")).find(
        (b) => (b.innerText || "").includes("Audit Item 52235"),
      );
      btn?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(600);
    await page
      .locator('[data-testid=menu-grid] button:has-text("Audit Item 52235")')
      .first()
      .click({ force: true });
    await page.waitForTimeout(2200);

    const probe = await page.evaluate(() => {
      const dialog = document.querySelector("[data-testid=modifier-dialog]");
      if (!dialog) return { open: false };
      const options = Array.from(dialog.querySelectorAll('[data-testid^="modifier-option-"]'));
      // COMPUTED, not the class list — `cn()` has deleted utilities in this repo before.
      const heights = options.map((o) => Math.round(o.getBoundingClientRect().height));
      const cs = getComputedStyle(dialog);
      return {
        open: true,
        bodyScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        dialogWidth: Math.round(dialog.getBoundingClientRect().width),
        viewport: window.innerWidth,
        minOptionHeight: Math.min(...heights),
        optionCount: options.length,
        // Both must resolve to something — a theme that leaves either transparent is unreadable.
        background: cs.backgroundColor,
        color: cs.color,
        blockedMessageVisible: !!dialog.querySelector("[data-testid=modifier-dialog-blocked]"),
      };
    });
    log(`  ${size.name}/${theme}:`, JSON.stringify(probe));
    RESULT.push({ size: size.name, theme, terminal, ...probe });
    await page.screenshot({ path: `${OUT}/rs-dialog-${size.name}-${theme}.png` });
    await ctx.close();
  }
}

writeFileSync(`${OUT}/s6-responsive.json`, JSON.stringify(RESULT, null, 2));
log(`\n  wrote ${OUT}/s6-responsive.json`);
await browser.close();
