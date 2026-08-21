import { launch, BASE, OUT } from "./onboarding-lib.mjs";

const { browser, page } = await launch();
page.on("response", async (r) => {
  if (r.url().includes("/api/")) {
    let body = "";
    try { body = (await r.text()).slice(0, 300); } catch {}
    console.log(`  <- ${r.status()} ${r.url()} ${body}`);
  }
});
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/login-form.png`, fullPage: true });
const html = await page.locator("form").first().innerHTML();
console.log(html.replace(/\s+/g, " ").slice(0, 3000));
await page.locator('input[name="email"], input#email').first().fill("superadmin@softxlogic.com");
await page.locator('input[name="password"], input#password').first().fill("Test@123!");
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(6000);
console.log("URL:", page.url());
console.log("BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800));
await page.screenshot({ path: `${OUT}/login-after.png`, fullPage: true });
await browser.close();
