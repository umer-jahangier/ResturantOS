// DIAGNOSIS ONLY — "subscriptions" in this product = the tenant's SaaS plan (tier) and the
// modules it unlocks, administered from the SuperAdmin platform console. The prior audit
// never returned a verdict for this word, so it is measured here from scratch.
import { launch, shot, statusOf, buttons, makeLog, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("06-subscriptions-log");
const SA = { email: "superadmin@softxlogic.com", password: "Test@123!" };

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"], input#email').first().fill(SA.email);
  await page.locator('input[name="password"], input#password').first().fill(SA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  say("after SuperAdmin login:", page.url());
  if (page.url().includes("/login")) { say("!! SUPERADMIN LOGIN FAILED"); return finish(browser); }

  for (const r of ["/platform/dashboard", "/platform/tenants"]) {
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const st = await statusOf(page);
    say(`ROUTE ${r} bounced=${st.bounced} alerts=${JSON.stringify(st.alertTexts)}`);
    say(`   TEXT: ${st.txt.replace(/\n/g, " | ").slice(0, 700)}`);
    await shot(page, `50${r.replace(/\//g, "_")}`, say);
  }

  // Open the working tenant and look for a plan/tier/module control.
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const ft = page.locator("text=Floating Terrace").first();
  if (await ft.count()) { await ft.click().catch(() => {}); await page.waitForTimeout(5000); }
  say("tenant detail url:", page.url());
  await shot(page, "51-tenant-detail", say);
  const st = await statusOf(page);
  say("TENANT DETAIL >>>", st.txt.replace(/\n/g, " | ").slice(0, 2000));
  say("TENANT DETAIL BUTTONS:", JSON.stringify(await buttons(page)));
  const sel = await page.evaluate(() =>
    Array.from(document.querySelectorAll("select,input,[role=switch],[role=combobox]")).map(
      (e) => `${e.tagName}:${e.getAttribute("aria-label") || e.getAttribute("name") || e.getAttribute("placeholder") || ""}`
    )
  );
  say("TENANT DETAIL CONTROLS:", JSON.stringify(sel));
  say("mentions tier/plan/module?", /tier|plan|module|subscription|billing/i.test(st.txt));

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
