// DIAGNOSIS ONLY — probe ONE route with a fresh login each time, capturing every API status.
// Re-logs-in whenever the app bounces to /login, so one route's session death cannot
// contaminate the verdict on the next route (which is what the first sweep did).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/inventory-purchasing";

const PERSONAS = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  storekeeper: { slug: "floating-terrace", email: "storekeeper@terrace.local", password: "Terrace#Storekeeper1" },
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totp: true },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totp: true },
};

const label = process.argv[2] ?? "manager";
const persona = PERSONAS[label];
const routes = process.argv.slice(3);

function totpFor(email) {
  return execSync(`python3 /Users/muhammadumer/Documents/Projects/ResturantOS/scripts/generate_totp.py ${email}`)
    .toString().trim().split(/\s+/).pop();
}

async function login(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (p.slug && (await slug.count())) {
    const toggle = page.getByText(/restaurant identifier/i);
    if (await toggle.count()) await toggle.first().click().catch(() => {});
    await page.waitForTimeout(300);
    const s2 = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await s2.count()) await s2.first().fill(p.slug);
  }
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  if (p.totp) {
    const otp = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"]');
    if (await otp.count()) {
      await otp.first().fill(totpFor(p.email));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4500);
    }
  }
  return !page.url().includes("/login");
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const results = [];

for (const route of routes) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const calls = [];
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("/api/")) calls.push({ s: res.status(), u: u.replace("http://localhost:8080", "").replace(BASE, "") });
  });
  page.on("pageerror", (e) => calls.push({ s: "JSERR", u: String(e).slice(0, 200) }));

  const ok = await login(page, persona);
  if (!ok) { console.log(`LOGIN FAILED for ${label}`); await ctx.close(); continue; }

  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  let body = await page.locator("body").innerText().catch(() => "");
  let url = page.url();
  if (url.includes("/login") || /couldn't load|could not load|something went wrong/i.test(body)) {
    console.log(`   [retry] ${route} -> ${url}, retrying once`);
    if (url.includes("/login")) await login(page, persona);
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    body = await page.locator("body").innerText().catch(() => "");
    url = page.url();
  }
  const slug = route.replace(/\//g, "_");
  await page.screenshot({ path: `${OUT}/${label}${slug}.png`, fullPage: true });
  const interesting = calls.filter((c) => c.s !== 200 || /inventory|purchasing|vendor/.test(c.u));
  console.log(`\n#### ${route} -> ${url}`);
  console.log("api:", interesting.map((c) => `${c.s} ${c.u.split("?")[0]}`).join("\n     ") || "(none)");
  console.log("---\n" + (body.split("Collapse").pop() || body).replace(/\n{2,}/g, "\n").trim().slice(0, 3000));
  results.push({ route, url, calls: interesting, text: body });
  await ctx.close();
}
writeFileSync(`${OUT}/${label}-probe.json`, JSON.stringify(results, null, 2));
await browser.close();
