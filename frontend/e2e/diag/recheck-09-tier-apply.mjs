// DIAGNOSIS ONLY — drive the tenant tier ("subscription plan") mutation in the browser.
// Deliberately re-applies the tenant's CURRENT tier (ENTERPRISE -> ENTERPRISE), which the UI
// itself describes as re-applying limits and reconciling modules. That proves the write path
// works end to end WITHOUT changing what the shared dev tenant is entitled to.
import { launch, shot, makeLog, buttons, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("09-tier-apply-log");
const SA = { email: "superadmin@softxlogic.com", password: "Test@123!" };
const FT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();
  const calls = [];
  page.on("response", (r) => {
    if (/\/api\/v1\/platform\//.test(r.url())) calls.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080", "")}`);
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"], input#email').first().fill(SA.email);
  await page.locator('input[name="password"], input#password').first().fill(SA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);

  await page.goto(`${BASE}/platform/tenants/${FT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  calls.length = 0;

  const move = page.locator('button:has-text("Move to")');
  say("tier-apply button:", JSON.stringify(await move.allTextContents()));
  if (await move.count()) {
    await move.first().click();
    await page.waitForTimeout(5000);
  }
  await shot(page, "62-after-tier-apply", say);
  say("PLATFORM CALLS:", JSON.stringify(calls));
  const txt = await page.locator("body").innerText();
  say("tier line after apply:", (txt.match(/ENTERPRISE[^|]{0,60}/) || [""])[0]);
  say("still ENTERPRISE:", /ENTERPRISE/.test(txt));
  say("BUTTONS:", JSON.stringify((await buttons(page)).slice(0, 10)));

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
