// DIAGNOSIS ONLY — open a specific order from Order Management via its own row "Open"
// control, then mark its lines served. Tests whether a PAID-but-never-served order
// (the prior audit's dead end) can be driven to CLOSED from the UI after the fact.
import { launch, login, shot, buttons, makeLog, PERSONAS, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("04-rescue-v2-log");
const TARGET = process.argv[2] || "ORD-20260812-0007";

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();
  page.on("response", (r) => {
    const u = r.url();
    if (/\/api\/v1\/(pos|crm)\//.test(u) && r.status() >= 400) {
      say(`   HTTP ${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
    }
  });

  if (!(await login(page, PERSONAS.cashier, say))) return finish(browser);
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  await page.locator('button:has-text("Order Management")').first().click();
  await page.waitForTimeout(4500);

  // Scope to the row that contains the order number, then use that row's own control.
  const row = page.locator("tr", { hasText: TARGET });
  say(`rows matching ${TARGET}:`, await row.count());
  if (!(await row.count())) {
    say("   !! target not on the first page of Order Management");
    const all = await page.locator("tr").allInnerTexts();
    say("   visible rows:", JSON.stringify(all.slice(0, 25)));
    return finish(browser);
  }
  say("   ROW >>>", (await row.first().innerText()).replace(/\n/g, " | "));
  const open = row.first().locator('button:has-text("Open"), button:has-text("Continue")');
  say("   row controls:", JSON.stringify(await row.first().locator("button").allTextContents()));
  if (await open.count()) { await open.first().click(); await page.waitForTimeout(5000); }
  await shot(page, "30-order-opened", say);
  say("   AFTER OPEN >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1100));
  say("   BUTTONS:", JSON.stringify(await buttons(page)));

  let n = 0;
  for (let i = 0; i < 10; i++) {
    const ms = page.locator('button:has-text("Mark Served")');
    if (!(await ms.count())) break;
    await ms.first().click().catch(() => {});
    await page.waitForTimeout(3500);
    n++;
  }
  say("   lines marked served:", n);
  await shot(page, "31-after-serve", say);
  say("   AFTER SERVE >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1100));

  await page.waitForTimeout(9000);
  await page.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await shot(page, "32-crm-after", say);
  say("   CRM >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1100));

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
