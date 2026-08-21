// Run 5: cash payment E2E + receipt, void dialog, and menu-management image upload (manager).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-core";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const log = [], net = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const dump = () => writeFileSync(`${OUT}/run-5.log`, log.join("\n") + "\n\n=== NET ===\n" + net.join("\n"));
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false }); say("  shot:", n); };
async function login(page, c) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (c.slug && await s.count()) await s.first().fill(c.slug);
  await page.locator('input[name="email"], input#email').first().fill(c.email);
  await page.locator('input[name="password"], input#password').first().fill(c.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(6000);
  return !page.url().includes("/login");
}
const wire = (page, tag) => {
  page.on("pageerror", e => say(`  ! [${tag}] pageerror:`, String(e).slice(0, 200)));
  page.on("response", r => { const u = r.url(); if (u.includes("/api/")) net.push(`[${tag}] ${r.status()} ${r.request().method()} ${u.replace('http://localhost:8080','')}`); });
};

async function main() {
  const browser = await chromium.launch();

  // ===== A. CASHIER: pay an order in cash, end to end =====
  const c1 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await c1.newPage(); wire(page, "cashier");
  if (!await login(page, CASHIER)) { say("CASHIER LOGIN FAILED"); }
  else {
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
    await page.locator('[data-testid="menu-grid"] button', { hasText: "Butter Naan" }).first().click();
    await page.waitForTimeout(600);
    await page.locator("button", { hasText: /^Charge Now$/ }).first().click();
    await page.waitForTimeout(9000);
    const chargeUrl = page.url(); say("CHARGE URL:", chargeUrl);
    // read the total, then pay it in full via the "Full amount" helper
    const before = await page.locator("body").innerText();
    say("BILL BEFORE:", (before.match(/Bill[\s\S]{0,400}/) || [""])[0].replace(/\n/g, " | "));
    const full = page.locator("button", { hasText: /Full amount/ }).first();
    if (await full.count()) { await full.click(); await page.waitForTimeout(1200); say("clicked Full amount"); }
    const amt = await page.locator('input[aria-label="Amount in paisa"]').first().inputValue().catch(()=>null);
    say("AMOUNT FIELD VALUE AFTER 'Full amount':", JSON.stringify(amt));
    await shot(page, "40-charge-prefilled");
    const rec = page.locator("button", { hasText: /Record Payment/ }).first();
    await rec.click(); await page.waitForTimeout(8000);
    await shot(page, "41-after-record-payment");
    const after = await page.locator("body").innerText();
    say("AFTER PAYMENT >>>\n" + after.slice(0, 2500) + "\n<<<");
    say("BUTTONS AFTER PAYMENT:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("button")).map(b=>(b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean))));
    // receipt?
    const rBtn = page.locator("button,a", { hasText: /Receipt|Print/i }).first();
    if (await rBtn.count()) { await rBtn.click(); await page.waitForTimeout(6000); await shot(page, "42-receipt"); say("RECEIPT URL:", page.url()); say("RECEIPT >>>\n" + (await page.locator("body").innerText()).slice(0,1800) + "\n<<<"); }
    else {
      const oid = chargeUrl.match(/orders\/([0-9a-f-]+)/)[1];
      await page.goto(`${BASE}/app/pos/orders/${oid}/receipt`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
      await shot(page, "42-receipt-direct");
      say("RECEIPT (direct nav) >>>\n" + (await page.locator("body").innerText()).slice(0,2000) + "\n<<<");
      say("RECEIPT BUTTONS:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("button,a")).map(b=>(b.innerText||"").trim()).filter(Boolean))));
    }

    // ---- VOID dialog on a live In-Progress order
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(5000);
    await page.locator("button,a", { hasText: /Order Management/ }).first().click(); await page.waitForTimeout(4500);
    const ip = page.locator("button", { hasText: /^In Progress$/ }).first();
    if (await ip.count()) { await ip.click(); await page.waitForTimeout(3500); }
    const openB = page.locator("button", { hasText: /^Open$/ }).first();
    if (await openB.count()) {
      await openB.click(); await page.waitForTimeout(4000);
      await shot(page, "43-drawer-in-progress");
      const vb = page.locator("button", { hasText: /^Void$/ }).first();
      if (await vb.count()) {
        await vb.click(); await page.waitForTimeout(2500);
        await shot(page, "44-void-dialog");
        const d = await page.evaluate(() => { const els=Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')); const el=els[els.length-1]; if(!el) return null; const r=el.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),text:el.innerText.slice(0,2000), fields:Array.from(el.querySelectorAll("input,select,textarea")).map(x=>({t:x.tagName,ph:x.placeholder||"",lbl:x.getAttribute("aria-label")||""})), buttons:Array.from(el.querySelectorAll("button")).map(b=>b.innerText.trim())}; });
        say("VOID DIALOG:", JSON.stringify(d, null, 1));
      } else say("!! NO Void button in drawer");
    } else say("!! no In-Progress order to open");
  }
  await c1.close();

  // ===== B. MANAGER: menu management — is there an image upload? =====
  const c2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p2 = await c2.newPage(); wire(p2, "manager");
  if (!await login(p2, MANAGER)) { say("MANAGER LOGIN FAILED"); }
  else {
    await p2.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" }); await p2.waitForTimeout(7000);
    await shot(p2, "50-menu-items");
    const t = await p2.locator("body").innerText();
    say("MENU ITEMS PAGE >>>\n" + t.slice(0, 2500) + "\n<<<");
    const imgs = await p2.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table img, [data-testid] img, img"));
      return { imgCount: rows.length, srcs: rows.map(i => (i.currentSrc||i.src||"").slice(0,140)).slice(0,12),
               naturalOk: rows.map(i => i.naturalWidth > 0).slice(0,12) };
    });
    say("MENU ADMIN IMAGES:", JSON.stringify(imgs, null, 1));
    say("MENU BUTTONS:", JSON.stringify(await p2.evaluate(() => Array.from(document.querySelectorAll("button")).map(b=>(b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean).slice(0,60))));
    // open the edit dialog on the first item
    const edit = p2.locator("button", { hasText: /^Edit$/i }).first();
    const target = (await edit.count()) ? edit : p2.locator("table tbody tr").first();
    await target.click(); await p2.waitForTimeout(3500);
    await shot(p2, "51-menu-item-dialog");
    const d = await p2.evaluate(() => {
      const el = document.querySelector('[role="dialog"]'); if (!el) return null; const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: el.innerText.slice(0, 2000),
        fileInputs: el.querySelectorAll('input[type="file"]').length,
        fields: Array.from(el.querySelectorAll("input,select,textarea")).map(x=>({t:x.type||x.tagName, ph:x.placeholder||"", lbl:x.getAttribute("aria-label")||"", name:x.name||"", id:x.id||""})),
        buttons: Array.from(el.querySelectorAll("button")).map(b=>b.innerText.trim()).filter(Boolean) };
    });
    say("MENU ITEM DIALOG:", JSON.stringify(d, null, 1));
    // also: any variant / modifier config?
    say("MENU PAGE MENTIONS:", JSON.stringify(await p2.evaluate(() => {
      const t = document.body.innerText; const has = re => re.test(t);
      return { variant: has(/variant|half|full size/i), modifier: has(/modifier|add-on|topping/i),
        combo: has(/combo|meal deal/i), channelPrice: has(/channel|delivery price|aggregator/i),
        allergen: has(/allergen|calorie|spice|halal|veg/i), schedule: has(/schedule|day.?part|happy hour/i),
        eightySix: has(/86|out of stock|unavailable/i), bulkImport: has(/import|csv|excel/i) };
    })));
  }
  await c2.close();
  dump(); await browser.close();
}
main().catch(e => { console.error(e); log.push("FATAL " + e.stack); dump(); });
