import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";
const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.locator('[data-testid="menu-grid"] > div').nth(2).locator("button").first().click(); // Butter Naan Rs 80 -> Rs 92.80
await page.waitForTimeout(800);
await page.locator('[data-testid="charge-now-button"]').click();
await page.waitForTimeout(8000);
await healthCheck(page, "charge");
console.log("URL:", page.url());
await page.locator('button:has-text("+ Add tender")').click();
await page.waitForTimeout(1200);
await shot(page, "r17-01-two-tenders");
const sel = page.locator('select[aria-label="Payment method"]');
const amt = page.locator('input[aria-label="Amount in paisa"]');
console.log("TENDER ROWS:", await sel.count(), "AMOUNT INPUTS:", await amt.count());
await amt.nth(0).fill("5000");            // Rs 50 cash
await sel.nth(1).selectOption("CARD");
await amt.nth(1).fill("4280");            // Rs 42.80 card
await page.waitForTimeout(800);
await shot(page, "r17-02-filled");
console.log("BEFORE RECORD:", (await page.evaluate(()=>{const t=document.body.innerText.replace(/\n+/g," | ");return t.slice(t.indexOf("Take Payment"), t.indexOf("Take Payment")+400)})));
await page.locator('button:has-text("Record Payment")').click();
await page.waitForTimeout(8000);
await healthCheck(page, "after-split");
await shot(page, "r17-03-after-split");
const after = await page.evaluate(()=>{const t=document.body.innerText.replace(/\n+/g," | ");return t.slice(t.indexOf("Order #"), t.indexOf("Order #")+1100)});
console.log("AFTER SPLIT TENDER:", after);
await browser.close();
