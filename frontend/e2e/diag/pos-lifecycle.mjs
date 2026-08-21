// POS lifecycle run 3: table binding, send-with-retry, charge, split tender, discount, void, park.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-core";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const log = [], net = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const dump = () => writeFileSync(`${OUT}/run-3.log`, log.join("\n") + "\n\n=== NET ===\n" + net.join("\n"));
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); say("  shot:", n); };
const panel = p => p.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find(x => /Send to Kitchen|Clear \/ New Order|New Order/i.test(x.innerText));
  const r = b ? b.closest("div.w-80") : null; return r ? r.innerText : "(no panel)";
});
async function login(page, c) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (c.slug && await s.count()) await s.first().fill(c.slug);
  await page.locator('input[name="email"], input#email').first().fill(c.email);
  await page.locator('input[name="password"], input#password').first().fill(c.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(6000);
  return !page.url().includes("/login");
}
const toasts = p => p.evaluate(() => Array.from(document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')).map(e => e.innerText.trim()).filter(Boolean));

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => say("  ! pageerror:", String(e).slice(0, 200)));
  page.on("response", r => { const u = r.url(); if (u.includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${u.replace('http://localhost:8080','')}`); });
  if (!await login(page, CASHIER)) { say("LOGIN FAILED"); dump(); await browser.close(); return; }

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);

  // ---- pick a REAL table (not the "No table" first option)
  await page.locator('button', { hasText: /No table \(optional\)/ }).first().click(); await page.waitForTimeout(1500);
  const t1 = page.locator('[role="option"]', { hasText: /^T1/ }).first();
  say("T1 option present?", String(await t1.count()));
  if (await t1.count()) { await t1.click(); await page.waitForTimeout(1200); }
  const tableLabel = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find(x => /No table|T1|T2|G1|H1/.test(x.innerText) && x.closest("div.w-80"));
    return b ? b.innerText.trim() : null;
  });
  say("TABLE CONTROL NOW SHOWS:", JSON.stringify(tableLabel));
  // is there a COVER COUNT field anywhere?
  const covers = await page.evaluate(() => Array.from(document.querySelectorAll("input,label")).map(e => (e.placeholder||e.innerText||e.getAttribute("aria-label")||"").trim()).filter(t => /cover|guest|pax|party/i.test(t)));
  say("COVER-COUNT CONTROLS:", JSON.stringify(covers));
  // server assignment?
  const server = await page.evaluate(() => Array.from(document.querySelectorAll("button,input,select")).map(e => (e.innerText||e.placeholder||"").trim()).filter(t => /server|waiter|assign staff/i.test(t)));
  say("SERVER-ASSIGN CONTROLS:", JSON.stringify(server));

  // ---- build cart
  for (const name of ["Chicken Karahi", "Butter Naan"]) {
    await page.locator('[data-testid="menu-grid"] button', { hasText: name }).first().click(); await page.waitForTimeout(500);
  }
  await shot(page, "20-cart-with-table");
  say("PANEL:", (await panel(page)).replace(/\n/g, " | "));

  // ---- SEND with up to 3 retries (503 seen once)
  let sent = false;
  for (let i = 1; i <= 3 && !sent; i++) {
    const btn = page.locator("button", { hasText: /^Send to Kitchen$/ });
    if (!await btn.count()) { sent = true; break; }
    await btn.first().click(); await page.waitForTimeout(8000);
    const t = await toasts(page); say(`send attempt ${i} toasts:`, JSON.stringify(t));
    const still = await page.locator("button", { hasText: /^Send to Kitchen$/ }).count();
    const p = await panel(page);
    say(`send attempt ${i} -> panel: ${p.replace(/\n/g," | ").slice(0,400)}`);
    if (/Order #|ORD-|New Order|Sent to kitchen/i.test(p)) sent = true;
    if (!still) sent = true;
  }
  await shot(page, "21-after-send-retry");
  say("SENT?", String(sent));
  say("PANEL AFTER SEND:", (await panel(page)).slice(0, 1200));
  const postSendBtns = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find(x => /New Order|Send to Kitchen/i.test(x.innerText));
    const r = b ? b.closest("div.w-80") : null;
    return r ? Array.from(r.querySelectorAll("button")).map(x => (x.innerText||x.getAttribute("aria-label")||"").trim()) : null;
  });
  say("PANEL BUTTONS AFTER SEND:", JSON.stringify(postSendBtns));

  // ---- ORDER MANAGEMENT -> Open the newest order
  await page.locator("button,a", { hasText: /Order Management/ }).first().click(); await page.waitForTimeout(5000);
  await shot(page, "22-order-mgmt");
  const rows = await page.locator("table tbody tr").count(); say("ORDER ROWS:", String(rows));
  const openBtn = page.locator("button", { hasText: /^Open$/ }).first();
  if (await openBtn.count()) {
    await openBtn.click(); await page.waitForTimeout(4000);
    await shot(page, "23-order-detail-drawer");
    const d = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"]');
      if (!el) return null; const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: el.innerText.slice(0, 3000),
        buttons: Array.from(el.querySelectorAll("button")).map(b => (b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean) };
    });
    say("DRAWER:", JSON.stringify(d, null, 1));
  } else say("!! no Open button");

  dump();
  await browser.close();
}
main().catch(e => { console.error(e); log.push("FATAL " + e.stack); dump(); });
