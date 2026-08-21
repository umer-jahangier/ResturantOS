// DIAGNOSIS ONLY — take the PRIOR audit's stuck order (fully paid, never served, never closed,
// customer attached, zero points) and drive it to closure from the UI by marking its line served.
// If this works, "the order never reaches CLOSED from any UI" is disproved on their own order.
import { launch, login, shot, buttons, makeLog, PERSONAS, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("03-rescue-stuck-order-log");
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

  const om = page.locator('button:has-text("Order Management")');
  say("'Order Management' present:", await om.count());
  if (await om.count()) { await om.first().click(); await page.waitForTimeout(4500); }
  await shot(page, "20-order-management", say);
  const listTxt = await page.locator("body").innerText();
  say("   target listed:", listTxt.includes(TARGET));

  // Open the target order's row.
  const row = page.locator(`text=${TARGET}`);
  say("   row matches:", await row.count());
  if (await row.count()) { await row.first().click(); await page.waitForTimeout(4000); }
  await shot(page, "21-order-open", say);
  say("   OPEN ORDER >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));
  say("   BUTTONS:", JSON.stringify(await buttons(page)));

  // Mark every remaining line served.
  let n = 0;
  for (let i = 0; i < 10; i++) {
    const ms = page.locator('button:has-text("Mark Served")');
    if (!(await ms.count())) break;
    await ms.first().click().catch(() => {});
    await page.waitForTimeout(3500);
    n++;
  }
  say("   lines marked served on the stuck order:", n);
  await shot(page, "22-after-serve", say);
  say("   AFTER >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));

  await page.waitForTimeout(9000);
  await page.goto(`${BASE}/app/crm`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await shot(page, "23-crm-after-rescue", say);
  say("   CRM >>>", (await page.locator("body").innerText()).replace(/\n/g, " | ").slice(0, 1200));

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
