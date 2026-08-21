/* VERIFY #4: AR / house-account lifecycle in the browser, and the expenses tabs.
   Backend ArController exposes customer-accounts, charges, settlements, statement, aging.
   Question: how much of that can a user actually reach? DIAGNOSTIC ONLY. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const net = [];
page.on("response", (r) => { const u = r.url(); if (/\/api\/v1\//.test(u) && r.request().method() !== "GET") net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`); });

const ok = await login(page, PERSONAS.accountant);
P(`login=${ok}`);
if (!ok) { await browser.close(); process.exit(1); }

const btns = (w = page) => w.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean));

// ---------- Expenses tabs ----------
P("\n===== EXPENSES TABS =====");
await visit(page, "/app/finance/expenses");
for (const tab of ["Approved", "All statuses", "Pending approval"]) {
  const t = page.locator(`button:has-text("${tab}"), [role=tab]:has-text("${tab}")`);
  if (await t.count()) {
    await t.first().click(); await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    const seg = body.split("Guide |").pop() || body;
    P(`  tab "${tab}": ${body.includes("No expenses") ? "EMPTY (No expenses)" : "HAS ROWS"} :: ${body.slice(body.indexOf("Expenses"), body.indexOf("Expenses") + 400).replace(/\n/g, " | ")}`);
    await shot(page, `expenses-${tab.replace(/\s+/g, "-")}`);
  } else P(`  tab "${tab}" NOT FOUND`);
}

// ---------- House account create ----------
P("\n===== HOUSE ACCOUNT: create =====");
await visit(page, "/app/finance/house-accounts");
const newBtn = page.locator('button:has-text("New house account")');
P(`New house account button: ${await newBtn.count()}`);
if (await newBtn.count()) {
  await newBtn.first().click(); await page.waitForTimeout(2500);
  const dlg = page.locator('[role="dialog"]');
  P(`dialog count: ${await dlg.count()}`);
  if (await dlg.count()) {
    const box = await dlg.first().boundingBox();
    P(`dialog box (the 24px-dialog trap): ${JSON.stringify(box)}`);
    P(`dialog text: ${(await dlg.first().innerText()).slice(0, 700).replace(/\n/g, " | ")}`);
    const fields = await dlg.first().evaluate((d) => [...d.querySelectorAll("input,select,textarea")].map((i) => ({ name: i.name || i.id, type: i.type, ph: i.placeholder })));
    P(`fields: ${JSON.stringify(fields)}`);
    await shot(page, "house-account-dialog");
    // Fill it
    for (const f of fields) {
      const el = dlg.locator(`[name="${f.name}"], #${f.name}`).first();
      if (!(await el.count())) continue;
      if (/name/i.test(f.name)) await el.fill("DIAG Verify Corp");
      else if (/limit|amount/i.test(f.name)) await el.fill("50000");
      else if (/email/i.test(f.name)) await el.fill("diag@verify.local");
      else if (/phone/i.test(f.name)) await el.fill("03001234567");
      else if (/term|days/i.test(f.name)) await el.fill("30");
    }
    await shot(page, "house-account-filled");
    const submit = dlg.locator('button[type="submit"], button:has-text("Create"), button:has-text("Save")');
    P(`submit buttons: ${await submit.count()}`);
    if (await submit.count()) {
      await submit.last().click(); await page.waitForTimeout(4000);
      await shot(page, "house-account-after-create");
      const body = await page.locator("body").innerText();
      P(`after create: ${body.includes("No house accounts yet") ? "STILL EMPTY" : "ROW APPEARED"}`);
      P(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
      P(`body tail: ${body.slice(body.indexOf("House Accounts")).slice(0, 700).replace(/\n/g, " | ")}`);
    }
  }
}

// ---------- Can a charge / settlement be raised from the UI? ----------
P("\n===== HOUSE ACCOUNT: charge / settle affordances =====");
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(4000);
P(`buttons on list after reload: ${JSON.stringify(await btns())}`);
const rows = page.locator("table tbody tr");
P(`house account rows: ${await rows.count()}`);
if (await rows.count()) {
  await rows.first().click(); await page.waitForTimeout(3000);
  P(`after row click url=${page.url()}`);
  P(`buttons: ${JSON.stringify(await btns())}`);
  const b = await page.locator("body").innerText();
  P(`detail body: ${b.slice(b.indexOf("House")).slice(0, 800).replace(/\n/g, " | ")}`);
  await shot(page, "house-account-detail");
}
P(`\nCHARGE affordance: ${await page.locator('button:has-text("Charge")').count()}`);
P(`SETTLE affordance: ${await page.locator('button:has-text("Settle"), button:has-text("Payment")').count()}`);
P(`STATEMENT affordance: ${await page.locator('button:has-text("Statement"), a:has-text("Statement")').count()}`);

// ---------- AR aging after ----------
P("\n===== AR AGING after =====");
const r = await visit(page, "/app/finance/ar-aging");
P(`body: ${(r.body || "").slice((r.body || "").indexOf("AR Aging")).slice(0, 500).replace(/\n/g, " | ")}`);
await shot(page, "ar-aging-after");

P("\n--- non-GET network ---");
for (const x of net) P(x);
save("ar-lifecycle.txt", log.join("\n"));
await browser.close();
