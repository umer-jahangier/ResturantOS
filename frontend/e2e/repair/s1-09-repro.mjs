// S1-09 reproduction: what a manager sees at /app/pos when pos-service is down,
// and whether any operator health surface exists at all.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/repair/S1-09/before";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await slugField.count())) await slugField.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  return !page.url().includes("/login");
}

async function probe(page, label, route) {
  const netFails = [];
  const onResp = (r) => {
    if (r.status() >= 400) netFails.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/localhost:8080/, "")}`);
  };
  page.on("response", onResp);
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const info = await page.evaluate(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim().slice(0, 260));
    return {
      url: location.pathname,
      alerts,
      bodyHasNotFound: document.body.innerText.includes("doesn't exist") || document.body.innerText.includes("404"),
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
    };
  });
  page.off("response", onResp);
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: false });
  console.log(`\n### ${label}  (${route}) -> ${info.url}`);
  console.log("  alerts:", JSON.stringify(info.alerts));
  console.log("  4xx/5xx:", JSON.stringify([...new Set(netFails)].slice(0, 12)));
  console.log("  text:", info.text);
  return info;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const ok = await login(page, MANAGER);
console.log("login:", ok ? "OK" : `FAILED (${page.url()})`);
if (!ok) process.exit(1);

await probe(page, "01-pos-terminal", "/app/pos");
await probe(page, "02-settings", "/app/settings");
await probe(page, "03-settings-health", "/app/settings/health");
await probe(page, "04-health", "/app/health");

// sidebar inventory
const nav = await page.evaluate(() =>
  [...document.querySelectorAll("nav a, aside a")].map((a) => a.textContent.trim()).filter(Boolean),
);
console.log("\nSIDEBAR:", JSON.stringify([...new Set(nav)]));

await browser.close();
