import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);

// open MY order 0026
await page.locator('button[aria-label*="ORD-20260812-0026"]').first().click();
await page.waitForTimeout(2500);
await page.locator('button:has-text("CHARGE NOW")').first().click();
await page.waitForTimeout(5000);
console.log("CHARGE URL:", page.url());

// PARTIAL payment: Rs 100.00 = 10000 paisa against Rs 591.80
await page.locator('input[aria-label="Amount in paisa"]').first().fill("10000");
await page.waitForTimeout(500);
await shot(page, "r6-01-partial-typed");
await page.locator('button:has-text("Record Payment")').click();
await page.waitForTimeout(5000);
await healthCheck(page, "after-partial");
await shot(page, "r6-02-after-partial");
const st = await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | "));
console.log("AFTER PARTIAL:", st.slice(st.indexOf("Order #"), st.indexOf("Order #")+1200));

// Now go back to the order drawer and look for Void on a PARTIALLY PAID order
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);
const rowText = await page.evaluate(()=>{
  const t=document.querySelector("table");
  const r=[...t.querySelectorAll("tbody tr")].find(r=>r.innerText.includes("0026"));
  return r?r.innerText.replace(/\n/g," / "):null;
});
console.log("ROW 0026 AFTER PARTIAL:", rowText);
await page.locator('button[aria-label*="ORD-20260812-0026"]').first().click();
await page.waitForTimeout(2500);
await shot(page, "r6-03-drawer-partially-paid");
const voidBtn = await page.evaluate(()=>{
  const b=[...document.querySelectorAll("button")].filter(x=>/void/i.test(x.getAttribute("aria-label")||x.textContent||""));
  return b.map(x=>({label:(x.getAttribute("aria-label")||x.textContent||"").trim(), visible:x.offsetParent!==null}));
});
console.log("VOID BUTTONS ON PARTIALLY-PAID ORDER:", JSON.stringify(voidBtn));

if (voidBtn.length) {
  await page.locator('button[aria-label="Void order"], button:has-text("Void")').first().click();
  await page.waitForTimeout(2000);
  await shot(page, "r6-04-void-panel");
  const panel = await page.evaluate(()=>{
    const p=document.querySelector('[data-testid="void-refund-panel"]');
    return p?{w:Math.round(p.getBoundingClientRect().width),h:Math.round(p.getBoundingClientRect().height),text:p.innerText.replace(/\n+/g," | ")}:null;
  });
  console.log("VOID PANEL:", JSON.stringify(panel));
  const ta = page.locator('textarea[placeholder*="Customer left"]');
  if (await ta.count()) {
    await ta.fill("REDTEAM: voiding an order that already took Rs 100 cash");
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Confirm Void")').click();
    await page.waitForTimeout(5000);
    await shot(page, "r6-05-after-void");
    const res = await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | ").slice(0,1500));
    console.log("AFTER VOID ATTEMPT:", res.slice(0,900));
  }
}
await browser.close();
