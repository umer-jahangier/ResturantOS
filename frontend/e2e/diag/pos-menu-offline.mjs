// Run 6: menu-item image upload control (manager) + POS offline behaviour + order search.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/pos-core";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const log = [], net = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const dump = () => writeFileSync(`${OUT}/run-6.log`, log.join("\n") + "\n\n=== NET ===\n" + net.join("\n"));
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
const wire = (page, tag) => {
  page.on("pageerror", e => say(`  ! [${tag}]`, String(e).slice(0, 160)));
  page.on("response", r => { const u = r.url(); if (u.includes("/api/")) net.push(`[${tag}] ${r.status()} ${r.request().method()} ${u.replace('http://localhost:8080','')}`); });
};

async function main() {
  const browser = await chromium.launch();

  // ===== MANAGER: menu item edit dialog =====
  const c2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p2 = await c2.newPage(); wire(p2, "mgr");
  if (await login(p2, MANAGER)) {
    await p2.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" }); await p2.waitForTimeout(8000);
    await shot(p2, "60-menu-items-admin");
    const imgs = await p2.evaluate(() => Array.from(document.querySelectorAll("img")).map(i => ({ src: (i.currentSrc||i.src||"").slice(0,80), alt: i.alt, nat: i.naturalWidth })));
    const ph = await p2.locator('[data-testid="menu-item-image-placeholder"]').count();
    const err = await p2.locator('[data-testid="menu-item-image-error"]').count();
    say("MENU ADMIN: real <img>=", JSON.stringify(imgs), " placeholders=", String(ph), " errors=", String(err));
    // open the ⋯ menu on Photo Dish then Edit
    const kebab = p2.locator('button[aria-label^="Actions for Photo Dish"]').first();
    if (await kebab.count()) {
      await kebab.click(); await p2.waitForTimeout(1200);
      await p2.locator('[role="menuitem"]', { hasText: /^Edit$/ }).first().click(); await p2.waitForTimeout(3000);
      await shot(p2, "61-menu-item-edit-dialog");
      const d = await p2.evaluate(() => {
        const el = document.querySelector('[role="dialog"]'); if (!el) return null; const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), text: el.innerText.slice(0, 1500),
          fileInputs: el.querySelectorAll('input[type="file"]').length,
          fields: Array.from(el.querySelectorAll("input,select,textarea")).map(x => ({ t: x.type||x.tagName, ph: x.placeholder||"", lbl: x.getAttribute("aria-label")||"", id: x.id||"" })),
          buttons: Array.from(el.querySelectorAll("button")).map(b => b.innerText.trim()).filter(Boolean) };
      });
      say("MENU ITEM EDIT DIALOG:", JSON.stringify(d, null, 1));
    } else say("!! no kebab for Photo Dish");
  } else say("MANAGER LOGIN FAILED");
  await c2.close();

  // ===== CASHIER: offline behaviour =====
  const c1 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await c1.newPage(); wire(page, "cash");
  if (await login(page, CASHIER)) {
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(8000);
    say("ONLINE: menu tiles =", String(await page.locator('[data-testid="menu-grid"] > div').count()));
    // go offline
    await c1.setOffline(true);
    await page.waitForTimeout(2500);
    await shot(page, "70-offline-banner");
    const banner = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="offline-banner"],[data-testid="online-reconnected-banner"]');
      return b ? b.innerText : (/offline/i.test(document.body.innerText) ? "(text mentions offline)" : null);
    });
    say("OFFLINE BANNER:", JSON.stringify(banner));
    // can I still build & send an order offline?
    const tileCount = await page.locator('[data-testid="menu-grid"] > div').count();
    say("OFFLINE: menu tiles still rendered =", String(tileCount));
    if (tileCount) {
      await page.locator('[data-testid="menu-grid"] button', { hasText: "Butter Naan" }).first().click();
      await page.waitForTimeout(800);
      await page.locator("button", { hasText: /^Send to Kitchen$/ }).first().click();
      await page.waitForTimeout(8000);
      await shot(page, "71-offline-send-attempt");
      say("OFFLINE toasts:", JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[data-sonner-toast]')).map(e=>e.innerText))));
      say("OFFLINE panel:", (await page.evaluate(() => { const b=Array.from(document.querySelectorAll("button")).find(x=>/Send to Kitchen|New Order/i.test(x.innerText)); const r=b?b.closest("div.w-80"):null; return r?r.innerText:"(none)"; })).replace(/\n/g," | ").slice(0,600));
    }
    // hard reload while offline — does the app survive?
    await page.reload({ waitUntil: "domcontentloaded" }).catch(e => say("OFFLINE RELOAD threw:", String(e).slice(0,120)));
    await page.waitForTimeout(6000);
    await shot(page, "72-offline-after-reload");
    say("OFFLINE AFTER RELOAD body:", (await page.locator("body").innerText().catch(()=>"(no body)")).slice(0, 700).replace(/\n/g," | "));
    // back online
    await c1.setOffline(false); await page.waitForTimeout(6000);
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(7000);
    await shot(page, "73-back-online");
    say("BACK ONLINE panel:", (await page.evaluate(() => { const b=Array.from(document.querySelectorAll("button")).find(x=>/Send to Kitchen|New Order/i.test(x.innerText)); const r=b?b.closest("div.w-80"):null; return r?r.innerText:"(none)"; })).replace(/\n/g," | ").slice(0,600));

    // ===== order search — can a closed order be found? =====
    await page.locator("button,a", { hasText: /Order Management/ }).first().click(); await page.waitForTimeout(4500);
    for (const f of ["All", "Closed", "Paid"]) {
      const b = page.locator("button", { hasText: new RegExp(`^${f}$`) }).first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(3000);
        const rows = await page.locator("table tbody tr").count();
        say(`FILTER ${f}: rows=${rows}`); }
    }
    const si = page.locator('input[placeholder*="Search order"]').first();
    if (await si.count()) {
      await si.fill("ORD-20260812-0011"); await page.waitForTimeout(2500);
      say("SEARCH 'ORD-20260812-0011' rows:", String(await page.locator("table tbody tr").count()));
      await si.fill("0300"); await page.waitForTimeout(2000);
      say("SEARCH by phone '0300' rows:", String(await page.locator("table tbody tr").count()));
      await shot(page, "74-order-search");
    }
  } else say("CASHIER LOGIN FAILED");
  await c1.close();
  dump(); await browser.close();
}
main().catch(e => { console.error(e); log.push("FATAL " + e.stack); dump(); });
