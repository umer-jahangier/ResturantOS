/* VERIFY #3: capabilities the first audit did not test.
   - chart of accounts: can an accountant CREATE an account?
   - journal entry: REVERSE an existing posted entry in the browser
   - house accounts: create + charge -> does AR aging populate?
   - FBR tax report: does it render a filing figure?
   DIAGNOSTIC ONLY. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save, scanExports } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const net = [];
page.on("response", (r) => { const u = r.url(); if (/\/api\/v1\//.test(u) && r.request().method() !== "GET") net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`); });

const ok = await login(page, PERSONAS.accountant);
P(`login accountant=${ok} url=${page.url()}`);
if (!ok) { await browser.close(); process.exit(1); }

async function buttons(where = page) {
  return where.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean));
}

// ---------- A. Chart of accounts: create an account ----------
P("\n===== A. CHART OF ACCOUNTS: create =====");
let r = await visit(page, "/app/finance/accounts");
P(`url=${r.url} denied=${r.denied} errored=${r.errored}`);
P(`buttons: ${JSON.stringify(await buttons())}`);
await shot(page, "coa-list");

// ---------- B. Journal entry reversal ----------
P("\n===== B. JOURNAL ENTRY: reverse a posted entry =====");
r = await visit(page, "/app/finance/journal-entries");
P(`url=${r.url} errored=${r.errored}`);
P(`buttons: ${JSON.stringify(await buttons())}`);
// open the first POSTED entry
const rows = page.locator("table tbody tr");
P(`JE rows: ${await rows.count()}`);
if (await rows.count()) {
  await rows.first().click();
  await page.waitForTimeout(3000);
  P(`after row click url=${page.url()}`);
  const body = await page.locator("body").innerText().catch(() => "");
  P(`detail buttons: ${JSON.stringify(await buttons())}`);
  P(`detail body(900): ${body.slice(0, 900).replace(/\n/g, " | ")}`);
  await shot(page, "je-detail");
  const rev = page.locator('button:has-text("Reverse")');
  P(`Reverse button count: ${await rev.count()}`);
  if (await rev.count()) {
    await rev.first().click();
    await page.waitForTimeout(2500);
    await shot(page, "je-reverse-dialog");
    const dlg = page.locator('[role="dialog"]');
    P(`reverse dialog present: ${await dlg.count()}`);
    if (await dlg.count()) P(`reverse dialog text: ${(await dlg.first().innerText()).slice(0, 600).replace(/\n/g, " | ")}`);
  }
}

// ---------- C. House accounts -> AR ----------
P("\n===== C. HOUSE ACCOUNTS =====");
r = await visit(page, "/app/finance/house-accounts");
P(`url=${r.url} errored=${r.errored} denied=${r.denied}`);
P(`buttons: ${JSON.stringify(await buttons())}`);
P(`body(900): ${(r.body || "").slice(0, 900).replace(/\n/g, " | ")}`);
await shot(page, "house-accounts");

// ---------- D. FBR tax report ----------
P("\n===== D. FBR TAX SUMMARY =====");
r = await visit(page, "/app/reports/fbr");
P(`url=${r.url} errored=${r.errored} denied=${r.denied}`);
P(`buttons: ${JSON.stringify(await buttons())}`);
P(`exports: ${JSON.stringify(await scanExports(page))}`);
P(`body(1400): ${(r.body || "").slice(0, 1400).replace(/\n/g, " | ")}`);
await shot(page, "fbr");

// ---------- E. Expenses: what lifecycle states exist ----------
P("\n===== E. EXPENSES =====");
r = await visit(page, "/app/finance/expenses");
P(`url=${r.url} errored=${r.errored}`);
P(`buttons: ${JSON.stringify(await buttons())}`);
P(`body(1200): ${(r.body || "").slice(0, 1200).replace(/\n/g, " | ")}`);
await shot(page, "expenses");

P("\n--- non-GET network ---");
for (const x of net) P(x);
save("untested.txt", log.join("\n"));
await browser.close();
