import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
if (!await login(page, P.manager)) { await browser.close(); process.exit(1); }

async function takings(label) {
  await page.goto(`${BASE}/app/finance/takings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const t = await page.evaluate(() => {
    const txt = document.body.innerText.replace(/\n+/g, " | ");
    const grab = (k) => { const m = txt.match(new RegExp(k + "\\s*\\|\\s*(Rs [\\d,\\.]+)")); return m ? m[1] : null; };
    const cashRow = txt.match(/Cash\s*(\d+)\s*(Rs [\d,\.]+)/);
    return { gross: grab("GROSS SALES"), net: grab("NET SALES"), tax: grab("TAX"),
             cashCount: cashRow?.[1] ?? null, cashAmt: cashRow?.[2] ?? null,
             ordersClosed: (txt.match(/(\d+) orders closed/)||[])[1] };
  });
  console.log(`TAKINGS[${label}]:`, JSON.stringify(t));
  return t;
}

const t0 = await takings("baseline");

// create an order as manager, pay it partially
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.locator('[data-testid="menu-item-first"]').click();
await page.waitForTimeout(800);
await page.locator('[data-testid="send-to-kitchen-button"]').click();
await page.waitForTimeout(7000);
const orderNo = await page.evaluate(()=>(document.body.innerText.match(/ORD-\d{8}-\d+/)||[null])[0]);
console.log("EXPERIMENT ORDER:", orderNo);
await page.locator('button[aria-label="Charge order"], button:has-text("CHARGE NOW")').first().click();
await page.waitForTimeout(6000);
console.log("CHARGE URL:", page.url());
await page.locator('input[aria-label="Amount in paisa"]').first().fill("7700"); // Rs 77.00
await page.locator('button:has-text("Record Payment")').click();
await page.waitForTimeout(6000);
await healthCheck(page, "paid77");
await shot(page, "r9-01-paid-77");
console.log("STATE AFTER Rs77:", (await page.evaluate(()=>document.body.innerText.replace(/\n+/g," | "))).match(/Order #[\s\S]{0,700}/)[0]);

const t1 = await takings("after Rs77 partial payment");

// now void it as manager
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(3500);
await page.locator(`button[aria-label*="${orderNo}"]`).first().click();
await page.waitForTimeout(2500);
await page.locator('button[aria-label="Void order"], button:has-text("Void")').first().click();
await page.waitForTimeout(1500);
await page.locator('textarea[placeholder*="Customer left"]').fill("REDTEAM controlled experiment: void after Rs 77 cash taken");
await page.locator('button:has-text("Confirm Void")').click();
await page.waitForTimeout(6000);
await shot(page, "r9-02-after-void");
console.log("VOID DONE for", orderNo);

const t2 = await takings("after void");
console.log("DELTA baseline->paid:", JSON.stringify({t0,t1}));
console.log("DELTA paid->voided:", JSON.stringify({t1,t2}));
await browser.close();
