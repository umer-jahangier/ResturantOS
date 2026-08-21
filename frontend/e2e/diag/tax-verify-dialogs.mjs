/*
 * DIAGNOSIS ONLY. Verification pass 2: menu-item dialogs (create + edit), the rendered receipt,
 * and the POS charge screen — the three surfaces where a tax control would have to live.
 * Non-destructive: opens dialogs and reads them, cancels without saving.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/tax-config-verify";
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/verify-log-2.txt`;
writeFileSync(LOG, `dialogs+receipt ${new Date().toISOString()}\n`);
const log = (...a) => { const s = a.join(" "); console.log(s); appendFileSync(LOG, s + "\n"); };

const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function base32Decode(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",base32Decode(s)).update(b).digest();const o=h[h.length-1]&0x0f;return String((((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff))%1000000).padStart(6,"0");}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) { await t.first().fill(totpNow(OWNER.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(4500); }
  return !page.url().includes("/login");
}
async function go(page, route, settle = 5000) {
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(settle);
    if (page.url().includes("/login")) { log(`  [trap] bounce on ${route}, re-auth`); await login(page); continue; }
    return await page.locator("body").innerText().catch(() => "");
  }
  return "";
}
async function describeDialog(page, tag) {
  const dlg = page.locator('[role="dialog"]').first();
  if (!(await dlg.count())) { log(`  ${tag}: NO DIALOG`); return null; }
  const box = await dlg.boundingBox();
  const labels = await dlg.locator("label").allInnerTexts();
  const fields = await dlg.locator("input,select,textarea").evaluateAll((els) => els.map((e) => e.getAttribute("name") || e.id || e.getAttribute("placeholder")));
  const text = await dlg.innerText();
  log(`  ${tag}: box=${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "null"}`);
  log(`  ${tag}: labels=${JSON.stringify(labels)}`);
  log(`  ${tag}: fields=${JSON.stringify(fields)}`);
  log(`  ${tag}: TAX CONTROL PRESENT? ${/tax|gst|vat|service charge/i.test(text)}`);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
  return { labels, fields };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  if (!(await login(page))) { log("FATAL login"); process.exit(1); }
  log("signed in as OWNER");

  // ---- menu items: EDIT dialog ---------------------------------------------------------------
  await go(page, "/app/menu/items");
  log("\n[A] MENU ITEM EDIT DIALOG");
  const trig = page.locator('button[aria-label^="Actions for"]');
  const n = await trig.count();
  log(`  action triggers found: ${n}`);
  if (n) {
    // pick a trigger for an ITEM (categories also have them); take the last, items render under categories
    const labels = await trig.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    log(`  triggers: ${JSON.stringify(labels.slice(0, 14))}`);
    const idx = labels.findIndex((l) => /Karahi|Naan|Samosa|Lime|Audit Item/i.test(l));
    const pick = idx >= 0 ? idx : n - 1;
    log(`  opening: ${labels[pick]}`);
    await trig.nth(pick).click();
    await page.waitForTimeout(1000);
    const edit = page.getByRole("menuitem", { name: /^edit/i }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(2200);
      await describeDialog(page, "07-menu-item-EDIT-dialog");
      await page.keyboard.press("Escape"); await page.waitForTimeout(800);
    } else {
      const items = await page.getByRole("menuitem").allInnerTexts();
      log(`  no Edit; menuitems = ${JSON.stringify(items)}`);
    }
  }

  // ---- menu items: CREATE dialog --------------------------------------------------------------
  log("\n[B] MENU ITEM CREATE DIALOG");
  const add = page.getByRole("button", { name: /add item|new item|add menu item/i }).first();
  if (await add.count()) {
    await add.click(); await page.waitForTimeout(2200);
    await describeDialog(page, "08-menu-item-CREATE-dialog");
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  } else {
    const btns = await page.getByRole("button").allInnerTexts();
    log(`  no add button; buttons = ${JSON.stringify(btns.slice(0, 25))}`);
  }

  // ---- receipt ---------------------------------------------------------------------------------
  log("\n[C] RECEIPT RENDER");
  const orderId = process.env.ORDER_ID;
  if (orderId) {
    const body = await go(page, `/app/pos/orders/${orderId}/receipt`, 6000);
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const taxish = lines.filter((l) => /tax|gst|vat|service|charge|OTHER|subtotal|total/i.test(l));
    log(`  receipt tax/total lines: ${JSON.stringify(taxish)}`);
    log(`  literal "[OTHER]" present? ${/\[OTHER\]/.test(body)}`);
    log(`  bare "OTHER" token present? ${/\bOTHER\b/.test(body)}`);
    await page.screenshot({ path: `${OUT}/09-receipt.png`, fullPage: true });
    log("  shot -> 09-receipt.png");
  } else log("  ORDER_ID not supplied");

  await browser.close();
  log("\nDONE");
}
main();
