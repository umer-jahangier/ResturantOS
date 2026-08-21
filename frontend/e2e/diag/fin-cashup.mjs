/* The evening cash-up: does the cashier get a BLIND count with denominations? */
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
    if (r.url().includes("/api/")) page.net.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080", "")}`);
  });
  if (!(await login(page, PERSONAS[who]))) throw new Error("login " + who);
  return { ctx, page };
}

{
  const { ctx, page } = await fresh("cashier");
  say("===== CASHIER CASH-UP =====");
  await visit(page, "/app/pos", { settle: 7000 });
  const head = await page.locator("body").innerText();
  say(`till header: ${(head.match(/Till OPEN[\s\S]{0,120}/) || ["?"])[0].replace(/\n/g, " | ")}`);
  say(`!! EXPECTED CASH IS ON SCREEN BEFORE COUNTING: ${/Cash: Rs/.test(head)}`);

  const btn = page.locator("button", { hasText: /close till/i }).first();
  say(`Close Till button: ${await btn.count()}`);
  await btn.click();
  await page.waitForTimeout(4000);
  const dlg = page.locator('[role="dialog"], [role="alertdialog"]').first();
  say(`dialog count: ${await page.locator('[role="dialog"],[role="alertdialog"]').count()}`);
  if (await dlg.count()) {
    say(`dialog box: ${JSON.stringify(await dlg.boundingBox())}`);
    const t = await dlg.innerText();
    say(`--- dialog text ---\n${t}`);
    const ctrls = await dlg.evaluate((d) =>
      [...d.querySelectorAll("input,select,textarea,button")].map(
        (e) => `${e.tagName}<${e.getAttribute("type") || ""}>[${e.getAttribute("name") || e.getAttribute("placeholder") || e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 26)}]`,
      ),
    );
    say(`controls: ${JSON.stringify(ctrls)}`);
    say(`BLIND (expected hidden in dialog): ${!/expected/i.test(t)}`);
    say(`denomination breakdown fields: ${ctrls.filter((c) => /5000|1000|500|100|50|20|10|denom|note|coin/i.test(c)).length}`);
    say(`cash-in / paid-out control: ${/paid.?out|cash.?in|cash.?out|drop/i.test(t)}`);
  }
  await shot(page, "cashier-close-till-dialog");

  // Do NOT actually close the till — another agent's POS work depends on it.
  say("\n(not pressing confirm: closing the branch till would disturb sibling agents)");

  // X / Z report?
  const all = await page.evaluate(() => [...document.querySelectorAll("button,a")].map((b) => b.textContent?.trim()).filter(Boolean));
  say(`X/Z report controls anywhere on POS: ${JSON.stringify(all.filter((x) => /x.?report|z.?report|read report|shift report/i.test(x)))}`);
  await ctx.close();
}

/* reports + exports, rerun cleanly */
{
  const { ctx, page } = await fresh("owner");
  say("\n===== REPORTS =====");
  for (const code of ["sales-by-day", "till-sessions", "discount-summary"]) {
    const r = await visit(page, `/app/reports/${code}`, { tries: 2, settle: 5000 });
    const hits = await page.evaluate(() => [...document.querySelectorAll("button,a")].map((e) => e.textContent?.trim() ?? "").filter((t) => /export|download|csv|xlsx|excel|pdf|print/i.test(t)));
    say(`\n-- /app/reports/${code}  denied=${r.denied} errored=${r.errored}  exports=${hits.length ? JSON.stringify(hits) : "NONE"}`);
    await shot(page, `report-${code}`);
    const body = r.body.split("\n").filter((l) => l.trim() && !/^(Dashboard|POS|Guide|Takings|Accounts|Journal Entries|General Ledger|Periods|Expenses|AP Aging|House Accounts|AR Aging|Transactions|Purchasing|Customers|Reports|Realtime Dashboard|Ask \(NLQ\)|Collapse|App|Finance|Floating Terrace.*|Search…|⌘K|OVERVIEW|ORDERS|MENU|FINANCE|PURCHASING|PEOPLE|REPORTING|SETTINGS|General|Appearance|HR|Users|Settings|Inventory|Menu Items|Tables|Stations|POS Terminals|Kitchen Display|Till Review|\d+)$/.test(l.trim())).join("\n");
    say(body.slice(0, 1300));
  }
  await ctx.close();
}
save("cashup.txt", log.join("\n"));
await browser.close();
