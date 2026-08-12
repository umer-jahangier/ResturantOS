/* Why is the owner's browser login refused when the same credentials work over curl? */
import { newBrowser, newPage, PEOPLE, totpNow, BASE, shot, log } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(PEOPLE.owner.slug);
  await page.locator('input[name="email"], input#email').first().fill(PEOPLE.owner.email);
  await page.locator('input[name="password"], input#password').first().fill(PEOPLE.owner.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  log("  after password:", page.url());
  log("  page text:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 400));
  await shot(page, "diag-after-password");

  const totp = page.locator('input[name="totpCode"], input#totpCode');
  log("  totp field count:", await totp.count());
  if (await totp.count()) {
    const secs = Math.floor(Date.now() / 1000) % 30;
    log("  seconds into window:", secs);
    const code = totpNow(PEOPLE.owner.totpSecret);
    log("  code:", code);
    await totp.first().fill(code);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
    log("  after totp:", page.url());
    log("  page text:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 500));
    await shot(page, "diag-after-totp");
  }
  log("  network:", JSON.stringify(page.__requests.filter((r) => /auth/.test(r.u)).slice(-8)));
} finally {
  await browser.close();
}
