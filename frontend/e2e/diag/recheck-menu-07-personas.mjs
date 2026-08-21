// RECHECK — persona trap. The prior report attributed the WORKS verdicts to "an owner".
// Verify the owner really can, and check the waiter — the persona photos would help most.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

function totp(email) {
  return execSync(`python3 /Users/muhammadumer/Documents/Projects/ResturantOS/scripts/generate_totp.py ${email}`)
    .toString().trim().match(/\d{6}/)?.[0];
}

async function login(page, email, password, needsTotp) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace");
  await page.locator('input#email, input[name="email"]').first().fill(email);
  await page.locator('input#password, input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (needsTotp) {
    const code = totp(email);
    log("   totp:", code, "| url:", page.url());
    const otp = page.locator('input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]');
    if (await otp.count()) {
      if ((await otp.count()) > 1) { const d = code.split(""); for (let i = 0; i < await otp.count(); i++) await otp.nth(i).fill(d[i] ?? ""); }
      else await otp.first().fill(code);
      await page.waitForTimeout(600);
      const sub = page.locator('button[type="submit"]');
      if (await sub.count()) await sub.first().click();
      await page.waitForTimeout(6000);
    } else log("   !! no OTP field found; page text:", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 200)));
  }
  log("   ->", page.url());
  return !page.url().includes("/login");
}

async function probe(page, tag, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => ({
    url: location.pathname,
    denied: /Access denied|don.t have permission|not authorized|403/i.test(document.body.innerText),
    notFound: /doesn.t exist/i.test(document.body.innerText),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()).filter(Boolean),
    grid: document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]').length,
    imgs: document.querySelectorAll("img").length,
    addCategory: [...document.querySelectorAll("button")].some((b) => /Add category/i.test(b.textContent)),
    addItem: [...document.querySelectorAll("button")].some((b) => /Add item/i.test(b.textContent)),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 330),
  }));
  log(`   ${tag} ${route}:`, JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/${tag}${route.replace(/\//g, "-")}.png` });
  return r;
}

async function main() {
  const b = await chromium.launch();

  log("=== OWNER (TOTP) ===");
  const p1 = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  if (await login(p1, "owner@terrace.local", "Terrace#Owner1", true)) {
    await probe(p1, "R60-owner", "/app/menu/items");
    await probe(p1, "R61-owner", "/app/pos");
    await probe(p1, "R62-owner", "/app/inventory/recipes");
  } else log("   OWNER LOGIN FAILED");

  log("=== WAITER ===");
  const p2 = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  if (await login(p2, "waiter@terrace.local", "Terrace#Waiter1", false)) {
    await probe(p2, "R63-waiter", "/app/pos");
    await probe(p2, "R64-waiter", "/app/menu/items");
  } else log("   WAITER LOGIN FAILED");

  await b.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
