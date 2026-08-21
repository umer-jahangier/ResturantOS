/* Reports catalogue, period-close click-through, JE draft->post, cashier cash-up. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, shot, save, visit, totpNow } from "./fin-lib.mjs";

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
  if (!(await login(page, PERSONAS[who]))) throw new Error(`login failed ${who}`);
  return { ctx, page };
}
const strip = (t) =>
  t
    .split("\n")
    .filter((l) => !/^(Dashboard|POS|Kitchen Display|Till Review|Inventory|Menu Items|Tables|Stations|POS Terminals|Guide|Takings|Accounts|Journal Entries|General Ledger|Periods|Expenses|AP Aging|House Accounts|AR Aging|Transactions|Purchasing|Customers|Reports|Realtime Dashboard|Ask \(NLQ\)|Collapse|App|Finance|Floating Terrace.*|Search…|⌘K|OVERVIEW|ORDERS|MENU|FINANCE|PURCHASING|PEOPLE|REPORTING|HR|Users|Settings|Employees|Payroll|Schedule|Attendance)$/.test(l.trim()))
    .join("\n");

/* ---------- A. REPORTS CATALOGUE as owner ---------- */
{
  const { ctx, page } = await fresh("owner");
  say("\n===== A. REPORTS CATALOGUE (owner) =====");
  const r = await visit(page, "/app/reports");
  say(`url=${r.url} denied=${r.denied} errored=${r.errored} attempt=${r.attempt}`);
  await shot(page, "owner-reports");
  say(strip(r.body).slice(0, 4000));
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href*='/reports/']")].map((a) => `${a.textContent?.trim()} -> ${a.getAttribute("href")}`),
  );
  say(`report links: ${JSON.stringify(links)}`);
  await ctx.close();
}

/* ---------- B. PERIOD CLOSE — actually click it ---------- */
{
  const { ctx, page } = await fresh("accountant");
  say("\n===== B. PERIOD CLOSE — pressing the confirm button =====");
  await visit(page, "/app/finance/periods");
  await page.locator("button", { hasText: /close period/i }).nth(0).click();
  await page.waitForTimeout(2500);
  const dlg = page.locator('[role="dialog"], [role="alertdialog"]').first();
  page.net.length = 0;
  await dlg.locator("button", { hasText: /^close period$/i }).first().click();
  await page.waitForTimeout(6000);
  say(`API: ${page.net.filter((x) => /period|auth|totp|step/i.test(x)).join("\n     ") || "NONE"}`);
  const b = await page.locator("body").innerText();
  say(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
  say(`dialogs now: ${await page.locator('[role="dialog"],[role="alertdialog"]').count()}`);
  say(`asks for TOTP: ${/totp|verification code|authenticator|two.factor|step.up/i.test(b)}`);
  await shot(page, "period-close-after-confirm");
  const tbl = strip(b);
  say(tbl.slice(tbl.indexOf("Period 1") - 200, tbl.indexOf("Period 1") + 600));
  await ctx.close();
}

/* ---------- C. JOURNAL ENTRY: save draft, then try to post it ---------- */
{
  const { ctx, page } = await fresh("accountant");
  say("\n===== C. JOURNAL ENTRY draft -> post =====");
  await visit(page, "/app/finance/journal-entries/new");
  await page.locator('input[name="description"]').first().fill("DIAG-PROBE do not use");
  const accInputs = page.locator('input[placeholder*="account" i]');
  say(`account pickers: ${await accInputs.count()}`);
  await accInputs.nth(0).fill("1010");
  await page.waitForTimeout(1500);
  let opt = page.locator('[role="option"], li').filter({ hasText: /1010/ }).first();
  if (await opt.count()) await opt.click();
  await accInputs.nth(1).fill("4100");
  await page.waitForTimeout(1500);
  opt = page.locator('[role="option"], li').filter({ hasText: /4100/ }).first();
  if (await opt.count()) await opt.click();
  const nums = page.locator('input[type="number"]');
  await nums.nth(0).fill("5000");
  await nums.nth(3).fill("5000");
  await page.waitForTimeout(800);
  const pre = await page.locator("body").innerText();
  say(`balanced? ${!/Not balanced/.test(pre)}  | date label: ${(pre.match(/Selected: [\d-]+/) || ["?"])[0]}`);
  await shot(page, "je-filled-ready");
  page.net.length = 0;
  await page.locator('button[type="submit"]', { hasText: /save as draft/i }).first().click();
  await page.waitForTimeout(5000);
  say(`API: ${page.net.filter((x) => /journal/i.test(x)).join("\n     ") || "NONE"}`);
  say(`url after save: ${page.url()}`);
  say(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
  const after = await page.locator("body").innerText();
  await shot(page, "je-after-save");
  say(strip(after).slice(0, 1800));
  // If we landed on a detail page, look for a Post control
  const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()));
  say(`buttons on result page: ${JSON.stringify(btns.filter((x) => x && x.length < 30))}`);
  say(`POST control present: ${btns.some((x) => /^post$|post entry|approve/i.test(x || ""))}`);
  await ctx.close();
}

/* ---------- D. CASHIER: till open / cash-up ---------- */
{
  const { ctx, page } = await fresh("cashier");
  say("\n===== D. CASHIER till / cash-up =====");
  for (const route of ["/app/pos", "/app/pos/tills", "/app/finance/takings"]) {
    const r = await visit(page, route, { tries: 2 });
    say(`\n-- ${route} url=${r.url} denied=${r.denied} errored=${r.errored}`);
    await shot(page, `cashier${route.replace(/\//g, "_")}`);
    if (route === "/app/pos") {
      const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean));
      say(`buttons: ${JSON.stringify(btns.filter((x) => x.length < 40).slice(0, 40))}`);
      say(`till controls: ${JSON.stringify(btns.filter((x) => /till|drawer|cash|open|close|float|count|declare|X.report|Z.report|paid.?out|drop/i.test(x)))}`);
    } else {
      say(strip(r.body).slice(0, 1500));
    }
  }
  await ctx.close();
}

save("interact3.txt", log.join("\n"));
await browser.close();
