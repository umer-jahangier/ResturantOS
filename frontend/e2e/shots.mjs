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

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  }, theme);
  await page.waitForTimeout(350);
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! page error:", String(e).slice(0, 140)));

  // Unauthenticated screens first — login is a first-impression surface.
  for (const theme of ["light", "dark"]) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await setTheme(page, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await shot(page, `login-${theme}`);
  }

  const ok = await login(page, TENANT);
  console.log(ok ? "  signed in as manager" : `  LOGIN FAILED (${page.url()})`);
  if (ok) {
    for (const [name, route] of TENANT_ROUTES) {
      for (const theme of ["light", "dark"]) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await setTheme(page, theme);
        await page.waitForTimeout(2500);
        await shot(page, `${name}-${theme}`);
      }
    }
  }

  // Platform console needs the tenant-less SuperAdmin, so a fresh context.
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  const ok2 = await login(page2, PLATFORM);
  console.log(ok2 ? "  signed in as superadmin" : `  PLATFORM LOGIN FAILED (${page2.url()})`);
  if (ok2) {
    for (const [name, route] of PLATFORM_ROUTES) {
      for (const theme of ["light", "dark"]) {
        await page2.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await setTheme(page2, theme);
        await page2.waitForTimeout(2500);
        await shot(page2, `${name}-${theme}`);
      }
    }
  }

  await browser.close();
  console.log("evidence →", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
