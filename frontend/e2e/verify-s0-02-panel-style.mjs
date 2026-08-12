/*
 * S0-02 companion: the unclosed-takings panel must actually RENDER as a caution surface, in both
 * themes. Asserted on COMPUTED STYLE, never on the class list — `cn()`/tailwind-merge has silently
 * dropped utility classes in this codebase before, and a className in the source proves nothing
 * about the DOM.
 *
 * Run:  cd frontend && node e2e/verify-s0-02-panel-style.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-02/panel-style");
const BASE = "http://localhost:3000";
const PERSONA = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

mkdirSync(OUT, { recursive: true });

/**
 * Alpha out of ANY computed colour, not just `rgba()`.
 *
 * The design tokens resolve to `oklab(L a b / α)`. An rgba-only parser returned null here and the
 * check reported "background is transparent" for a surface that was painting perfectly — the exact
 * shape of false alarm this file exists to avoid.
 */
function alphaOf(s) {
  if (!s || s === "transparent") return 0;
  const slash = s.match(/\/\s*([\d.]+%?)\s*\)/);
  if (slash) {
    const v = slash[1];
    return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
  }
  const rgba = s.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
  if (rgba) return parseFloat(rgba[1]);
  return 1; // an opaque colour in any notation
}

async function run(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login?tenant=${PERSONA.slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(PERSONA.slug);
  await page.locator('input[name="email"], input#email').first().fill(PERSONA.email);
  await page.locator('input[name="password"], input#password').first().fill(PERSONA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/app\//, { timeout: 25_000 });

  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (isDark !== (theme === "dark")) {
    throw new Error(`theme did not apply: asked for ${theme}, html.dark=${isDark}`);
  }

  await page.goto(`${BASE}/app/finance/takings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const panel = page.getByTestId("unclosed-tender-panel");
  await panel.waitFor({ state: "visible", timeout: 20_000 });

  const style = await panel.evaluate((el) => {
    const cs = getComputedStyle(el);
    const parent = getComputedStyle(el.parentElement ?? document.body);
    return {
      backgroundColor: cs.backgroundColor,
      parentBackgroundColor: parent.backgroundColor,
      color: cs.color,
      borderTopColor: cs.borderTopColor,
      borderTopWidth: cs.borderTopWidth,
      fontSize: cs.fontSize,
      text: el.textContent.slice(0, 90),
      cashPaisa: el.getAttribute("data-unclosed-cash-paisa"),
    };
  });

  const problems = [];
  if (alphaOf(style.backgroundColor) <= 0) {
    problems.push(`background is transparent (${style.backgroundColor})`);
  }
  if (style.backgroundColor === style.parentBackgroundColor) {
    problems.push("the panel's surface is identical to its container — the class did not survive");
  }
  if (alphaOf(style.borderTopColor) <= 0 || parseFloat(style.borderTopWidth) <= 0) {
    problems.push(`border does not paint (${style.borderTopWidth} ${style.borderTopColor})`);
  }
  if (alphaOf(style.color) <= 0) problems.push(`text colour is transparent (${style.color})`);
  // `text-small` is the contract's 13px role. Tailwind's `text-sm` would compute 14px and a
  // dropped class would inherit something else entirely — so the number is the assertion.
  if (style.fontSize !== "13px") {
    problems.push(`text-small did not resolve: font-size is ${style.fontSize}, expected 13px`);
  }
  if (!/of today's cash is against/.test(style.text)) {
    problems.push(`the panel is not stating the unclosed cash: ${JSON.stringify(style.text)}`);
  }

  await page.screenshot({ path: `${OUT}/${theme}.png`, fullPage: false });
  console.log(`[${theme}]`, JSON.stringify(style, null, 2));
  if (problems.length) throw new Error(`[${theme}] ${problems.join("; ")}`);
  console.log(`[${theme}] OK — panel renders as a real caution surface`);
}

const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"]) await run(browser, theme);
} finally {
  await browser.close();
}
