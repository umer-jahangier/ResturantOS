import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.manager)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);
// manager may default to "My Orders" — switch to All Branch
const allBranch = page.locator('[data-testid="toggle-all-branch"]');
if (await allBranch.count()) { await allBranch.click(); await page.waitForTimeout(3000); }
await shot(page, "r7-01-manager-orders");
const rows = await page.evaluate(()=>{
  const t=document.querySelector("table"); if(!t) return null;
  return [...t.querySelectorAll("tbody tr")].slice(0,8).map(r=>r.innerText.replace(/\n/g," / "));
});
console.log("MANAGER ROWS:"); (rows||[]).forEach(r=>console.log("  ", r));

await page.locator('button[aria-label*="ORD-20260812-0026"]').first().click();
await page.waitForTimeout(2500);
await shot(page, "r7-02-manager-drawer");
const before = await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | ").slice(0,600));
console.log("DRAWER BEFORE:", before.slice(0,400));

await page.locator('button[aria-label="Void order"], button:has-text("Void")').first().click();
await page.waitForTimeout(1800);
await page.locator('textarea[placeholder*="Customer left"]').fill("REDTEAM: manager voiding an order that already took Rs 100 cash");
await page.waitForTimeout(400);
await shot(page, "r7-03-manager-void-panel");
await page.locator('button:has-text("Confirm Void")').click();
await page.waitForTimeout(6000);
await healthCheck(page, "after-manager-void");
await shot(page, "r7-04-after-manager-void");
const after = await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | ").slice(0,1400));
console.log("AFTER MANAGER VOID:", after.slice(0,900));
await browser.close();
