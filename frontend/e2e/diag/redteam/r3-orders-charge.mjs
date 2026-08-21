import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);
await healthCheck(page, "orders");
await shot(page, "r3-01-order-management");

const rows = await page.evaluate(() => {
  const t = document.querySelector("table");
  if (!t) return { headers: [], rows: [] };
  return {
    headers: [...t.querySelectorAll("thead th")].map(h=>h.textContent.trim()),
    rows: [...t.querySelectorAll("tbody tr")].slice(0,12).map(r=>[...r.querySelectorAll("td")].map(c=>c.innerText.replace(/\n/g," / ").trim())),
  };
});
console.log("ORDER LIST HEADERS:", JSON.stringify(rows.headers));
console.log("ORDER LIST ROWS:"); rows.rows.forEach(r=>console.log("  ", JSON.stringify(r)));

// open the first row's drawer
await page.locator("table tbody tr").first().click();
await page.waitForTimeout(2500);
await shot(page, "r3-02-drawer");
const drawer = await page.evaluate(()=>{
  const d = document.querySelector('[role="dialog"]') || document.querySelector('[data-testid*="drawer"]');
  return { found: !!d, w: d?d.getBoundingClientRect().width:0, h: d?d.getBoundingClientRect().height:0,
    buttons: d?[...d.querySelectorAll("button")].map(b=>(b.getAttribute("aria-label")||b.textContent||"").trim()).filter(Boolean):[],
    text: d?d.innerText.replace(/\n+/g," | ").slice(0,900):null };
});
console.log("DRAWER:", JSON.stringify(drawer, null, 1));
await browser.close();
