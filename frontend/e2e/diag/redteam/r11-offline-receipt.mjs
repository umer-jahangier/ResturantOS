import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, ctx, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

// ---------- OFFLINE ----------
await page.locator('[data-testid="menu-item-first"]').click();
await page.waitForTimeout(800);
console.log(">> going offline");
await ctx.setOffline(true);
await page.waitForTimeout(4000);
await shot(page, "r11-01-offline-banner");
const banner = await page.evaluate(()=>({ text: document.body.innerText.replace(/\n+/g," | ").slice(0,500),
  hasOffline: /offline/i.test(document.body.innerText) }));
console.log("OFFLINE BANNER PRESENT:", banner.hasOffline);
console.log("OFFLINE PAGE:", banner.text.slice(0,300));

await page.locator('[data-testid="send-to-kitchen-button"]').click();
await page.waitForTimeout(6000);
await shot(page, "r11-02-offline-send");
const off = await page.evaluate(()=>({
  tail: document.body.innerText.replace(/\n+/g," | ").slice(-800),
  toasts: [...document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')].map(t=>t.innerText.replace(/\n/g," ").slice(0,160)),
}));
console.log("AFTER OFFLINE SEND toasts:", JSON.stringify(off.toasts));
console.log("AFTER OFFLINE SEND tail:", off.tail.slice(-500));

console.log(">> back online");
await ctx.setOffline(false);
await page.waitForTimeout(9000);
await shot(page, "r11-03-back-online");
const on = await page.evaluate(()=>({
  tail: document.body.innerText.replace(/\n+/g," | ").slice(-800),
  toasts: [...document.querySelectorAll('[data-sonner-toast],[role="status"]')].map(t=>t.innerText.replace(/\n/g," ").slice(0,160)),
}));
console.log("BACK ONLINE toasts:", JSON.stringify(on.toasts));
console.log("BACK ONLINE tail:", on.tail.slice(-500));

// did the order actually land?
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);
const list = await page.evaluate(()=>{
  const t=document.querySelector("table"); if(!t) return null;
  return [...t.querySelectorAll("tbody tr")].slice(0,4).map(r=>r.innerText.replace(/\n/g," / "));
});
console.log("ORDERS AFTER RECONNECT:"); (list||[]).forEach(r=>console.log("  ",r));

// ---------- RECEIPT ----------
const paid = page.locator('[data-testid="status-filter-PAID"]');
if (await paid.count()) { await paid.click(); await page.waitForTimeout(3000); }
const openBtn = page.locator('button[aria-label^="Open order"]').first();
if (await openBtn.count()) {
  await openBtn.click(); await page.waitForTimeout(2500);
  const btns = await page.evaluate(()=>[...document.querySelectorAll("button,a")].map(b=>(b.getAttribute("aria-label")||b.textContent||"").trim()).filter(t=>/receipt|print|bill/i.test(t)));
  console.log("RECEIPT/PRINT CONTROLS:", JSON.stringify(btns));
  await shot(page, "r11-04-paid-drawer");
}
await browser.close();
