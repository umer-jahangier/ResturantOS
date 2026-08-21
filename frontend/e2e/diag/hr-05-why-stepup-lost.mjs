/* Pass 5: why does the first payroll approval after sign-in always fail? Log every 4xx + refresh. */
import { newBrowser, ctxPage, login, visit, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
page.on("response", (r) => {
  const u = r.url();
  if (r.status() >= 400 || /refresh|login|session|token/i.test(u)) {
    console.log(`  ${r.request().method()} ${u.replace("http://localhost:3000", "FE").replace("http://localhost:8080", "GW")} -> ${r.status()}`);
  }
});
console.log("### logging in");
await login(page, PERSONAS.owner);
console.log("### logged in, url =", page.url());
await page.waitForTimeout(3000);
console.log("### going to payroll");
await visit(page, "/app/hr/payroll");
console.log("### clicking approve");
const a = page.getByRole("button", { name: /^Approve$/ });
if (await a.count()) { await a.first().click(); await page.waitForTimeout(4000); }
else console.log("  (no Approve button — run is not CALCULATED)");
console.log("alerts:", (await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean).join(" | "));
await browser.close();
