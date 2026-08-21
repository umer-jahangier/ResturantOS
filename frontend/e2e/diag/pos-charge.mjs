// Run 4: charge surface — tenders, split, discount, service charge, tip, void, park/recall, search.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-core";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const log = [], net = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const dump = () => writeFileSync(`${OUT}/run-4.log`, log.join("\n") + "\n\n=== NET ===\n" + net.join("\n"));
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
const allBtns = p => p.evaluate(() => Array.from(document.querySelectorAll("button")).map(b=>(b.innerText||b.getAttribute("aria-label")||"").trim()).filter(Boolean));
const allInputs = p => p.evaluate(() => Array.from(document.querySelectorAll("input,select,textarea")).map(e=>({t:e.type||e.tagName,ph:e.placeholder||"",lbl:e.getAttribute("aria-label")||"",name:e.name||"",id:e.id||""})));

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => say("  ! pageerror:", String(e).slice(0, 200)));
  page.on("response", r => { const u = r.url(); if (u.includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${u.replace('http://localhost:8080','')}`); });
  if (!await login(page, CASHIER)) { say("LOGIN FAILED"); dump(); await browser.close(); return; }

  // Build + send a fresh order so we own one to charge
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
  for (const n of ["Seekh Kebab", "Fresh Lime"]) {
    await page.locator('[data-testid="menu-grid"] button', { hasText: n }).first().click(); await page.waitForTimeout(400);
  }
  await page.locator("button", { hasText: /^Charge Now$/ }).first().click();
  await page.waitForTimeout(9000);
  say("URL after Charge Now:", page.url());
  await shot(page, "30-charge-page");
  const txt = await page.locator("body").innerText();
  say("CHARGE PAGE >>>\n" + txt.slice(0, 3500) + "\n<<<");
  say("CHARGE BUTTONS:", JSON.stringify(await allBtns(page)));
  say("CHARGE INPUTS:", JSON.stringify(await allInputs(page)));

  // probe for: split, discount, tip, service charge, partial
  const probe = await page.evaluate(() => {
    const t = document.body.innerText;
    const has = re => re.test(t);
    return {
      split: has(/split/i), discount: has(/discount/i), tip: has(/tip/i),
      serviceCharge: has(/service charge/i), partial: has(/partial|balance due/i),
      rounding: has(/round/i), houseAccount: has(/house account|credit sale/i),
      giftCard: has(/gift ?card|voucher/i), wallet: has(/jazzcash|easypaisa|raast|sadapay|nayapay/i),
      qr: has(/\bqr\b/i), card: has(/card/i), cash: has(/cash/i),
    };
  });
  say("CHARGE FEATURE PROBE:", JSON.stringify(probe));

  // Try clicking a tender to see the tender surface
  for (const label of ["Cash", "Card", "Split", "Discount"]) {
    const b = page.locator("button", { hasText: new RegExp(`^${label}`, "i") }).first();
    if (await b.count()) {
      await b.click(); await page.waitForTimeout(2500);
      await shot(page, `31-tender-${label.toLowerCase()}`);
      const d = await page.evaluate(() => { const el=document.querySelector('[role="dialog"]'); if(!el) return null; const r=el.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),text:el.innerText.slice(0,1500)}; });
      say(`TENDER ${label} dialog:`, JSON.stringify(d));
      say(`TENDER ${label} body:`, (await page.locator("body").innerText()).slice(0, 1800).replace(/\n/g," | "));
      await page.keyboard.press("Escape").catch(()=>{});
      await page.waitForTimeout(600);
    } else say(`NO "${label}" control on charge page`);
  }

  // ---- Park & recall: Save as Draft then find under Draft filter
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000);
  await page.locator('[data-testid="menu-grid"] button', { hasText: "Pinacolada" }).first().click(); await page.waitForTimeout(500);
  await page.locator("button", { hasText: /^Save as Draft$/ }).first().click(); await page.waitForTimeout(6000);
  say("PARK toasts:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[data-sonner-toast]')).map(e=>e.innerText))));
  await shot(page, "32-parked");
  await page.locator("button,a", { hasText: /Order Management/ }).first().click(); await page.waitForTimeout(4000);
  const draftTab = page.locator("button", { hasText: /^Draft$/ }).first();
  if (await draftTab.count()) { await draftTab.click(); await page.waitForTimeout(4000); }
  await shot(page, "33-draft-filter");
  say("DRAFT LIST >>>\n" + (await page.locator("main").innerText().catch(()=>page.locator("body").innerText())).slice(0,2000) + "\n<<<");

  // ---- Order search: is there ANY search box on order management?
  const searchOnOm = await page.evaluate(() => Array.from(document.querySelectorAll("input")).map(i=>i.placeholder||i.getAttribute("aria-label")||"").filter(Boolean));
  say("ORDER MGMT INPUTS:", JSON.stringify(searchOnOm));

  // ---- Void with reason: open an order, press Void
  const openB = page.locator("button", { hasText: /^Open$/ }).first();
  if (await openB.count()) {
    await openB.click(); await page.waitForTimeout(3500);
    const voidB = page.locator("button", { hasText: /^Void$/ }).first();
    if (await voidB.count()) {
      await voidB.click(); await page.waitForTimeout(2500);
      await shot(page, "34-void-dialog");
      const d = await page.evaluate(() => { const els=Array.from(document.querySelectorAll('[role="dialog"]')); const el=els[els.length-1]; if(!el) return null; const r=el.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),text:el.innerText.slice(0,1500), inputs:Array.from(el.querySelectorAll("input,select,textarea")).map(x=>x.placeholder||x.name||x.tagName), buttons:Array.from(el.querySelectorAll("button")).map(b=>b.innerText.trim())}; });
      say("VOID DIALOG:", JSON.stringify(d, null, 1));
    } else say("NO Void button in drawer");
  }
  dump(); await browser.close();
}
main().catch(e => { console.error(e); log.push("FATAL " + e.stack); dump(); });
