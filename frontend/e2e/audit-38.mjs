/**
 * Phase 38 UI/UX audit harness — measures the shipped product in a real browser.
 *
 * NOT a gate. This is an evidence collector: it signs real personas in through the real
 * login form, walks a route list at four viewport widths in both themes, screenshots each,
 * and harvests computed-style facts that source-reading cannot produce — the actual set of
 * font sizes rendered, the actual radii, the actual shadows, elements that overflow the
 * viewport horizontally, interactive controls below the 44px target-size floor, and
 * controls with no accessible name.
 *
 * Theme handling is inherited from e2e/shots.mjs (34-07): each theme gets its OWN browser
 * context with `colorScheme` set, and assertTheme() throws if html.dark disagrees with what
 * was requested — because the previous harness wrote localStorage after navigation, the
 * provider had already read it, and every "dark" screenshot was byte-identical to its light
 * counterpart. A screenshot must not be able to claim a theme it did not render.
 *
 * Run:  node e2e/audit-38.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/phases/38-erp-design-transformation/evidence");
const BASE = "http://localhost:3000";

const PERSONAS = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  kitchen: { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" },
};

// [name, route, persona]
const ROUTES = [
  ["dashboard", "/app/dashboard", "manager"],
  ["pos", "/app/pos", "cashier"],
  ["pos-tills", "/app/pos/tills", "cashier"],
  ["tables", "/app/tables", "manager"],
  ["kitchen-index", "/app/kitchen", "kitchen"],
  ["orders", "/app/pos", "manager"],
  ["inventory", "/app/inventory", "manager"],
  ["inventory-stock", "/app/inventory/stock", "manager"],
  ["inventory-ingredients", "/app/inventory/ingredients", "manager"],
  ["menu-items", "/app/menu/items", "manager"],
  ["purchasing-po", "/app/purchasing/purchase-orders", "manager"],
  ["purchasing-vendors", "/app/purchasing/vendors", "manager"],
  ["crm", "/app/crm", "manager"],
  ["hr-employees", "/app/hr/employees", "manager"],
  ["hr-attendance", "/app/hr/attendance", "manager"],
  ["finance", "/app/finance", "manager"],
  ["finance-takings", "/app/finance/takings", "manager"],
  ["reports", "/app/reports", "manager"],
  ["settings", "/app/settings", "manager"],
  ["users", "/app/users", "manager"],
];

const WIDTHS = [
  ["mobile", 390, 844],
  ["tablet", 768, 1024],
  ["laptop", 1024, 768],
  ["desktop", 1440, 900],
];

/** Harvested inside the page. Computed styles only — nothing inferred from source. */
const PROBE = () => {
  const els = Array.from(document.querySelectorAll("body *"));
  const fontSizes = new Map();
  const radii = new Map();
  const shadows = new Map();
  const overflow = [];
  const smallTargets = [];
  const unnamed = [];
  const vw = document.documentElement.clientWidth;

  const isInteractive = (el) => {
    const t = el.tagName;
    if (t === "BUTTON" || t === "A" || t === "SELECT" || t === "TEXTAREA") return true;
    if (t === "INPUT") return !["hidden"].includes(el.type);
    const r = el.getAttribute("role");
    return ["button", "link", "menuitem", "tab", "switch", "checkbox", "radio", "option"].includes(r || "");
  };
  const accName = (el) =>
    (el.getAttribute("aria-label") || "").trim() ||
    (el.getAttribute("title") || "").trim() ||
    (el.textContent || "").trim() ||
    (el.getAttribute("aria-labelledby") ? "byid" : "") ||
    (el.tagName === "INPUT" && el.labels && el.labels.length ? "bylabel" : "");

  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    if ((el.textContent || "").trim().length > 0 && el.children.length === 0) {
      const k = `${cs.fontSize}/${cs.lineHeight}/${cs.fontWeight}`;
      fontSizes.set(k, (fontSizes.get(k) || 0) + 1);
    }
    if (cs.borderTopLeftRadius !== "0px") {
      radii.set(cs.borderTopLeftRadius, (radii.get(cs.borderTopLeftRadius) || 0) + 1);
    }
    if (cs.boxShadow && cs.boxShadow !== "none") {
      shadows.set(cs.boxShadow, (shadows.get(cs.boxShadow) || 0) + 1);
    }
    if (rect.right > vw + 2 && rect.width > 24) {
      overflow.push({ tag: el.tagName, cls: (el.className || "").toString().slice(0, 80), right: Math.round(rect.right) });
    }
    if (isInteractive(el)) {
      if (rect.height > 0 && (rect.height < 44 || rect.width < 44)) {
        smallTargets.push({
          tag: el.tagName,
          name: accName(el).slice(0, 40),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
      if (!accName(el)) {
        unnamed.push({ tag: el.tagName, cls: (el.className || "").toString().slice(0, 60) });
      }
    }
  }

  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) => h.tagName);
  const scroll = document.documentElement.scrollWidth;

  return {
    elementCount: els.length,
    fontSizes: Object.fromEntries([...fontSizes].sort((a, b) => b[1] - a[1])),
    radii: Object.fromEntries([...radii].sort((a, b) => b[1] - a[1])),
    shadows: Object.fromEntries([...shadows].sort((a, b) => b[1] - a[1])),
    distinctFontSizes: new Set([...fontSizes.keys()].map((k) => k.split("/")[0])).size,
    distinctRadii: radii.size,
    distinctShadows: shadows.size,
    horizontalScroll: scroll > vw + 2 ? { scroll, vw } : null,
    overflowingElements: overflow.slice(0, 12),
    overflowCount: overflow.length,
    smallTargetCount: smallTargets.length,
    smallTargets: smallTargets.slice(0, 15),
    unnamedControlCount: unnamed.length,
    unnamedControls: unnamed.slice(0, 10),
    headings,
    h1Count: headings.filter((h) => h === "H1").length,
    bodyText: document.body.innerText.slice(0, 500),
    hasSkeleton: !!document.querySelector('[data-slot="skeleton"], .animate-pulse'),
    hasSpinner: !!document.querySelector(".animate-spin"),
    hasAlert: !!document.querySelector('[role="alert"]'),
    tableCount: document.querySelectorAll("table").length,
    tableRowCount: document.querySelectorAll("table tbody tr").length,
    stickyHeaders: Array.from(document.querySelectorAll("table thead")).filter(
      (t) => getComputedStyle(t).position === "sticky" || getComputedStyle(t.querySelector("th") || t).position === "sticky",
    ).length,
    inputsWithoutLabel: Array.from(document.querySelectorAll("input,select,textarea")).filter(
      (i) => i.type !== "hidden" && !(i.labels && i.labels.length) && !i.getAttribute("aria-label") && !i.getAttribute("aria-labelledby"),
    ).map((i) => ({ type: i.type, ph: i.placeholder || "", name: i.name || "" })),
  };
};

async function assertTheme(page, theme) {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (isDark !== (theme === "dark")) throw new Error(`theme did not apply: asked ${theme}, html.dark=${isDark}`);
}

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await slugField.count())) await slugField.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  return !page.url().includes("/login");
}

async function shot(page, name) {
  const file = `${OUT}/shots/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
}

async function main() {
  const browser = await chromium.launch();
  const report = { capturedAt: new Date().toISOString(), routes: {} };

  // ── Pass 1: desktop, both themes, screenshots + probe, one context per persona/theme.
  for (const theme of ["light", "dark"]) {
    for (const [pname, persona] of Object.entries(PERSONAS)) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 160)));

      if (theme === "light" && pname === "manager") {
        await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        await shot(page, `login-light`);
        report.routes["login|desktop|light"] = { ...(await page.evaluate(PROBE)), persona: "anon" };
      }

      const ok = await login(page, persona);
      console.log(`${theme}/${pname}: ${ok ? "signed in" : "LOGIN FAILED " + page.url()}`);
      if (!ok) { await ctx.close(); continue; }

      for (const [name, route, wanted] of ROUTES) {
        if (wanted !== pname) continue;
        errors.length = 0;
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4500);
        await assertTheme(page, theme);
        await shot(page, `${name}-desktop-${theme}`);
        const probe = await page.evaluate(PROBE);
        report.routes[`${name}|desktop|${theme}`] = { ...probe, persona: pname, url: page.url(), errors: [...new Set(errors)].slice(0, 6) };
        console.log(`  ${name}: ${probe.distinctFontSizes} sizes, ${probe.distinctRadii} radii, ${probe.distinctShadows} shadows, ${probe.smallTargetCount} small targets, ${probe.overflowCount} overflow`);
      }
      await ctx.close();
    }
  }

  // ── Pass 2: responsive sweep, light only, manager + cashier, subset of routes.
  const RESPONSIVE = ["dashboard", "pos", "inventory-stock", "purchasing-po", "hr-employees", "finance-takings", "reports"];
  for (const [wname, w, h] of WIDTHS) {
    for (const [pname, persona] of Object.entries(PERSONAS)) {
      const subset = ROUTES.filter(([n, , p]) => p === pname && RESPONSIVE.includes(n));
      if (!subset.length) continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "light" });
      const page = await ctx.newPage();
      const ok = await login(page, persona);
      if (!ok) { await ctx.close(); continue; }
      for (const [name, route] of subset) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4000);
        await shot(page, `${name}-${wname}-light`);
        const probe = await page.evaluate(PROBE);
        report.routes[`${name}|${wname}|light`] = { ...probe, persona: pname, viewport: `${w}x${h}` };
        console.log(`  ${wname}/${name}: hscroll=${probe.horizontalScroll ? "YES " + probe.horizontalScroll.scroll + "px" : "no"}, overflow=${probe.overflowCount}, small=${probe.smallTargetCount}`);
      }
      await ctx.close();
    }
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/audit-probe.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log("\nevidence →", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
