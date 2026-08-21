// Sign in as the GRILL-scoped kitchen account and read the KDS it is actually shown.
import { chromium } from "@playwright/test";
import { openAndCheck, shot, BASE } from "./lib-login.mjs";

const EMAIL = process.argv[2];
const TEMP = process.argv[3];
const NEWPW = "Grill#Diag1234";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

try {
  await page.goto(`${BASE}/login?tenant=floating-terrace`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(TEMP);
  await page.getByTestId("login-submit").click();
  await page.waitForTimeout(4000);
  console.log("after first sign-in, url:", page.url());
  await shot(page, "g1-first-signin");
  const body = await page.locator("body").innerText();
  console.log("snippet:", body.replace(/\n+/g, " | ").slice(0, 400));

  // forced password change
  if (/change|new password/i.test(body)) {
    const pwFields = page.locator('input[type="password"]');
    const n = await pwFields.count();
    console.log("password fields on change screen:", n);
    if (n >= 2) {
      // some forms want current + new + confirm
      if (n === 3) {
        await pwFields.nth(0).fill(TEMP);
        await pwFields.nth(1).fill(NEWPW);
        await pwFields.nth(2).fill(NEWPW);
      } else {
        await pwFields.nth(0).fill(NEWPW);
        await pwFields.nth(1).fill(NEWPW);
      }
      await page.getByRole("button", { name: /change|save|update|continue|set/i }).first().click();
      await page.waitForTimeout(5000);
      console.log("after password change, url:", page.url());
      await shot(page, "g2-after-pw-change");
    }
  }

  if (!/\/app\//.test(page.url())) {
    await page.goto(`${BASE}/login?tenant=floating-terrace`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(NEWPW);
    await page.getByTestId("login-submit").click();
    await page.waitForTimeout(4500);
    console.log("re-login url:", page.url());
  }
  await shot(page, "g3-signed-in");

  console.log("\n=== KDS as a GRILL-scoped account ===");
  const r = await openAndCheck(page, "/app/kitchen", { settle: 4000 });
  console.log("h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed, "| alerts:", JSON.stringify(r.alerts).slice(0, 150));
  console.log("BODY:", r.body.replace(/\n+/g, " | ").slice(0, 700));
  await shot(page, "g4-kds-grill-scoped");

  // can they force their way onto DEFAULT (39 tickets) by typing the URL?
  const d = await openAndCheck(page, "/app/kitchen/DEFAULT", { settle: 4000 });
  console.log("\n=== typing /app/kitchen/DEFAULT directly ===");
  console.log("h1:", d.h1, "| denied:", d.denied, "| failed:", d.failed);
  console.log("ticket cards:", await page.getByTestId("kds-ticket-card").count().catch(() => -1));
  console.log("BODY:", d.body.replace(/\n+/g, " | ").slice(0, 600));
  await shot(page, "g5-kds-default-forced");
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-scoped-login-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
