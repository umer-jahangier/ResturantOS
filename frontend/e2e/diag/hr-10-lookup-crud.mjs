/* Pass 10: complete a department create + retire from the screen. */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
page.on("response", async (r) => {
  if (r.url().includes("/hr/config/") && r.request().method() !== "GET") {
    let b = ""; try { b = (await r.text()).slice(0, 200); } catch {}
    console.log(`    NET ${r.request().method()} ${r.url().split("/api")[1]} -> ${r.status()} ${b}`);
  }
});
await login(page, PERSONAS.owner);
await visit(page, "/app/hr/settings/departments", { persona: PERSONAS.owner });
console.log("before:", (await page.locator("table").innerText()).replace(/\n/g, " | "));
await page.getByRole("button", { name: /New department/i }).click();
await page.waitForTimeout(1200);
const dlg = page.locator('[role="dialog"]');
console.log("dialog width:", JSON.stringify(await dlg.first().boundingBox()));
const stamp = Date.now().toString().slice(-5);
await dlg.locator('input').first().fill(`Diag Dept ${stamp}`);
const inputs = await dlg.locator("input").count();
if (inputs > 1) await dlg.locator("input").nth(1).fill(`DD${stamp}`);
await shot(page, "10-department-dialog");
await dlg.getByRole("button", { name: /Add|Save|Create/i }).first().click();
await page.waitForTimeout(3000);
console.log("after:", (await page.locator("table").innerText()).replace(/\n/g, " | "));
await shot(page, "10-department-created");

// retire it
const row = page.locator("tr").filter({ hasText: `Diag Dept ${stamp}` });
console.log("row found:", await row.count());
if (await row.count()) {
  await row.getByRole("button", { name: /Retire/i }).click();
  await page.waitForTimeout(2500);
  console.log("after retire:", (await page.locator("table").innerText()).replace(/\n/g, " | "));
}
await shot(page, "10-department-retired");
await browser.close();
