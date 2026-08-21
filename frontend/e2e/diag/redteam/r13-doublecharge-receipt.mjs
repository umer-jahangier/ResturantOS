import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.cashier)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(4000);
await page.locator('[data-testid="status-filter-PAID"]').click();
await page.waitForTimeout(3000);
await page.locator('button[aria-label^="Open order"]').first().click();
await page.waitForTimeout(2500);
await page.locator('button:has-text("CHARGE NOW")').first().click();
await page.waitForTimeout(6000);
await healthCheck(page, "charge-already-paid");
console.log("URL:", page.url());
await shot(page, "r13-01-charge-already-paid");
const st = await page.evaluate(()=>{
  const txt=document.body.innerText.replace(/\n+/g," | ");
  return { slice: txt.slice(txt.indexOf("Order #"), txt.indexOf("Order #")+1100),
    recordDisabled: document.querySelector('button:not([disabled])') && [...document.querySelectorAll("button")].filter(b=>/Record Payment/.test(b.textContent)).map(b=>({disabled:b.disabled})),
    receiptLinks: [...document.querySelectorAll("a,button")].filter(e=>/receipt|print/i.test(e.textContent||"")).map(e=>({t:e.textContent.trim(), href:e.getAttribute("href")})) };
});
console.log("ALREADY-PAID CHARGE PAGE:", JSON.stringify(st, null, 1));

// try to record ANOTHER payment on the fully-paid order
const amt = page.locator('input[aria-label="Amount in paisa"]');
if (await amt.count()) {
  await amt.first().fill("5000");
  await page.waitForTimeout(500);
  const rec = page.locator('button:has-text("Record Payment")');
  const disabled = await rec.first().isDisabled();
  console.log("SECOND PAYMENT — Record Payment disabled?", disabled);
  if (!disabled) {
    await rec.first().click();
    await page.waitForTimeout(5000);
    await shot(page, "r13-02-second-payment");
    const after = await page.evaluate(()=>{const t=document.body.innerText.replace(/\n+/g," | ");return t.slice(t.indexOf("Order #"), t.indexOf("Order #")+900)});
    console.log("AFTER SECOND PAYMENT ATTEMPT:", after);
  }
}
// receipt route
const m = page.url().match(/orders\/([0-9a-f-]+)\//);
if (m) {
  await page.goto(`${BASE}/app/pos/orders/${m[1]}/receipt`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await healthCheck(page, "receipt");
  await shot(page, "r13-03-receipt");
  console.log("RECEIPT PAGE:", (await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | "))).slice(0,900));
}
await browser.close();
