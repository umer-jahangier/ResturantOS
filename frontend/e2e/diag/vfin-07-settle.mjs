/* VERIFY #5: settle the AR charge (does AR aging fall to zero, unlike AP?) and inspect the
   expenses status tabs — an approved expense exists in the GL, is it visible in the UI? */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save, assertOn } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const net = [];
page.on("response", (r) => { const u = r.url(); if (/\/api\/v1\/finance/.test(u) && r.request().method() !== "GET") net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`); });

const ok = await login(page, PERSONAS.accountant);
P(`login=${ok}`);
if (!ok) { await browser.close(); process.exit(1); }

// ---------- SETTLE ----------
P("\n===== SETTLE the Rs 100 charge =====");
await visit(page, "/app/finance/house-accounts", { settle: 5000 });
await assertOn(page, "house-accounts");
let b = await page.locator("body").innerText();
P(`balance before: ${(b.match(/Rs 50,000\.00\s+Rs [\d,]+\.\d\d/) || ["?"])[0]}`);
await page.locator('button:has-text("Settle")').first().click();
await sleep(2500);
const dlg = page.locator('[role="dialog"]');
P(`settle dialog: ${await dlg.count()} box=${JSON.stringify(await dlg.first().boundingBox().catch(() => null))}`);
if (await dlg.count()) {
  P(`text: ${(await dlg.first().innerText()).slice(0, 500).replace(/\n/g, " | ")}`);
  const fields = await dlg.first().evaluate((d) => [...d.querySelectorAll("input,select,textarea")].map((i) => ({ name: i.name || i.id, type: i.type })));
  P(`fields: ${JSON.stringify(fields)}`);
  for (const f of fields) {
    const el = dlg.locator(`[name="${f.name}"]`).first();
    if (!(await el.count())) continue;
    if (/amount|rupee/i.test(f.name)) await el.fill("100");
    else if (/reference|memo|note/i.test(f.name)) await el.fill("DIAG verify settlement");
    else if (f.type === "date") await el.fill("2026-08-12");
  }
  await shot(page, "settle-filled");
  await dlg.locator('button[type="submit"], button:has-text("Settle"), button:has-text("Post"), button:has-text("Record")').last().click();
  await sleep(5000);
  await shot(page, "settle-after");
  P(`dialog still open: ${await dlg.count()}`);
  P(`alerts: ${JSON.stringify((await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean))}`);
}

await sleep(3000);
const rHA = await visit(page, "/app/finance/house-accounts", { settle: 5000 });
if (!rHA.sessionLost) { b = await page.locator("body").innerText(); P(`row after settle: ${b.slice(b.indexOf("Code\tName")).slice(0, 300).replace(/\n/g, " | ")}`); }

P("\n===== AR AGING after settlement =====");
const r2 = await visit(page, "/app/finance/ar-aging", { settle: 5000 });
if (r2.sessionLost) { await login(page, PERSONAS.accountant); await visit(page, "/app/finance/ar-aging", { settle: 5000 }); }
await assertOn(page, "ar-aging");
const b2 = await page.locator("body").innerText();
P(`AR aging: ${b2.slice(b2.indexOf("AR Aging")).slice(0, 600).replace(/\n/g, " | ")}`);
await shot(page, "ar-aging-after-settle");

// ---------- EXPENSES TABS ----------
P("\n===== EXPENSES: is the approved expense visible? =====");
await sleep(2500);
const r3 = await visit(page, "/app/finance/expenses", { settle: 5000 });
if (r3.sessionLost) { await login(page, PERSONAS.accountant); await visit(page, "/app/finance/expenses", { settle: 5000 }); }
await assertOn(page, "expenses");
const tabEls = await page.evaluate(() => [...document.querySelectorAll('[role=tab],button,a')].map((e) => ({ tag: e.tagName, role: e.getAttribute("role"), text: (e.innerText || "").trim() })).filter((e) => /pending|approved|rejected|all statuses/i.test(e.text)));
P(`tab-like elements: ${JSON.stringify(tabEls)}`);
for (const t of ["Approved", "All statuses"]) {
  const loc = page.locator(`[role=tab]:has-text("${t}"), button:has-text("${t}"), [data-value]:has-text("${t}")`).first();
  if (await loc.count()) {
    await loc.click(); await sleep(3000);
    const bb = await page.locator("body").innerText();
    P(`  "${t}": ${bb.includes("No expenses") ? "EMPTY" : "HAS ROWS"} :: ${bb.slice(bb.indexOf("Expenses"), bb.indexOf("Expenses") + 450).replace(/\n/g, " | ")}`);
    await shot(page, `expenses-tab-${t.replace(/\s/g, "-")}`);
  } else P(`  "${t}" not clickable`);
}

P("\n--- finance non-GET ---");
for (const x of net) P(x);
save("settle-expenses.txt", log.join("\n"));
await browser.close();
