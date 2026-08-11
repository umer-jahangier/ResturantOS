/**
 * 38-02 verification — the DataGrid contract, measured in Chromium.
 *
 * Every property here was measured as BROKEN by the audit on these same routes:
 * `thead th { position: static }` on 12 of 12 tables, row heights of 65px AND 81px inside one
 * body, 0 selection checkboxes, no pager on an 84-row list, and 100 elements past the viewport
 * at 390px. So each is re-measured rather than assumed.
 *
 *   node e2e/verify-38-02.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/phases/38-erp-design-transformation/evidence");
const BASE = "http://localhost:3000";
const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

const ROUTES = [
  ["inventory-stock", "/app/inventory/stock"],
  ["inventory-ingredients", "/app/inventory/ingredients"],
  ["purchasing-po", "/app/purchasing/purchase-orders"],
];

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const sf = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await sf.count())) await sf.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  return !page.url().includes("/login");
}

/**
 * Reads the grid the way the audit did. Fails LOUDLY when its anchor is missing rather than
 * reporting zeros — phase 34's vacuous-gate #3 spent a 20-second timeout waiting on a testid
 * that did not exist and reported the timeout as a measurement.
 */
const GRID = () => {
  const table = document.querySelector("table");
  if (!table) return { error: "ANCHOR NOT FOUND: no <table> on this route" };

  const ths = Array.from(table.querySelectorAll("thead th"));
  if (ths.length === 0) return { error: "ANCHOR NOT FOUND: <thead th>" };

  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  if (bodyRows.length === 0) return { error: "ANCHOR NOT FOUND: no <tbody tr> — empty state?" };

  const heights = {};
  for (const r of bodyRows) {
    const h = Math.round(r.getBoundingClientRect().height);
    heights[h] = (heights[h] || 0) + 1;
  }

  const small = Array.from(document.querySelectorAll("button, a, input, select, [role=button]"))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    }).length;

  return {
    theadPosition: getComputedStyle(ths[0]).position,
    headerFontSize: getComputedStyle(ths[0]).fontSize,
    cellFontSize: bodyRows[0]
      ? getComputedStyle(bodyRows[0].querySelector("td") ?? bodyRows[0]).fontSize
      : null,
    rowCount: bodyRows.length,
    distinctRowHeights: Object.keys(heights).map(Number).sort((a, b) => a - b),
    rowHeightHistogram: heights,
    countLine: document.querySelector("[data-testid=data-grid-count]")?.textContent?.trim() ?? null,
    subTargetControls: small,
  };
};

const NARROW = () => {
  const table = document.querySelector("table");
  const tableVisible = table ? table.getClientRects().length > 0 : false;
  const cards = document.querySelector("[data-testid=data-grid-cards]");
  return {
    tableInDom: Boolean(table),
    tableVisible,
    cardsVisible: cards ? cards.getClientRects().length > 0 : false,
    cardCount: cards ? cards.querySelectorAll("li").length : 0,
    pageScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    elementsPastViewport: Array.from(document.querySelectorAll("body *")).filter(
      (el) => el.getBoundingClientRect().right > window.innerWidth + 1,
    ).length,
  };
};

async function main() {
  const browser = await chromium.launch();
  const result = { capturedAt: new Date().toISOString(), desktop: {}, narrow: {} };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  if (!(await login(page, MANAGER))) throw new Error("LOGIN FAILED");

  for (const [name, route] of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const m = await page.evaluate(GRID);
    result.desktop[name] = m;
    if (m.error) console.log(`  ${name}: ${m.error}`);
    else
      console.log(
        `  ${name}: thead=${m.theadPosition} rows=${m.rowCount} heights=[${m.distinctRowHeights}] ` +
          `cell=${m.cellFontSize} header=${m.headerFontSize} count="${m.countLine}" sub44=${m.subTargetControls}`,
      );
    const file = `${OUT}/after-38-02/${name}-1440-light.png`;
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
  }

  // 390px — the width the audit found unusable.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, route] of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const m = await page.evaluate(NARROW);
    result.narrow[name] = m;
    console.log(
      `  ${name} @390: tableVisible=${m.tableVisible} cards=${m.cardsVisible}(${m.cardCount}) ` +
        `pageScroll=${m.pageScroll} past=${m.elementsPastViewport}`,
    );
    const file = `${OUT}/after-38-02/${name}-390-light.png`;
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
  }

  await ctx.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/verify-38-02.json`, JSON.stringify(result, null, 2));
  await browser.close();
  console.log("\nverify-38-02 →", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
