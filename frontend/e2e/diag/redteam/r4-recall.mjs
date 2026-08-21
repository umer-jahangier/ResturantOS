import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);

// Click "Continue" on the first DRAFT row (park/recall)
const cont = page.locator('button[aria-label^="Continue order"]').first();
console.log("CONTINUE BUTTONS:", await page.locator('button[aria-label^="Continue order"]').count());
const label = await cont.getAttribute("aria-label");
console.log("CLICKING:", label);
await cont.click();
await page.waitForTimeout(3000);
await healthCheck(page, "drawer");
await shot(page, "r4-01-draft-drawer");

const d = await page.evaluate(()=>{
  const cands = [...document.querySelectorAll('[role="dialog"],[data-state="open"],aside,[class*="drawer"]')];
  const el = cands.map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width>200&&x.r.height>200).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height)[0];
  if(!el) return {found:false, body: document.body.innerText.slice(-1200)};
  return { found:true, w:Math.round(el.r.width), h:Math.round(el.r.height),
    buttons:[...el.e.querySelectorAll("button")].map(b=>(b.getAttribute("aria-label")||b.textContent||"").trim()).filter(Boolean),
    text: el.e.innerText.replace(/\n+/g," | ").slice(0,1400) };
});
console.log("DRAFT DRAWER:", JSON.stringify(d, null, 1));

// Try "Full Menu" — does it RECALL the order into the terminal?
const fm = page.locator('button:has-text("Full Menu")');
console.log("FULL MENU BUTTONS:", await fm.count());
if (await fm.count()) {
  await fm.first().click();
  await page.waitForTimeout(4000);
  await shot(page, "r4-02-after-full-menu");
  const term = await page.evaluate(()=>({
    hasOrderNo: /ORD-\d{8}-\d+/.test(document.body.innerText),
    orderNo: (document.body.innerText.match(/ORD-\d{8}-\d+/)||[null])[0],
    emptyCart: document.body.innerText.includes("Add items to start an order"),
    tail: document.body.innerText.slice(-700).replace(/\n+/g," | "),
  }));
  console.log("TERMINAL AFTER FULL MENU:", JSON.stringify(term, null, 1));
}
await browser.close();
