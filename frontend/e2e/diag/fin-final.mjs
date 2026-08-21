/* JE save, takings as manager, cashier cash-up, report exports. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, shot, save, visit } from "./fin-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(String(s));
};
const browser = await chromium.launch();
async function fresh(who) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  page.net = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) page.net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
  });
  if (!(await login(page, PERSONAS[who]))) throw new Error(`login ${who}`);
  return { ctx, page };
}
const strip = (t) =>
  t.split("\n").filter((l) => !/^(Dashboard|POS|Kitchen Display|Till Review|Inventory|Menu Items|Tables|Stations|POS Terminals|Guide|Takings|Accounts|Journal Entries|General Ledger|Periods|Expenses|AP Aging|House Accounts|AR Aging|Transactions|Purchasing|Customers|Reports|Realtime Dashboard|Ask \(NLQ\)|Collapse|App|Finance|Floating Terrace.*|Search…|⌘K|OVERVIEW|ORDERS|MENU|FINANCE|PURCHASING|PEOPLE|REPORTING|SETTINGS|General|Appearance|\d)$/.test(l.trim())).join("\n");

/* ---- C3: journal entry, saved ---- */
{
  const { ctx, page } = await fresh("accountant");
  say("===== C3. JOURNAL ENTRY — fill and save =====");
  await visit(page, "/app/finance/journal-entries/new", { settle: 7000 });
  const desc = page.locator('input[placeholder="Journal entry description"]');
  say(`description field: ${await desc.count()}`);
  await desc.first().fill("DIAG probe — finance audit, safe to reverse");
  const accIn = page.locator('input[placeholder*="account" i]');
  say(`account inputs: ${await accIn.count()}`);
  const before = await page.locator("body").innerText();
  say(`DATE SHOWN AS SELECTED: ${(before.match(/Selected: [\d-]+/) || ["?"])[0]}`);
  say(`CALENDAR HEADER MONTH:  ${(before.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/) || ["?"])[0]}`);

  await accIn.nth(0).fill("1010");
  await page.waitForTimeout(2000);
  let sug = await page.evaluate(() => [...document.querySelectorAll('[role="option"],li,[data-value]')].map((e) => e.textContent?.trim()).filter((t) => t && t.length < 60 && /1010/.test(t)));
  say(`suggestions for "1010": ${JSON.stringify(sug.slice(0, 3))}`);
  let o = page.locator('[role="option"],li').filter({ hasText: /1010/ }).first();
  if (await o.count()) await o.click();
  await accIn.nth(1).fill("4100");
  await page.waitForTimeout(2000);
  o = page.locator('[role="option"],li').filter({ hasText: /4100/ }).first();
  if (await o.count()) await o.click();
  const nums = page.locator('input[placeholder="0"]');
  say(`amount inputs: ${await nums.count()}`);
  await nums.nth(0).fill("5000");
  await nums.nth(3).fill("5000");
  await page.waitForTimeout(1000);
  const mid = await page.locator("body").innerText();
  say(`balanced: ${!/Not balanced/.test(mid)}`);
  await shot(page, "je-filled");
  page.net.length = 0;
  const submit = page.locator('button[type="submit"]');
  say(`submit disabled: ${await submit.first().isDisabled()}`);
  await submit.first().click();
  await page.waitForTimeout(6000);
  say(`API: ${page.net.filter((x) => /journal/i.test(x)).join(" | ") || "NONE"}`);
  say(`url: ${page.url()}`);
  say(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
  await shot(page, "je-saved");
  const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((x) => x && x.length < 28));
  say(`buttons now: ${JSON.stringify(btns)}`);
  say(`ANY post/approve/reverse control: ${btns.some((x) => /^post|approve|reverse|submit for/i.test(x))}`);
  await ctx.close();
}

/* ---- E: takings as the MANAGER who cashes up ---- */
{
  const { ctx, page } = await fresh("manager");
  say("\n===== E. TAKINGS as manager (the cash-up persona) =====");
  const r = await visit(page, "/app/finance/takings");
  say(`denied=${r.denied} errored=${r.errored}`);
  await shot(page, "manager-takings");
  say(strip(r.body).slice(0, 2500));
  await ctx.close();
}

/* ---- F: cashier POS till controls ---- */
{
  const { ctx, page } = await fresh("cashier");
  say("\n===== F. CASHIER — till open / cash-up controls =====");
  const r = await visit(page, "/app/pos", { settle: 7000 });
  say(`url=${r.url} denied=${r.denied} errored=${r.errored}`);
  await shot(page, "cashier-pos");
  const btns = await page.evaluate(() => [...document.querySelectorAll("button,a")].map((b) => b.textContent?.trim()).filter((x) => x && x.length < 45));
  say(`till-ish controls: ${JSON.stringify(btns.filter((x) => /till|drawer|cash|float|count|declare|close|open|X.?report|Z.?report|paid.?out|drop|deposit|denomination/i.test(x)))}`);
  say(`--- page text ---\n${strip(r.body).slice(0, 1600)}`);
  const t = await visit(page, "/app/pos/tills", { tries: 1 });
  say(`\ncashier /app/pos/tills denied=${t.denied}`);
  await ctx.close();
}

/* ---- G: report exports + a ledger cross-check report ---- */
{
  const { ctx, page } = await fresh("owner");
  say("\n===== G. REPORTS: exports and ledger agreement =====");
  for (const code of ["sales-by-day", "till-sessions", "discount-summary"]) {
    const r = await visit(page, `/app/reports/${code}`, { tries: 2, settle: 5000 });
    say(`\n-- /app/reports/${code} denied=${r.denied} errored=${r.errored}`);
    const hits = await page.evaluate(() => [...document.querySelectorAll("button,a")].map((e) => e.textContent?.trim() ?? "").filter((t) => /export|download|csv|xlsx|excel|pdf|print/i.test(t)));
    say(`   export controls: ${hits.length ? JSON.stringify(hits) : "NONE"}`);
    await shot(page, `report-${code}`);
    say(strip(r.body).slice(0, 1400));
  }
  await ctx.close();
}

save("final.txt", log.join("\n"));
await browser.close();
