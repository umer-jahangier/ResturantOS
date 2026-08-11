/**
 * Phase 38 audit — re-capture with a degradation guard, plus a nav-stability probe.
 *
 * The first audit pass screenshotted a manager dashboard showing ONLY
 * "Couldn't load today's service". That is the exact defect phase 34 §7 catalogued: a
 * surface anchored to a backing service that was transiently 503, photographed as if it
 * were the design. An audit screenshot taken during a transient failure is not evidence
 * of anything except the failure.
 *
 * So this pass:
 *   1. retries each route until no [role="alert"] error box is present (max N attempts),
 *      and records honestly when a route CANNOT be captured clean;
 *   2. counts sidebar nav items across repeated loads, because the first pass and the
 *      second pass disagreed about how many items a manager sees.
 *
 * Run:  node e2e/audit-38-reshoot.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/phases/38-erp-design-transformation/evidence");
const BASE = "http://localhost:3000";
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

const ROUTES = [
  ["dashboard", "/app/dashboard"],
  ["tables", "/app/tables"],
  ["orders", "/app/pos"],
  ["menu-items", "/app/menu/items"],
  ["finance", "/app/finance"],
  ["finance-takings", "/app/finance/takings"],
  ["hr-attendance", "/app/hr/attendance"],
  ["hr-employees", "/app/hr/employees"],
  ["reports", "/app/reports"],
  ["settings", "/app/settings"],
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
  if (isDark !== (theme === "dark")) throw new Error(`theme did not apply: asked ${theme}, html.dark=${isDark}`);
}

/** Reads the degradation state of the page rather than assuming it is fine. */
const DEGRADED = () => {
  const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
  const texts = alerts.map((a) => (a.textContent || "").trim().slice(0, 120)).filter(Boolean);
  return {
    alertCount: alerts.length,
    alertTexts: texts,
    navItems: Array.from(document.querySelectorAll("nav a, aside a")).map((a) => (a.textContent || "").trim()).filter(Boolean),
  };
};

async function main() {
  const browser = await chromium.launch();
  const result = { capturedAt: new Date().toISOString(), routes: {}, navStability: {} };

  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    const page = await ctx.newPage();
    if (!(await login(page, MANAGER))) { console.log("LOGIN FAILED"); await ctx.close(); continue; }

    for (const [name, route] of ROUTES) {
      let attempt = 0, state = null;
      while (attempt < 4) {
        attempt += 1;
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(5000);
        state = await page.evaluate(DEGRADED);
        if (state.alertCount === 0) break;
        console.log(`  ${name}/${theme}: attempt ${attempt} degraded — ${state.alertTexts[0]}`);
        await page.waitForTimeout(2500);
      }
      await assertTheme(page, theme);
      const file = `${OUT}/shots/${name}-desktop-${theme}.png`;
      mkdirSync(dirname(file), { recursive: true });
      await page.screenshot({ path: file, fullPage: false });
      result.routes[`${name}|${theme}`] = {
        attempts: attempt,
        cleanCapture: state.alertCount === 0,
        residualAlerts: state.alertTexts,
        navItemCount: state.navItems.length,
      };
      console.log(`  ${name}/${theme}: ${state.alertCount === 0 ? "CLEAN" : "STILL DEGRADED after " + attempt} (nav=${state.navItems.length})`);
    }

    // Nav stability: same route, six loads, count nav items each time.
    if (theme === "light") {
      const counts = [], sets = [];
      for (let i = 0; i < 6; i++) {
        await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4000);
        const s = await page.evaluate(DEGRADED);
        counts.push(s.navItems.length);
        sets.push(s.navItems.join("|"));
      }
      result.navStability = {
        counts,
        distinctCompositions: new Set(sets).size,
        stable: new Set(counts).size === 1,
        compositions: [...new Set(sets)].map((s) => s.split("|")),
      };
      console.log(`  NAV STABILITY: counts=${counts.join(",")} distinct=${new Set(sets).size}`);
    }
    await ctx.close();
  }

  const prev = existsSync(`${OUT}/audit-reshoot.json`) ? JSON.parse(readFileSync(`${OUT}/audit-reshoot.json`, "utf8")) : {};
  writeFileSync(`${OUT}/audit-reshoot.json`, JSON.stringify({ ...prev, ...result }, null, 2));
  await browser.close();
  console.log("\nreshoot →", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
