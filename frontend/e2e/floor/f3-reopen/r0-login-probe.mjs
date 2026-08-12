/* Why did the cashier login fail? Say it out loud rather than scoring an outage as a defect. */
import { newBrowser, newPage, PEOPLE } from "../../shift/lib.mjs";

const BASE = "http://localhost:3000";
const browser = await newBrowser();
const p = await newPage(browser);
await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);
const slug = p.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(PEOPLE.cashier.slug);
await p.locator('input[name="email"], input#email').first().fill(PEOPLE.cashier.email);
await p.locator('input[name="password"], input#password').first().fill(PEOPLE.cashier.password);
await p.locator('button[type="submit"]').first().click();
await p.waitForTimeout(6000);
console.log("url:", p.url());
console.log(
  JSON.stringify(
    await p.evaluate(() => ({
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 600),
    })),
    null,
    2,
  ),
);
console.log("api responses:", JSON.stringify(p.__requests.slice(-8), null, 2));
console.log("console errors:", p.__console.slice(0, 5));
await browser.close();
