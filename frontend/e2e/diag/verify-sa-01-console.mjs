// DIAGNOSIS ONLY — adversarial re-drive of the SuperAdmin/platform console.
// Run: cd frontend && node e2e/diag/verify-sa-01-console.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
const SA = { email: "superadmin@softxlogic.com", password: "Test@123!" };
mkdirSync(OUT, { recursive: true });

const log = [];
const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  P("  shot:", name);
}

// A screenshot of an error state looks like a screenshot of an empty product.
async function healthOf(page) {
  return await page.evaluate(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent.trim().slice(0, 160));
    const body = document.body.innerText;
    const bad = /Couldn't load|Could not load|Something went wrong|session expired|Access denied|doesn't exist|404/i.test(body);
    return { alerts, bad, len: body.length, head: body.slice(0, 400) };
  });
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("");
  await page.locator('input[name="email"], input#email').first().fill(SA.email);
  await page.locator('input[name="password"], input#password').first().fill(SA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  return page.url();
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/api/v1/")) api.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "").replace("http://localhost:3000", "")}`);
  });
  page.on("pageerror", (e) => P("  ! pageerror:", String(e).slice(0, 160)));

  P("== LOGIN ==");
  P("landed:", await login(page));
  await shot(page, "01-after-login");
  P(JSON.stringify(await healthOf(page)).slice(0, 500));

  // ---- OVERVIEW ----
  P("\n== /platform/dashboard (Overview) ==");
  await page.goto(`${BASE}/platform/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  let h = await healthOf(page);
  if (h.bad) { P("  RETRY (bad state):", h.head.slice(0, 200)); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(4000); h = await healthOf(page); }
  P("  health:", JSON.stringify(h).slice(0, 700));
  await shot(page, "02-overview");
  const dashText = await page.evaluate(() => document.body.innerText);
  writeFileSync(`${OUT}/overview.txt`, dashText);

  // ---- TENANTS LIST ----
  P("\n== /platform/tenants ==");
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  h = await healthOf(page);
  if (h.bad) { P("  RETRY:", h.head.slice(0, 200)); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(4000); h = await healthOf(page); }
  P("  health:", JSON.stringify(h).slice(0, 400));
  await shot(page, "03-tenants");
  const listInfo = await page.evaluate(() => ({
    rows: document.querySelectorAll("tbody tr").length,
    links: [...document.querySelectorAll('a[href*="/platform/tenants/"]')].length,
    controls: [...document.querySelectorAll("button, a[role=button], input, select")].map(e => (e.getAttribute("placeholder") || e.textContent.trim() || e.getAttribute("aria-label") || e.tagName)).filter(Boolean).slice(0, 40),
    text: document.body.innerText.slice(0, 2500),
  }));
  P("  rows:", listInfo.rows, "detailLinks:", listInfo.links);
  P("  controls:", JSON.stringify(listInfo.controls));
  writeFileSync(`${OUT}/tenants-list.txt`, listInfo.text);

  // ---- FLOATING TERRACE DETAIL: full control inventory ----
  const FT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";
  P("\n== /platform/tenants/" + FT + " (Floating Terrace) ==");
  await page.goto(`${BASE}/platform/tenants/${FT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  h = await healthOf(page);
  if (h.bad) { P("  RETRY:", h.head.slice(0, 200)); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(4500); h = await healthOf(page); }
  P("  health:", JSON.stringify(h).slice(0, 400));
  await shot(page, "04-ft-detail");
  const det = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean),
    switches: [...document.querySelectorAll('[role="switch"], input[type=checkbox]')].map(s => ({ label: (s.closest("label")?.textContent || s.getAttribute("aria-label") || s.id || "?").trim().slice(0, 50), state: s.getAttribute("aria-checked") ?? s.checked })),
    links: [...document.querySelectorAll("a")].map(a => a.getAttribute("href")).filter(Boolean),
    text: document.body.innerText,
  }));
  P("  BUTTONS:", JSON.stringify(det.buttons));
  P("  SWITCHES:", JSON.stringify(det.switches).slice(0, 1200));
  P("  LINKS:", JSON.stringify([...new Set(det.links)]));
  writeFileSync(`${OUT}/ft-detail.txt`, det.text);

  // ---- ROUTE PROBES ----
  P("\n== ROUTE PROBES (claimed 404) ==");
  for (const r of ["/platform/health", "/platform/users", "/platform/settings", "/platform/billing",
                   "/platform/plans", "/platform/usage", "/platform/audit", "/platform/tenants/" + FT + "/users",
                   "/platform/tenants/" + FT + "/audit", "/platform/impersonate", "/platform/overview",
                   "/platform/subscriptions", "/platform/support", "/platform/logs"]) {
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 110));
    P(`  ${r} -> ${t}`);
  }

  writeFileSync(`${OUT}/api-01.txt`, [...new Set(api)].join("\n"));
  writeFileSync(`${OUT}/log-01.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-01.txt`, log.join("\n") + "\nFATAL " + e); process.exit(1); });
