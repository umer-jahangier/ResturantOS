/* VERIFY #4b: AR / house-account lifecycle, done properly.
   Previous run filled accountCode blank (harness bug) and then lost the session to a 429.
   This one fills every field explicitly and asserts it is not on /login before each observation. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save, assertOn } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const net = [];
page.on("response", (r) => { const u = r.url(); if (/\/api\/v1\//.test(u) && r.request().method() !== "GET") net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`); });

const ok = await login(page, PERSONAS.accountant);
P(`login=${ok} url=${page.url()}`);
if (!ok) { await browser.close(); process.exit(1); }

const btns = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean));

P("\n===== HOUSE ACCOUNT: create (all fields filled) =====");
await visit(page, "/app/finance/house-accounts", { settle: 5000 });
await assertOn(page, "/app/finance/house-accounts");
await page.locator('button:has-text("New house account")').first().click();
await sleep(2500);
const dlg = page.locator('[role="dialog"]');
const stamp = Date.now().toString().slice(-5);
const vals = {
  accountCode: `HA-DIAG${stamp}`,
  name: `DIAG Verify Corp ${stamp}`,
  contactName: "Verify Agent",
  contactPhone: "03001234567",
  contactEmail: `diag${stamp}@verify.local`,
  creditLimitRupees: "50000",
  paymentTermsDays: "30",
};
for (const [k, v] of Object.entries(vals)) {
  const el = dlg.locator(`[name="${k}"]`).first();
  if (await el.count()) { await el.fill(v); P(`  filled ${k}=${v}`); } else P(`  MISSING FIELD ${k}`);
}
await shot(page, "ha2-filled");
await dlg.locator('button:has-text("Create house account")').first().click();
await sleep(5000);
await shot(page, "ha2-after-submit");
P(`dialog still open: ${await dlg.count()}`);
P(`alerts: ${JSON.stringify((await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean))}`);
let body = await page.locator("body").innerText();
P(`list empty? ${body.includes("No house accounts yet")}`);
P(`POST seen: ${JSON.stringify(net.filter((n) => /ar\/customer-accounts/.test(n)))}`);

// close dialog if open, then reload to prove persistence
if (await dlg.count()) { await page.locator('button:has-text("Cancel"), button:has-text("Close")').last().click().catch(() => {}); await sleep(1500); }
P("\n===== reload to prove persistence =====");
await sleep(4000);
const r2 = await visit(page, "/app/finance/house-accounts", { settle: 5000 });
if (r2.sessionLost) { P("SESSION LOST — re-login"); await login(page, PERSONAS.accountant); await visit(page, "/app/finance/house-accounts", { settle: 5000 }); }
await assertOn(page, "/app/finance/house-accounts");
body = await page.locator("body").innerText();
P(`after reload, list empty? ${body.includes("No house accounts yet")}`);
P(`contains our account? ${body.includes(`DIAG Verify Corp ${stamp}`)}`);
P(`rows: ${await page.locator("table tbody tr").count()}`);
P(`buttons: ${JSON.stringify(await btns())}`);
await shot(page, "ha2-after-reload");
P(`body: ${body.slice(body.indexOf("House Accounts")).slice(0, 900).replace(/\n/g, " | ")}`);

// charge / settle / statement affordances — measured while definitely signed in
P("\n===== charge / settle / statement affordances =====");
const rows = page.locator("table tbody tr");
if (await rows.count()) {
  await rows.first().click(); await sleep(3500);
  await assertOn(page, "house-account detail");
  P(`detail url=${page.url()}`);
  P(`detail buttons: ${JSON.stringify(await btns())}`);
  const b = await page.locator("body").innerText();
  P(`detail body: ${b.slice(b.indexOf("House")).slice(0, 900).replace(/\n/g, " | ")}`);
  await shot(page, "ha2-detail");
}
for (const [label, sel] of [["Charge", 'button:has-text("Charge")'], ["Settle/Payment", 'button:has-text("Settle"), button:has-text("Payment"), button:has-text("Record payment")'], ["Statement", 'button:has-text("Statement"), a:has-text("Statement")']]) {
  P(`  ${label}: ${await page.locator(sel).count()}`);
}

P("\n--- non-GET network ---");
for (const x of net) P(x);
save("ar-lifecycle2.txt", log.join("\n"));
await browser.close();
