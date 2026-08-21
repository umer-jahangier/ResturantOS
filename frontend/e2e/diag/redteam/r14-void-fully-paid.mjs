import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.manager)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(3500);
const ab = page.locator('[data-testid="toggle-all-branch"]'); if (await ab.count()) { await ab.click(); await page.waitForTimeout(2500); }
await page.locator('[data-testid="status-filter-PAID"]').click();
await page.waitForTimeout(3000);
await shot(page, "r14-01-paid-list");
console.log("PAID ROWS:", JSON.stringify(await page.evaluate(()=>{const t=document.querySelector("table");return t?[...t.querySelectorAll("tbody tr")].map(r=>r.innerText.replace(/\n/g," / ")):[]})));

await page.locator('button[aria-label*="ORD-20260812-0011"]').first().click();
await page.waitForTimeout(2500);
await shot(page, "r14-02-fully-paid-drawer");
console.log("DRAWER CONTROLS:", JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("button")].map(b=>(b.getAttribute("aria-label")||b.textContent||"").trim()).filter(t=>/void|charge|refund/i.test(t)))));

await page.locator('button[aria-label="Void order"], button:has-text("Void")').first().click();
await page.waitForTimeout(1800);
await shot(page, "r14-03-void-panel-on-paid");
await page.locator('textarea[placeholder*="Customer left"]').fill("REDTEAM: voiding a FULLY PAID order (Rs 92.80 cash already taken)");
await page.locator('button:has-text("Confirm Void")').click();
await page.waitForTimeout(6000);
await healthCheck(page, "after-void-paid");
await shot(page, "r14-04-after-void-paid");
const has = await page.evaluate(()=>({ still: document.body.innerText.includes("0011"), tail: document.body.innerText.replace(/\n+/g," | ").slice(-500)}));
console.log("AFTER VOID contains 0011?", has.still);
console.log("TAIL:", has.tail.slice(-350));
await browser.close();
