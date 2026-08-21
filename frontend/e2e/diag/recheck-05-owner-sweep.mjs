// DIAGNOSIS ONLY — owner-persona sweep of every CRM/loyalty/rewards/subscription surface
// the prior audit called MISSING, plus the surfaces it never tested at all.
import { launch, login, shot, goodGoto, buttons, statusOf, makeLog, PERSONAS, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("05-owner-sweep-log");

const ROUTES = [
  "/app/crm",
  "/app/crm/loyalty",
  "/app/crm/promotions",
  "/app/crm/campaigns",
  "/app/crm/segments",
  "/app/crm/feedback",
  "/app/crm/rewards",
  "/app/loyalty",
  "/app/promotions",
  "/app/marketing",
  "/app/settings",
  "/app/settings/loyalty",
  "/app/settings/crm",
  "/app/settings/promotions",
  "/app/subscriptions",
  "/app/settings/billing",
  "/app/settings/subscription",
];

const KEYWORDS = /loyalt|reward|promotion|campaign|subscription|membership|referral|cashback|gift card|punch|voucher|feedback|segment/i;

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();
  if (!(await login(page, PERSONAS.owner, say))) { say("!! OWNER LOGIN FAILED"); return finish(browser); }

  // Full sidebar — proves which surfaces an owner can actually reach by navigation.
  await goodGoto(page, `${BASE}/app/dashboard`, say, PERSONAS.owner);
  const nav = await page.evaluate(() =>
    Array.from(document.querySelectorAll("nav a, aside a")).map((a) => `${a.textContent.trim()}::${a.getAttribute("href")}`).filter(Boolean)
  );
  say("OWNER SIDEBAR:", JSON.stringify(nav));
  await shot(page, "40-owner-dashboard", say);

  for (const r of ROUTES) {
    const st = await goodGoto(page, `${BASE}${r}`, say, PERSONAS.owner);
    const slug = r.replace(/\//g, "_");
    await shot(page, `41${slug}`, say);
    say(`ROUTE ${r} -> denied=${st.denied} notFound=${st.notFound} alerts=${st.alerts} kw=${KEYWORDS.test(st.txt)}`);
    say(`   TEXT: ${st.txt.replace(/\n/g, " | ").slice(0, 420)}`);
  }

  // The CRM screen in depth: can an owner create/edit a customer, log feedback, see history?
  await goodGoto(page, `${BASE}/app/crm`, say, PERSONAS.owner);
  say("CRM BUTTONS:", JSON.stringify(await buttons(page)));
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input,select,textarea")).map((i) => i.getAttribute("aria-label") || i.getAttribute("placeholder") || i.getAttribute("name") || i.tagName)
  );
  say("CRM INPUTS:", JSON.stringify(inputs));
  const row = page.locator("table tbody tr, ul li button").first();
  if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(3000); }
  await shot(page, "42-crm-detail-owner", say);
  const det = await page.locator("body").innerText();
  say("CRM DETAIL >>>", det.replace(/\n/g, " | ").slice(0, 1200));
  say("   detail shows order history?", /order|visit|history|last seen/i.test(det));
  say("   detail offers redeem?", /redeem|reward|use points/i.test(det));
  say("DETAIL BUTTONS:", JSON.stringify(await buttons(page)));

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
