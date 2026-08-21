import { chromium } from "@playwright/test";
import { PERSONAS, login, shot, save, visit } from "./fin-lib.mjs";
const log=[]; const say=(s)=>{console.log(s);log.push(String(s));};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1500,height:1100} });
const page = await ctx.newPage();
const net=[]; page.on("response",(r)=>{ if(r.url().includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080","")}`); });
await login(page, PERSONAS.accountant);
const ID="fe5a5def-2c5d-4794-b5ae-a317ffd3d0c9";
const r = await visit(page, `/app/finance/journal-entries/${ID}`, {settle:6000});
say(`detail page denied=${r.denied} errored=${r.errored}`);
say(`--- detail text ---\n${r.body.split("\n").filter(l=>l.trim()&&!/^(Dashboard|POS|Guide|Takings|Accounts|Journal Entries|General Ledger|Periods|Expenses|AP Aging|House Accounts|AR Aging|Transactions|Purchasing|Customers|Reports|Realtime Dashboard|Ask \(NLQ\)|Collapse|App|Finance|Floating Terrace.*|Search…|⌘K|OVERVIEW|ORDERS|FINANCE|PURCHASING|PEOPLE|REPORTING|\d+)$/.test(l.trim())).join("\n").slice(0,1500)}`);
await shot(page,"je-detail-draft");
const post = page.locator("button",{hasText:/^post$/i}).first();
say(`Post button: ${await post.count()}`);
if (await post.count()){
  net.length=0;
  await post.click(); await page.waitForTimeout(6000);
  say(`API: ${net.filter(x=>/journal/i.test(x)).join(" | ")||"none"}`);
  say(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
  const b=await page.locator("body").innerText();
  say(`status now shown: ${(b.match(/DRAFT|POSTED/g)||[]).join(",")}`);
  say(`entry number now: ${(b.match(/JE-\d{4}-\d+/)||["<none>"])[0]}`);
  await shot(page,"je-detail-after-post");
}
save("je-post.txt",log.join("\n"));
await browser.close();
