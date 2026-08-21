/* Debug the OWNER login + identify the persistent [role=alert]. */
import { chromium } from "@playwright/test";
import { USERS, totpNow, BASE, shot } from "./printlib.mjs";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("   console.error:", m.text().slice(0, 200)); });
page.on("response", async (r) => {
  if (/auth|login|totp|token/i.test(r.url()) && r.request().method() === "POST")
    console.log(`   POST ${r.url().replace("http://localhost:8080", "")} -> ${r.status()}`);
});

const u = USERS.owner;
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
console.log("slug field present:", await slug.count());
if (await slug.count()) await slug.first().fill(u.slug);
await page.locator('input[name="email"], input#email').first().fill(u.email);
await page.locator('input[name="password"], input#password').first().fill(u.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(4000);
console.log("after password submit, url:", page.url());
await shot(page, "p0-after-password");
let body = await page.locator("body").innerText();
console.log("BODY:\n" + body.slice(0, 700));

// find any input that could be the TOTP field
const inputs = await page.evaluate(() =>
  [...document.querySelectorAll("input")].map((i) => ({ name: i.name, id: i.id, type: i.type, ph: i.placeholder, aria: i.getAttribute("aria-label") })));
console.log("inputs:", JSON.stringify(inputs, null, 1));

// Try filling whatever looks like a code field, fresh TOTP right now
const code = totpNow(u.totpSecret);
console.log("fresh totp:", code);
const cand = page.locator('input[name="totpCode"], input#totpCode, input[inputmode="numeric"], input[autocomplete="one-time-code"]');
if (await cand.count()) {
  await cand.first().fill(code);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}
console.log("after totp, url:", page.url());
await shot(page, "p0-after-totp");
body = await page.locator("body").innerText();
console.log("BODY2:\n" + body.slice(0, 500));

// Identify the persistent alert on an app page
await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const alerts = await page.evaluate(() =>
  [...document.querySelectorAll('[role="alert"]')].map((a) => ({ text: (a.textContent || "").trim().slice(0, 200), cls: a.className.slice(0, 120) })));
console.log("ALERTS on dashboard:", JSON.stringify(alerts, null, 1));
await browser.close();
