import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.manager)) { await browser.close(); process.exit(1); }

// 1) Does the VOIDED order with Rs 100 on it appear anywhere in Order Management?
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(3500);
const allBranch = page.locator('[data-testid="toggle-all-branch"]');
if (await allBranch.count()) { await allBranch.click(); await page.waitForTimeout(2500); }
const filters = await page.evaluate(()=>[...document.querySelectorAll('[data-testid^="status-filter-"]')].map(b=>b.textContent.trim()));
console.log("STATUS FILTERS:", JSON.stringify(filters));
for (const f of filters) {
  await page.locator('[data-testid^="status-filter-"]', { hasText: new RegExp(`^${f}$`) }).first().click();
  await page.waitForTimeout(2500);
  const has = await page.evaluate(()=>({ found: document.body.innerText.includes("0026"),
     rows: (document.querySelector("table")?.querySelectorAll("tbody tr").length)??0 }));
  console.log(`  filter=${f} rows=${has.rows} contains0026=${has.found}`);
}
await page.locator('[data-testid="order-management-search"]').fill("0026");
await page.waitForTimeout(2500);
await shot(page, "r8-01-search-voided");
console.log("SEARCH 0026 RESULT:", await page.evaluate(()=>document.body.innerText.includes("No active orders")?"NO ROWS":"rows present"));

// 2) Till Review — does the Rs 100 still count as cash in the drawer?
await page.goto(`${BASE}/app/pos/tills`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await healthCheck(page, "tills");
await shot(page, "r8-02-till-review");
console.log("TILL REVIEW:", (await page.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,1600));

// 3) Finance takings
await page.goto(`${BASE}/app/finance/takings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);
await healthCheck(page, "takings");
await shot(page, "r8-03-takings");
console.log("TAKINGS:", (await page.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,1600));
await browser.close();
