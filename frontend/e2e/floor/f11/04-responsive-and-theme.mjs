/*
 * F11 PROOF, part 3 — the new screen at 390 / 768 / 1440, in both themes.
 *
 * The brief requires a screen to work at all three widths and in both themes, and to prove it by
 * MEASUREMENT rather than by a class list — `cn()`/tailwind-merge has silently dropped utility
 * classes here before. So this asserts:
 *   · the page body never scrolls horizontally,
 *   · the dialog fits inside the viewport,
 *   · the primary control is at least 24px tall and actually reachable,
 *   · the computed background really changes between light and dark (the theme is applied, not
 *     merely selected).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, PEOPLE, newBrowser, newPage, login, go, shot, OUT, log } from "./lib.mjs";

const journal = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const results = [];

const browser = await newBrowser();

async function measure(width, height, theme) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  // next-themes persists the choice; setting it before first paint avoids a flash and makes the
  // measurement below about the applied theme rather than about a transition.
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("theme", t);
    } catch {
      /* storage blocked — the colorScheme emulation above still drives `system` */
    }
  }, theme);
  await login(page, PEOPLE.manager);
  await go(page, "/app/pos/tills", { waitMs: 6000 });

  await page.locator("[data-testid=open-drawer-for-cashier-button]").first().click();
  await page.waitForTimeout(2500);
  // Pick somebody who does NOT already hold a drawer — the F11 cashier from step 2 does, and the
  // panel correctly refuses a second one for them, which would leave nothing to measure.
  const freeValue = await page.evaluate(() => {
    const sel = document.querySelector("[data-testid=open-drawer-cashier-select]");
    const opt = Array.from(sel?.options ?? []).find(
      (o) => o.value && !/already has a drawer/i.test(o.textContent ?? ""),
    );
    return opt ? opt.value : null;
  });
  if (!freeValue) throw new Error("no cashier without a drawer to measure with");
  await page.locator("[data-testid=open-drawer-cashier-select]").selectOption(freeValue);
  await page.locator("[data-testid=open-drawer-float-input]").fill("5000.00");
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const panel = document.querySelector("[data-testid=open-drawer-panel]");
    const confirm = document.querySelector("[data-testid=open-drawer-confirm-button]");
    const select = document.querySelector("[data-testid=open-drawer-cashier-select]");
    const summary = document.querySelector("[data-testid=open-drawer-summary]");
    const r = panel?.getBoundingClientRect();
    const cr = confirm?.getBoundingClientRect();
    return {
      documentScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      panelWidth: r ? Math.round(r.width) : null,
      panelOverflowsViewport: r ? r.left < -1 || r.right > window.innerWidth + 1 : null,
      confirmHeight: cr ? Math.round(cr.height) : null,
      confirmVisible: cr ? cr.top >= 0 && cr.bottom <= window.innerHeight + 1 : null,
      selectLabelled: !!document.querySelector('label[for="open-drawer-cashier"]'),
      floatLabelled: !!document.querySelector('label[for="open-drawer-float"]'),
      summaryText: summary ? summary.innerText.replace(/\s+/g, " ").trim() : null,
      // Computed, never the class list.
      panelBg: panel ? getComputedStyle(panel).backgroundColor : null,
      panelColor: panel ? getComputedStyle(panel).color : null,
      rootTheme: document.documentElement.getAttribute("class"),
      selectOptions: select ? select.options.length : 0,
    };
  });

  await shot(page, `20-panel-${width}-${theme}`);
  await ctx.close();
  return m;
}

for (const [w, h] of [[390, 844], [768, 1024], [1440, 950]]) {
  for (const theme of ["light", "dark"]) {
    const m = await measure(w, h, theme);
    results.push({ width: w, theme, ...m });
    log(`  ${w}px ${theme}:`, JSON.stringify(m));
  }
}

const failures = results.filter(
  (r) =>
    r.documentScrollsSideways ||
    r.panelOverflowsViewport ||
    !r.confirmVisible ||
    (r.confirmHeight ?? 0) < 24 ||
    !r.selectLabelled ||
    !r.floatLabelled ||
    !r.summaryText,
);
log("\nfailures:", JSON.stringify(failures, null, 1));

const lightBg = results.find((r) => r.theme === "light" && r.width === 1440)?.panelBg;
const darkBg = results.find((r) => r.theme === "dark" && r.width === 1440)?.panelBg;
log("panel background light vs dark:", lightBg, "|", darkBg, "| differ:", lightBg !== darkBg);

writeFileSync(
  `${OUT}/responsive.json`,
  JSON.stringify({ results, failures, lightBg, darkBg }, null, 2),
);
await browser.close();
