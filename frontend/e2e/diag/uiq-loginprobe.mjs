import { chromium } from "@playwright/test";
import { BASE } from "./uiq-lib.mjs";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("   console.error:", m.text().slice(0, 160)); });
page.on("response", async (r) => {
  if (r.url().includes("/auth") || r.url().includes("/login")) {
    console.log("   <-", r.status(), r.url().slice(0, 100));
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
console.log("fields before:", await page.evaluate(() =>
  [...document.querySelectorAll("input")].map((i) => `${i.name || i.id}:${i.type}`)));

await page.locator('input[name="email"]').first().fill("manager@terrace.local");
await page.locator('input[name="password"]').first().fill("Terrace#Manager1");
await page.locator('[data-testid="login-submit"], button[type=submit]').first().click();
await page.waitForTimeout(5000);
console.log("url after submit:", page.url());
console.log("body:", (await page.locator("body").innerText()).slice(0, 600).replace(/\n+/g, " | "));
await page.screenshot({ path: "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/ui-system-quality/loginprobe.png" });
await browser.close();
