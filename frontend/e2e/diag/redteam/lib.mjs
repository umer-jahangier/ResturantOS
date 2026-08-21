import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const BASE = "http://localhost:3000";
export const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-redteam";

export const P = {
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  waiter:  { slug: "floating-terrace", email: "waiter@terrace.local",  password: "Terrace#Waiter1" },
  owner:   { slug: "floating-terrace", email: "owner@terrace.local",   password: "Terrace#Owner1", totp: true },
  admin:   { slug: "floating-terrace", email: "admin@terrace.local",   password: "Terrace#Admin1", totp: true },
};

export async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log("  [shot]", name);
}

/** Screams if the page is showing an error/empty state instead of the product. */
export async function healthCheck(page, label) {
  const info = await page.evaluate(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent?.trim().slice(0, 160));
    const body = document.body.innerText || "";
    const bad = ["Couldn't load", "Couldn’t load", "Access denied", "Something went wrong", "You do not have permission", "not enabled for this account", "Failed to load"];
    return { alerts, hits: bad.filter((b) => body.includes(b)), len: body.length, url: location.href };
  });
  if (info.alerts.length || info.hits.length) {
    console.log(`  !! HEALTH[${label}] alerts=${JSON.stringify(info.alerts)} hits=${JSON.stringify(info.hits)}`);
  }
  return info;
}

export async function totpFor(email) {
  const { execSync } = await import("node:child_process");
  return execSync(`python3 /Users/muhammadumer/Documents/Projects/ResturantOS/scripts/generate_totp.py ${email}`)
    .toString().trim().match(/\d{6}/)[0];
}

export async function login(page, persona, attempt = 1) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  // NOTE: the login form ships WITHOUT a tenant-slug field; it is behind a
  // "Use a restaurant identifier instead" toggle. Email alone resolves the tenant.
  await page.locator('input[name="email"], input#email').first().fill(persona.email);
  await page.locator('input[name="password"], input#password').first().fill(persona.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (persona.totp) {
    const otp = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"], input[inputmode="numeric"]');
    if (await otp.count()) {
      const code = await totpFor(persona.email);
      await otp.first().fill(code);
      const btn = page.locator('button[type="submit"]');
      if (await btn.count()) await btn.first().click();
      await page.waitForTimeout(3500);
    }
  }
  const ok = !page.url().includes("/login");
  console.log(`  login ${persona.email}: ${ok ? "OK" : "FAILED"} -> ${page.url()}`);
  if (!ok && attempt < 3) {
    const err = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, " | "));
    console.log(`  RETRYING login (attempt ${attempt + 1}); page said: ${err}`);
    await new Promise((r) => setTimeout(r, 20000));
    return login(page, persona, attempt + 1);
  }
  return ok;
}

export async function newBrowser() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("    [console.error]", m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.log("    [pageerror]", String(e).slice(0, 200)));
  return { browser, ctx, page };
}
