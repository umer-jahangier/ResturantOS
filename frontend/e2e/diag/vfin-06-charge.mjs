/* VERIFY #4c: charge a house account, then check AR aging + GL. Is AR aging empty because
   unused, or empty because broken? DIAGNOSTIC ONLY. Creates a small Rs 100 charge. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save, assertOn } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/\/api\/v1\//.test(u) && r.request().method() !== "GET") {
    let t = ""; try { t = (await r.text()).slice(0, 200); } catch {}
    net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")} :: ${t}`);
  }
});

const ok = await login(page, PERSONAS.accountant);
P(`login=${ok}`);
if (!ok) { await browser.close(); process.exit(1); }

await visit(page, "/app/finance/house-accounts", { settle: 5000 });
await assertOn(page, "/app/finance/house-accounts");
P(`rows: ${await page.locator("table tbody tr").count()}`);

P("\n===== CHARGE =====");
await page.locator('button:has-text("Charge")').first().click();
await sleep(2500);
const dlg = page.locator('[role="dialog"]');
P(`dialog: ${await dlg.count()} box=${JSON.stringify(await dlg.first().boundingBox().catch(() => null))}`);
if (await dlg.count()) {
  P(`dialog text: ${(await dlg.first().innerText()).slice(0, 600).replace(/\n/g, " | ")}`);
  const fields = await dlg.first().evaluate((d) => [...d.querySelectorAll("input,select,textarea")].map((i) => ({ name: i.name || i.id, type: i.type, ph: i.placeholder })));
  P(`fields: ${JSON.stringify(fields)}`);
  await shot(page, "charge-dialog");
  for (const f of fields) {
    const el = dlg.locator(`[name="${f.name}"]`).first();
    if (!(await el.count())) continue;
    if (/amount|rupee/i.test(f.name)) await el.fill("100");
    else if (/desc|memo|reference|note/i.test(f.name)) await el.fill("DIAG verify charge");
    else if (f.type === "date") await el.fill("2026-08-12");
  }
  await shot(page, "charge-filled");
  const sub = dlg.locator('button[type="submit"], button:has-text("Charge"), button:has-text("Save")');
  await sub.last().click();
  await sleep(5000);
  await shot(page, "charge-after");
  P(`dialog still open: ${await dlg.count()}`);
  P(`alerts: ${JSON.stringify((await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean))}`);
}

await sleep(3000);
const r = await visit(page, "/app/finance/house-accounts", { settle: 5000 });
if (!r.sessionLost) {
  const b = await page.locator("body").innerText();
  P(`\nbalance row: ${b.slice(b.indexOf("Code\tName")).slice(0, 400).replace(/\n/g, " | ")}`);
}

P("\n===== AR AGING after the charge =====");
const r2 = await visit(page, "/app/finance/ar-aging", { settle: 5000 });
if (r2.sessionLost) { await login(page, PERSONAS.accountant); await visit(page, "/app/finance/ar-aging", { settle: 5000 }); }
await assertOn(page, "/app/finance/ar-aging");
const b2 = await page.locator("body").innerText();
P(`AR aging: ${b2.slice(b2.indexOf("AR Aging")).slice(0, 700).replace(/\n/g, " | ")}`);
await shot(page, "ar-aging-after-charge");

P("\n--- non-GET network ---");
for (const x of net) P(x);
save("charge.txt", log.join("\n"));
await browser.close();
