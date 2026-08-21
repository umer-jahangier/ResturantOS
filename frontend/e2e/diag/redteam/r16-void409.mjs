import { BASE, P, shot, login, newBrowser } from "./lib.mjs";
const { browser, page } = await newBrowser();
page.on("response", async (r) => {
  if (r.url().includes("/void")) {
    let body=""; try { body = (await r.text()).slice(0,400); } catch {}
    console.log(">> VOID RESPONSE", r.status(), r.url(), "BODY:", body);
  }
});
page.on("request", (r) => { if (r.url().includes("/void")) console.log(">> VOID REQUEST", r.method(), r.url(), "DATA:", r.postData()); });
if (!await login(page, P.manager)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Order Management" }).click();
await page.waitForTimeout(3500);
const ab = page.locator('[data-testid="toggle-all-branch"]'); if (await ab.count()) { await ab.click(); await page.waitForTimeout(2500); }
await page.locator('[data-testid="status-filter-PAID"]').click();
await page.waitForTimeout(3500);
await page.locator('button[aria-label*="ORD-20260812-0016"]').first().click();
await page.waitForTimeout(3000);
await page.locator('button[aria-label="Void order"], button:has-text("Void")').first().click();
await page.waitForTimeout(1200);
await page.locator('textarea[placeholder*="Customer left"]').fill("REDTEAM probe 2");
await page.locator('button:has-text("Confirm Void")').click();
await page.waitForTimeout(6000);
await browser.close();
