/**
 * 38-01 verification, in a real browser.
 *
 * Exists because the defect that mattered most in this plan — a `--spacing-*` bridge silently
 * redefining `max-w-*` and collapsing every dialog in the product to a 24px sliver — passed
 * `tsc`, ESLint, and 1,127 unit tests. jsdom does not apply the stylesheet, so no `render()`
 * test could see it either. It was found by a person looking at a screen, and the only
 * instruments that can see it are the compiled stylesheet and a real browser.
 *
 *   node e2e/verify-38-01.mjs
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

/** Routes 38-01 migrated to PageHeader/PageBody. */
const ROUTES = [
  ["inventory-stock", "/app/inventory/stock"],
  ["inventory-ingredients", "/app/inventory/ingredients"],
  ["inventory-setup", "/app/inventory/setup"],
  ["purchasing-po", "/app/purchasing/purchase-orders"],
  ["purchasing-vendors", "/app/purchasing/vendors"],
  ["purchasing-suggestions", "/app/purchasing/order-suggestions"],
  ["tables", "/app/tables"],
  ["finance-periods", "/app/finance/periods"],
  ["reports", "/app/reports"],
  ["dashboard", "/app/dashboard"],
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

async function assertTheme(page, theme) {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (isDark !== (theme === "dark"))
    throw new Error(`theme did not apply: asked ${theme}, html.dark=${isDark}`);
}

/** Type/radius census + heading count + degradation, read off the live DOM. */
const PROBE = () => {
  const sizes = {},
    radii = {};
  let nodes = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    const hasText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0,
    );
    if (hasText) {
      sizes[cs.fontSize] = (sizes[cs.fontSize] || 0) + 1;
      nodes += 1;
    }
    const r = cs.borderTopLeftRadius;
    if (r && r !== "0px") radii[r] = (radii[r] || 0) + 1;
  }
  const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
  return {
    h1Count: document.querySelectorAll("h1").length,
    h1Text: Array.from(document.querySelectorAll("h1")).map((h) => h.textContent?.trim()),
    pageBodyCount: document.querySelectorAll("[data-page-body]").length,
    mainPadding: (() => {
      const m = document.querySelector("main");
      return m ? getComputedStyle(m).padding : null;
    })(),
    textNodes: nodes,
    sizes,
    radii,
    alertCount: alerts.length,
    alertTexts: alerts.map((a) => (a.textContent || "").trim().slice(0, 120)),
  };
};

/**
 * THE regression probe. Opens a real dialog and measures the panel the operator sees.
 * A number in the tens means the `--spacing-*` namespace collision is back.
 */
async function measureDialog(page) {
  await page.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const trigger = page.getByRole("button", { name: /add table/i });
  if (!(await trigger.count())) return { opened: false, reason: "ANCHOR NOT FOUND: Add table" };
  await trigger.first().click();
  await page.waitForTimeout(1200);
  const panel = page.locator('[data-slot="dialog-content"]');
  if (!(await panel.count())) return { opened: false, reason: "ANCHOR NOT FOUND: dialog-content" };
  const m = await panel.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { maxWidth: cs.maxWidth, width: el.getBoundingClientRect().width };
  });
  return { opened: true, ...m };
}

async function main() {
  const browser = await chromium.launch();
  const result = { capturedAt: new Date().toISOString(), routes: {}, dialog: {}, widths: {} };

  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    if (!(await login(page, MANAGER))) {
      console.log("LOGIN FAILED");
      await ctx.close();
      continue;
    }

    if (theme === "light") {
      result.dialog = await measureDialog(page);
      console.log("  DIALOG:", JSON.stringify(result.dialog));
    }

    for (const [name, route] of ROUTES) {
      let attempt = 0,
        state = null;
      while (attempt < 4) {
        attempt += 1;
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(5000);
        state = await page.evaluate(PROBE);
        if (state.alertCount === 0) break;
        await page.waitForTimeout(2500);
      }
      await assertTheme(page, theme);
      const file = `${OUT}/after-38-01/${name}-desktop-${theme}.png`;
      mkdirSync(dirname(file), { recursive: true });
      await page.screenshot({ path: file, fullPage: false });
      result.routes[`${name}|${theme}`] = { attempts: attempt, ...state };
      console.log(
        `  ${name}/${theme}: h1=${state.h1Count} pageBody=${state.pageBodyCount} ` +
          `mainPad=${state.mainPadding} alerts=${state.alertCount}${state.alertCount ? " :: " + state.alertTexts[0] : ""}`,
      );
    }
    await ctx.close();
  }

  // Responsive sweep on one migrated route.
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  if (await login(page, MANAGER)) {
    for (const w of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const overflow = await page.evaluate(() => ({
        docScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        past: Array.from(document.querySelectorAll("body *")).filter(
          (el) => el.getBoundingClientRect().right > window.innerWidth + 1,
        ).length,
      }));
      result.widths[w] = overflow;
      console.log(`  width ${w}: pageScroll=${overflow.docScroll} elementsPast=${overflow.past}`);
      const file = `${OUT}/after-38-01/stock-${w}-light.png`;
      mkdirSync(dirname(file), { recursive: true });
      await page.screenshot({ path: file, fullPage: false });
    }
  }
  await ctx.close();

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/verify-38-01.json`, JSON.stringify(result, null, 2));
  await browser.close();
  console.log("\nverify-38-01 →", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
