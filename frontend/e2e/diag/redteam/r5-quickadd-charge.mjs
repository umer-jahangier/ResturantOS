import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);

// --- QUICK ADD on a draft (recall + add)
await page.locator('button[aria-label^="Continue order"]').first().click();
await page.waitForTimeout(2500);
const qa = page.locator('input[placeholder="Search menu…"]');
console.log("QUICK ADD PRESENT:", await qa.count());
await qa.fill("Seekh");
await page.waitForTimeout(1800);
await shot(page, "r5-01-quickadd-results");
const res = await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('[role="option"],button')].map(b=>(b.textContent||"").trim()).filter(t=>t.toLowerCase().includes("seekh"));
  return rows.slice(0,5);
});
console.log("QUICK ADD RESULTS:", JSON.stringify(res));
if (res.length) {
  await page.locator('button', { hasText: /Seekh/ }).first().click();
  await page.waitForTimeout(2500);
}
const afterAdd = await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | ").slice(0,900));
console.log("DRAFT AFTER QUICK ADD:", afterAdd.slice(0,600));
await shot(page, "r5-02-after-quickadd");

// --- CHARGE
const charge = page.locator('button:has-text("CHARGE NOW")');
console.log("CHARGE BUTTONS:", await charge.count());
await charge.first().click();
await page.waitForTimeout(5000);
await healthCheck(page, "charge");
console.log("CHARGE URL:", page.url());
await shot(page, "r5-03-charge-page");

const chargeUi = await page.evaluate(()=>({
  selects: [...document.querySelectorAll("select")].map(s=>({label:s.getAttribute("aria-label"), opts:[...s.options].map(o=>o.textContent.trim())})),
  buttons: [...document.querySelectorAll("button")].map(b=>(b.getAttribute("aria-label")||b.textContent||"").trim()).filter(Boolean),
  inputs: [...document.querySelectorAll("input")].map(i=>({ph:i.placeholder, label:i.getAttribute("aria-label"), type:i.type, val:i.value})),
  text: document.body.innerText.replace(/\n+/g," | ").slice(0,2200),
}));
console.log("CHARGE UI:", JSON.stringify(chargeUi, null, 1));
await browser.close();
