// Run 7: refund on a PAID order, reprint band, Assign Table (transfer), add-items-to-fired-order.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-core";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const log = [], net = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const dump = () => writeFileSync(`${OUT}/run-7.log`, log.join("\n") + "\n\n=== NET ===\n" + net.join("\n"));
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); say("  shot:", n); };
async function login(page, c) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (c.slug && await s.count()) await s.first().fill(c.slug);
  await page.locator('input[name="email"], input#email').first().fill(c.email);
  await page.locator('input[name="password"], input#password').first().fill(c.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(6000);
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => say("  !", String(e).slice(0, 160)));
  page.on("response", r => { const u = r.url(); if (u.includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${u.replace('http://localhost:8080','')}`); });
  if (!await login(page, CASHIER)) { say("LOGIN FAILED"); dump(); await browser.close(); return; }

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
  await page.locator("button,a", { hasText: /Order Management/ }).first().click(); await page.waitForTimeout(4500);

  // ---- A. PAID order -> refund path?
  const paid = page.locator("button", { hasText: /^Paid$/ }).first();
  if (await paid.count()) { await paid.click(); await page.waitForTimeout(3500); }
  await shot(page, "80-paid-filter");
  say("PAID rows:", String(await page.locator("table tbody tr").count()));
  say("PAID row buttons:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("table tbody button")).map(b=>(b.innerText||b.getAttribute("aria-label")||"").trim()))));
  const ob = page.locator("table tbody button", { hasText: /^Open$/ }).first();
  if (await ob.count()) {
    await ob.click(); await page.waitForTimeout(4000);
    await shot(page, "81-paid-order-drawer");
    const d = await page.evaluate(() => { const el=document.querySelector('[role="dialog"]'); if(!el) return null; const r=el.getBoundingClientRect();
      return {w:Math.round(r.width),h:Math.round(r.height),text:el.innerText.slice(0,2200),buttons:Array.from(el.querySelectorAll("button")).map(b=>b.innerText.trim()).filter(Boolean)}; });
    say("PAID ORDER DRAWER:", JSON.stringify(d, null, 1));
    const rf = page.locator('[role="dialog"] button', { hasText: /Refund/i }).first();
    if (await rf.count()) {
      await rf.click(); await page.waitForTimeout(2500); await shot(page, "82-refund-panel");
      say("REFUND PANEL:", JSON.stringify(await page.evaluate(() => { const p=document.querySelector('[data-testid="void-refund-panel"]'); return p? p.innerText.slice(0,1500):"(no void-refund-panel)"; })));
    } else say("!! NO Refund control on a PAID order drawer");
    await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
  }

  // ---- B. Add items to an already-fired order (partial send / hold-and-fire)
  const ip = page.locator("button", { hasText: /^In Progress$/ }).first();
  if (await ip.count()) { await ip.click(); await page.waitForTimeout(3500); }
  const ob2 = page.locator("table tbody button", { hasText: /^Open$/ }).first();
  if (await ob2.count()) {
    await ob2.click(); await page.waitForTimeout(4000);
    const qa = page.locator('[role="dialog"] input[placeholder*="Search menu"]').first();
    if (await qa.count()) {
      await qa.fill("Naan"); await page.waitForTimeout(2000);
      await shot(page, "83-quick-add");
      say("QUICK ADD results:", JSON.stringify(await page.evaluate(() => { const el=document.querySelector('[role="dialog"]'); return el? el.innerText.slice(0,1200):null; })));
      const res = page.locator('[role="dialog"] button', { hasText: /Butter Naan/ }).first();
      if (await res.count()) {
        await res.click(); await page.waitForTimeout(5000);
        await shot(page, "84-after-quick-add");
        const after = await page.evaluate(() => { const el=document.querySelector('[role="dialog"]'); return el? el.innerText.slice(0,2000):null; });
        say("DRAWER AFTER QUICK ADD:", JSON.stringify(after));
        say("toasts:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[data-sonner-toast]')).map(e=>e.innerText))));
        // is there a "send new items" control?
        say("SEND-NEW-ITEMS control?", JSON.stringify(await page.evaluate(() => { const el=document.querySelector('[role="dialog"]'); return el? Array.from(el.querySelectorAll("button")).map(b=>b.innerText.trim()).filter(Boolean):null; })));
      }
    } else say("!! no Quick Add search in drawer");
    await page.keyboard.press("Escape"); await page.waitForTimeout(1200);
  }

  // ---- C. Assign Table (transfer a check between tables)
  await page.locator("button", { hasText: /^All$/ }).first().click(); await page.waitForTimeout(3000);
  const at = page.locator("table tbody button", { hasText: /Assign Table/ }).first();
  if (await at.count()) {
    await at.click(); await page.waitForTimeout(2500);
    await shot(page, "85-assign-table");
    const d = await page.evaluate(() => { const els=Array.from(document.querySelectorAll('[role="dialog"]')); const el=els[els.length-1]; if(!el) return null; const r=el.getBoundingClientRect();
      return {w:Math.round(r.width),h:Math.round(r.height),text:el.innerText.slice(0,1200),buttons:Array.from(el.querySelectorAll("button")).map(b=>b.innerText.trim()).filter(Boolean)}; });
    say("ASSIGN TABLE DIALOG:", JSON.stringify(d, null, 1));
    await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
  } else say("!! no Assign Table button");

  // ---- D. Receipt reprint band
  await page.goto(`${BASE}/app/pos/orders/dd304880-022c-4bcf-a343-6741a34c2bbb/receipt`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await shot(page, "86-receipt-1st");
  say("RECEIPT#1 has band?", JSON.stringify(await page.locator('[data-testid="reprint-band"]').count()));
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
  say("RECEIPT#2 has band?", JSON.stringify(await page.locator('[data-testid="reprint-band"]').count()));
  say("RECEIPT page buttons:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("button,a")).map(b=>(b.innerText||"").trim()).filter(Boolean).slice(0,25))));
  await shot(page, "87-receipt-2nd");

  // ---- E. Floor view detail
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(5000);
  await page.locator("button,a", { hasText: /Floor View/ }).first().click(); await page.waitForTimeout(5000);
  await shot(page, "88-floor-view");
  say("FLOOR VIEW:", (await page.locator("main").innerText().catch(()=>page.locator("body").innerText())).slice(0,1500).replace(/\n/g," | "));
  say("FLOOR BUTTONS:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("button")).map(b=>(b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean).slice(0,40))));

  dump(); await browser.close();
}
main().catch(e => { console.error(e); log.push("FATAL " + e.stack); dump(); });
