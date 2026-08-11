// Ad-hoc visual evidence capture for phase 34 (visual design language).
// Not part of any playwright project — run directly:  node e2e/shots.mjs before|after
// It signs a persona in through the real login form and screenshots each route in
// BOTH themes, because a backdrop-filter tuned for dark reads as muddy grey in light.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LABEL = process.argv[2] ?? "shot";
const OUT = resolve(process.cwd(), "../.planning/phases/34-visual-design-language/evidence", LABEL);
const BASE = "http://localhost:3000";

const TENANT = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};
const PLATFORM = { slug: "", email: "superadmin@softxlogic.com", password: "Test@123!" };

/** Routes captured for the tenant persona. */
const TENANT_ROUTES = [
  ["dashboard", "/app/dashboard"],
  ["pos", "/app/pos"],
  ["settings", "/app/settings"],
  ["appearance", "/settings/appearance"],
  ["menu-items", "/app/menu/items"],
];

const PLATFORM_ROUTES = [
  ["platform-dashboard", "/platform/dashboard"],
  ["platform-tenants", "/platform/tenants"],
];

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log("  ✓", `${name}.png`);
}

/*
 * Theme is driven by `prefers-color-scheme`, NOT by writing localStorage.
 *
 * ThemeProvider runs with defaultTheme="system" + enableSystem, so the OS preference is the
 * real switch. Writing localStorage after navigation was a no-op — the provider had already
 * read it — and produced dark screenshots that were byte-identical to the light ones. That
 * looked like "the theme works" and actually meant "the theme never changed", which is
 * precisely the kind of green nobody questions.
 *
 * Each theme therefore gets its OWN browser context with colorScheme set.
 */
async function ctxFor(browser, theme) {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
}

/** Fails loudly if the requested theme did not actually take, so a screenshot cannot lie. */
async function assertTheme(page, theme) {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (isDark !== (theme === "dark")) {
    throw new Error(`theme did not apply: asked for ${theme}, html.dark=${isDark}`);
  }
}

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await slugField.count())) await slugField.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();

  for (const theme of ["light", "dark"]) {
    const ctx = await ctxFor(browser, theme);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("    ! page error:", String(e).slice(0, 140)));

    // Unauthenticated first — login is a first-impression surface.
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    await assertTheme(page, theme);
    await shot(page, `login-${theme}`);

    const ok = await login(page, TENANT);
    console.log(ok ? `  signed in as manager (${theme})` : `  LOGIN FAILED (${page.url()})`);
    if (ok) {
      for (const [name, route] of TENANT_ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4500);
        await assertTheme(page, theme);
        await shot(page, `${name}-${theme}`);
      }
    }
    await ctx.close();

    // Platform console needs the tenant-less SuperAdmin, so a fresh context.
    const ctx2 = await ctxFor(browser, theme);
    const page2 = await ctx2.newPage();
    const ok2 = await login(page2, PLATFORM);
    console.log(ok2 ? `  signed in as superadmin (${theme})` : `  PLATFORM LOGIN FAILED`);
    if (ok2) {
      for (const [name, route] of PLATFORM_ROUTES) {
        await page2.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page2.waitForTimeout(4000);
        await shot(page2, `${name}-${theme}`);
      }
    }
    await ctx2.close();
  }

  await browser.close();
  console.log("evidence \u2192", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
