import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.manager)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(3500);
const ab = page.locator('[data-testid="toggle-all-branch"]'); if (await ab.count()) { await ab.click(); await page.waitForTimeout(2500); }
await page.locator('[data-testid="status-filter-PAID"]').click();
await page.waitForTimeout(3500);
console.log("PAID ROWS BEFORE:", JSON.stringify(await page.evaluate(()=>{const t=document.querySelector("table");return t?[...t.querySelectorAll("tbody tr")].map(r=>r.innerText.replace(/\n/g," / ")):[]})));

// fresh drawer open -> current version
await page.locator('button[aria-label*="ORD-20260812-0016"]').first().click();
await page.waitForTimeout(3500);
await shot(page, "r15-01-paid-1682-drawer");
console.log("DRAWER:", (await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | "))).slice(-600));
await page.locator('button[aria-label="Void order"], button:has-text("Void")').first().click();
await page.waitForTimeout(1500);
await page.locator('textarea[placeholder*="Customer left"]').fill("REDTEAM: void of a FULLY PAID Rs 1,682.00 order, cash already in the drawer");
await shot(page, "r15-02-void-panel");
await page.locator('button:has-text("Confirm Void")').click();
await page.waitForTimeout(7000);
await shot(page, "r15-03-after");
const r = await page.evaluate(()=>({ err: document.body.innerText.includes("Failed to void"),
  still: document.body.innerText.includes("0016"), tail: document.body.innerText.replace(/\n+/g," | ").slice(-500)}));
console.log("VOID FAILED?", r.err, "| ORDER STILL LISTED?", r.still);
console.log("TAIL:", r.tail.slice(-300));
// refresh the list
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(3500);
const ab2 = page.locator('[data-testid="toggle-all-branch"]'); if (await ab2.count()) { await ab2.click(); await page.waitForTimeout(2500); }
await page.locator('[data-testid="status-filter-PAID"]').click();
await page.waitForTimeout(3500);
await shot(page, "r15-04-paid-after");
console.log("PAID ROWS AFTER:", JSON.stringify(await page.evaluate(()=>{const t=document.querySelector("table");return t?[...t.querySelectorAll("tbody tr")].map(r=>r.innerText.replace(/\n/g," / ")):[]})));
await browser.close();
