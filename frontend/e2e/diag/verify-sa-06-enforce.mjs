// Does a module the platform console switched OFF actually stop working for the tenant?
// Read-only: Control Bistro (STARTER: CRM/NLQ/ANALYTICS/MULTI_BRANCH off) vs Floating Terrace (ENTERPRISE: all on).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

const PERSONAS = [
  { tag: "CONTROL(STARTER, CRM/NLQ off)", slug: "control-bistro-isolation-test-tenant", email: "manager@control.local", password: "Control#Manager1" },
  { tag: "TERRACE(ENTERPRISE, all on)", slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
];
const ROUTES = ["/app/crm", "/app/nlq", "/app/reports", "/app/dashboard"];

async function login(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  const slug = page.locator('input[name=tenantSlug], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(p.slug);
  await page.locator('input#email, input[name=email]').first().fill(p.email);
  await page.locator('input#password, input[name=password]').first().fill(p.password);
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(4500);
  return page.url();
}

async function main() {
  const browser = await chromium.launch();
  for (const p of PERSONAS) {
    P(`\n================ ${p.tag} ================`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    const api = [];
    page.on("response", r => { const u = r.url(); if (u.includes("/api/v1/") && !u.includes("refresh")) api.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080","")}`); });
    P("login ->", await login(page, p));

    // sidebar inventory
    await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(4000);
    const nav = await page.evaluate(() => [...document.querySelectorAll('aside a, nav a')].map(a => `${a.textContent.trim()}|${a.getAttribute("href")}`).filter(s => s.includes("/app")));
    P("SIDEBAR:", JSON.stringify([...new Set(nav)]));
    await page.screenshot({ path: `${OUT}/06-${p.slug.slice(0,12)}-dashboard.png`, fullPage: true });

    // the token's own feature view
    const flags = await page.evaluate(async () => {
      try { const r = await fetch("/api/v1/feature-flags", { credentials: "include" }); return { s: r.status, b: (await r.text()).slice(0, 700) }; } catch (e) { return { err: String(e) }; }
    });
    P("GET /api/v1/feature-flags ->", JSON.stringify(flags).slice(0, 800));

    // direct route navigation past the hidden nav
    for (const r of ROUTES) {
      await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3500);
      const s = await page.evaluate(() => { const t = document.body.innerText.replace(/\s+/g, " ");
        const alerts = [...document.querySelectorAll('[role=alert]')].map(e => e.textContent.trim().slice(0,90));
        return { alerts, txt: t.slice(0, 190) }; });
      P(`  ${r} -> alerts=${JSON.stringify(s.alerts)} :: ${s.txt}`);
      await page.screenshot({ path: `${OUT}/06-${p.slug.slice(0,12)}-${r.replace(/\//g,"_")}.png`, fullPage: true });
    }

    // API enforcement, from inside the browser session (gateway sees the real cookie/JWT)
    P("  -- direct API probes as this tenant --");
    for (const ep of ["/api/v1/crm/customers", "/api/v1/crm/loyalty/tiers", "/api/v1/nlq/query", "/api/v1/branches", "/api/v1/reports"]) {
      const res = await page.evaluate(async (ep) => {
        try { const r = await fetch(ep, { credentials: "include" }); return `${r.status} ${(await r.text()).slice(0, 120)}`; } catch (e) { return "ERR " + e; }
      }, ep);
      P(`     GET ${ep} -> ${res}`);
    }
    writeFileSync(`${OUT}/api-06-${p.slug.slice(0,12)}.txt`, [...new Set(api)].join("\n"));
    await ctx.close();
  }
  writeFileSync(`${OUT}/log-06-enforce.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-06-enforce.txt`, log.join("\n")+"\nFATAL "+e); });
