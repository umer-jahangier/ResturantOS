import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);
await page.locator('[data-testid="status-filter-PAID"]').click();
await page.waitForTimeout(3000);
const paidRows = await page.evaluate(()=>{const t=document.querySelector("table");return t?[...t.querySelectorAll("tbody tr")].map(r=>r.innerText.replace(/\n/g," / ")):[]});
console.log("PAID ROWS:", JSON.stringify(paidRows.slice(0,5), null, 1));
if (paidRows.length) {
  await page.locator('button[aria-label^="Open order"]').first().click();
  await page.waitForTimeout(3000);
  await shot(page, "r12-01-paid-drawer");
  const d = await page.evaluate(()=>{
    const all=[...document.querySelectorAll("button,a")].map(b=>({t:(b.getAttribute("aria-label")||b.textContent||"").trim(), href:b.getAttribute("href")}));
    return { receiptish: all.filter(x=>/receipt|print|bill|email|sms/i.test(x.t)), count: all.length,
      bodyTail: document.body.innerText.replace(/\n+/g," | ").slice(-800) };
  });
  console.log("PAID DRAWER receipt controls:", JSON.stringify(d.receiptish));
  console.log("PAID DRAWER tail:", d.bodyTail.slice(-500));
}
// direct receipt route
const url = page.url();
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// --- can two orders sit on the SAME table?
await page.locator('[data-testid="menu-item-first"]').click();
await page.waitForTimeout(700);
await page.getByText("Select table").first().click();
await page.waitForTimeout(1500);
const opts = await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent.trim()));
console.log("TABLE OPTIONS (note Occupied ones are selectable):", JSON.stringify(opts));
const occupied = opts.findIndex(o=>/Occupied/.test(o));
if (occupied >= 0) {
  console.log("SELECTING AN ALREADY-OCCUPIED TABLE:", opts[occupied]);
  await page.locator('[role="option"]').nth(occupied).click();
  await page.waitForTimeout(1200);
  await shot(page, "r12-02-occupied-table-selected");
  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(7000);
  await healthCheck(page, "double-seat");
  await shot(page, "r12-03-after-double-seat");
  const r = await page.evaluate(()=>({ tail: document.body.innerText.replace(/\n+/g," | ").slice(-600),
    alerts:[...document.querySelectorAll('[role="alert"],[data-sonner-toast]')].map(a=>a.innerText.replace(/\n/g," ").slice(0,200))}));
  console.log("DOUBLE-SEAT RESULT alerts:", JSON.stringify(r.alerts));
  console.log("DOUBLE-SEAT tail:", r.tail.slice(-400));
}
// floor view — how many orders on that table?
await page.getByRole("button", { name: "Floor View" }).click();
await page.waitForTimeout(4000);
await shot(page, "r12-04-floor-view");
console.log("FLOOR:", (await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | "))).slice(-900));
await browser.close();
