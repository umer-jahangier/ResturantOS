// DIAGNOSIS ONLY — inventory / suppliers / purchasing domain sweep.
// Signs in as a chosen persona and walks every inventory + purchasing route, recording:
//   - whether the page rendered content or an error/access-denied state
//   - the network calls the page made and their status codes
//   - the visible text (trimmed) so a screenshot cannot lie about an empty product
// Retries once on a detected error state, because a mid-failure audit is worse than none.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";

const PERSONAS = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  storekeeper: { slug: "floating-terrace", email: "storekeeper@terrace.local", password: "Terrace#Storekeeper1" },
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totp: true },
};

const ROUTES = [
  ["inv-root", "/app/inventory"],
  ["inv-ingredients", "/app/inventory/ingredients"],
  ["inv-categories", "/app/inventory/categories"],
  ["inv-recipes", "/app/inventory/recipes"],
  ["inv-coverage", "/app/inventory/coverage"],
  ["inv-stock", "/app/inventory/stock"],
  ["inv-setup", "/app/inventory/setup"],
  ["pur-root", "/app/purchasing"],
  ["pur-vendors", "/app/purchasing/vendors"],
  ["pur-suggestions", "/app/purchasing/order-suggestions"],
  ["pur-pos", "/app/purchasing/purchase-orders"],
  ["pur-invoices", "/app/purchasing/invoices"],
  ["pur-payments", "/app/purchasing/payments"],
  ["pur-analytics", "/app/purchasing/analytics"],
  // Routes the yardstick demands that may not exist at all:
  ["x-wastage", "/app/inventory/wastage"],
  ["x-transfers", "/app/inventory/transfers"],
  ["x-counts", "/app/inventory/counts"],
  ["x-valuation", "/app/inventory/valuation"],
  ["x-grn", "/app/purchasing/goods-receipt"],
];

const persona = PERSONAS[process.argv[2] ?? "manager"];
const label = process.argv[2] ?? "manager";

async function totpFor(email) {
  const { execSync } = await import("node:child_process");
  return execSync(`python3 /Users/muhammadumer/Documents/Projects/ResturantOS/scripts/generate_totp.py ${email}`)
    .toString().trim().split(/\s+/).pop();
}

async function login(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (p.slug && (await slug.count())) await slug.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  if (p.totp) {
    const otp = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"]');
    if (await otp.count()) {
      const code = await totpFor(p.email);
      console.log("   TOTP", code);
      await otp.first().fill(code);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
    }
  }
  return !page.url().includes("/login");
}

async function probe(page, name, route) {
  const calls = [];
  const handler = (res) => {
    const u = res.url();
    if (u.includes("/api/")) calls.push(`${res.status()} ${u.replace("http://localhost:8080", "").replace(BASE, "").split("?")[0]}`);
  };
  page.on("response", handler);
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  let body = await page.locator("body").innerText().catch(() => "");
  const bad = /couldn't load|could not load|something went wrong|access denied|failed to|error loading/i.test(body);
  if (bad) {
    // RETRY — a screenshot of a transient failure is how six of twenty routes got mis-audited.
    console.log(`   [retry] ${name} showed an error state, reloading`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    body = await page.locator("body").innerText().catch(() => "");
  }
  page.off("response", handler);
  await page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: true });
  const stillBad = /couldn't load|could not load|something went wrong|access denied|error loading/i.test(body);
  return { name, route, url: page.url(), errorState: stillBad, calls: [...new Set(calls)], text: body.slice(0, 2600) };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("   ! pageerror:", String(e).slice(0, 160)));

mkdirSync(OUT, { recursive: true });
const ok = await login(page, persona);
console.log(ok ? `signed in as ${persona.email}` : `LOGIN FAILED ${page.url()}`);
if (!ok) { await browser.close(); process.exit(1); }

const results = [];
for (const [name, route] of ROUTES) {
  const r = await probe(page, name, route);
  results.push(r);
  console.log(`\n### ${name}  ${route}  -> ${r.url}${r.errorState ? "   [ERROR STATE]" : ""}`);
  console.log("api:", r.calls.join(" | ") || "(none)");
  console.log("---\n" + r.text.replace(/\n{3,}/g, "\n\n"));
}
writeFileSync(`${OUT}/${label}-sweep.json`, JSON.stringify(results, null, 2));
await browser.close();
