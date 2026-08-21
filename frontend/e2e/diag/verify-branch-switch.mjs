/* DIAGNOSIS ONLY — branch switcher: presence, switch, persistence across reload + navigation. */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/branch-management");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const slug = page.locator('input[name="tenantSlug"], input[id*="tenant" i]').first();
if (await slug.count()) await slug.fill(P.slug).catch(() => {});
await page.locator('input[type="email"], input[name="email"]').first().fill(P.email);
await page.locator('input[type="password"]').first().fill(P.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(3000);
rec("url", page.url());

/** Read the JWT's branch_id out of wherever the app keeps the token. */
async function jwtBranch() {
  return page.evaluate(() => {
    const scan = [];
    for (let i = 0; i < localStorage.length; i++) scan.push([localStorage.key(i), localStorage.getItem(localStorage.key(i))]);
    for (let i = 0; i < sessionStorage.length; i++) scan.push([`ss:${sessionStorage.key(i)}`, sessionStorage.getItem(sessionStorage.key(i))]);
    const hit = scan.find(([, v]) => v && /eyJ[A-Za-z0-9_-]{10,}\./.test(v));
    if (!hit) return { where: null, branch: null, keys: scan.map(([k]) => k) };
    const m = hit[1].match(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\./);
    if (!m) return { where: hit[0], branch: null };
    try {
      const c = JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")));
      return { where: hit[0], branch: c.branch_id, roles: c.roles };
    } catch { return { where: hit[0], branch: "decode-failed" }; }
  });
}

async function switcherState() {
  return page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Switch branch"]');
    return { present: Boolean(btn), label: btn?.innerText?.trim().replace(/\s+/g, " ") ?? null };
  });
}

rec("switcher-initial", await switcherState());
rec("jwt-initial", await jwtBranch());
await page.screenshot({ path: resolve(OUT, "sw-01-initial.png"), fullPage: false });

// open the switcher and record the menu
await page.locator('button[aria-label="Switch branch"]').first().click();
await page.waitForTimeout(900);
const menu = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')).map((n) => n.innerText.trim().replace(/\s+/g, " "))
);
rec("switcher-menu", menu);
// dialog-width trap check: measure the dropdown
const dims = await page.evaluate(() => {
  const el = document.querySelector('[role="menu"], [data-radix-popper-content-wrapper]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
rec("switcher-menu-size", dims);
await page.screenshot({ path: resolve(OUT, "sw-02-menu-open.png"), fullPage: false });

// pick Rooftop
const rooftop = page.locator('[role="menuitem"], [role="menuitemradio"], [role="option"]').filter({ hasText: /Rooftop/i }).first();
await rooftop.click();
await page.waitForTimeout(4000);
rec("switcher-after-click", await switcherState());
rec("jwt-after-click", await jwtBranch());
await page.screenshot({ path: resolve(OUT, "sw-03-after-switch.png"), fullPage: false });

// HARD RELOAD — the claim under test
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3500);
rec("switcher-after-reload", await switcherState());
rec("jwt-after-reload", await jwtBranch());
await page.screenshot({ path: resolve(OUT, "sw-04-after-reload.png"), fullPage: false });

// client-side navigation (no reload)
await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
rec("switcher-after-nav", await switcherState());
rec("jwt-after-nav", await jwtBranch());

// brand-new tab in the same context (session persistence)
const page2 = await ctx.newPage();
await page2.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
await page2.waitForTimeout(3500);
rec("switcher-new-tab", await page2.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Switch branch"]');
  return { present: Boolean(btn), label: btn?.innerText?.trim().replace(/\s+/g, " ") ?? null };
}));

// Can the manager reach branch settings at all?
await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
rec("manager-settings", await page.evaluate(() => ({
  text: (document.body.innerText || "").slice(0, 400),
  hasAddress: Boolean(document.querySelector('input[name="address"]')),
})));
await page.screenshot({ path: resolve(OUT, "sw-05-manager-settings.png"), fullPage: true });

writeFileSync(resolve(OUT, "transcript-switch.json"), JSON.stringify(log, null, 2));
await browser.close();
