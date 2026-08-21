import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

// build a 2-line cart
await page.locator('[data-testid="menu-item-first"]').click();
await page.waitForTimeout(600);
const tiles = page.locator('[data-testid="menu-grid"] > div button[type="button"]').first();
await page.locator('[data-testid="menu-grid"] > div').nth(2).locator("button").first().click();
await page.waitForTimeout(600);

// pick a table
await page.locator('button:has-text("Select table"), [aria-label="Select table"]').first().click().catch(async()=>{
  await page.getByText("Select table").first().click();
});
await page.waitForTimeout(1500);
await shot(page, "r2-01-table-picker");
const opts = await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent.trim()).slice(0,10));
console.log("TABLE OPTIONS:", JSON.stringify(opts));
if (opts.length) { await page.locator('[role="option"]').first().click(); }
await page.waitForTimeout(1200);

await shot(page, "r2-02-cart-ready");
await page.locator('[data-testid="send-to-kitchen-button"]').click();
await page.waitForTimeout(7000);
await healthCheck(page, "after-send");
await shot(page, "r2-03-after-send");

const sent = await page.evaluate(() => ({
  panel: document.body.innerText.slice(-1800),
}));
console.log("AFTER SEND PANEL TAIL:", sent.panel.replace(/\n+/g, " | ").slice(-900));

// panel buttons after send (note controls?)
const post = await page.evaluate(() => [...document.querySelectorAll("button")].map(b=>(b.getAttribute("aria-label")||b.textContent||"").trim()).filter(Boolean));
console.log("POST-SEND BUTTONS:", JSON.stringify(post));

// capture the order number
const orderNo = await page.evaluate(()=>{ const m = document.body.innerText.match(/ORD-\d{8}-\d+/); return m?m[0]:null; });
console.log("ORDER NO:", orderNo);

// RELOAD — does the terminal remember the order? (persistence / recall test)
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const afterReload = await page.evaluate(()=>({ text: document.body.innerText.slice(-1200) }));
console.log("AFTER RELOAD TERMINAL TAIL:", afterReload.text.replace(/\n+/g," | ").slice(-700));
await shot(page, "r2-04-after-reload");

await browser.close();
