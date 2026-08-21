/* DIAGNOSIS ONLY — dump the customer-visible receipt rows (label + amount) for one order. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/tax-config-verify";
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totp(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;return String((((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff))%1000000).padStart(6,"0");}

const page_login = async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) { await t.first().fill(totp(OWNER.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(4500); }
  return !page.url().includes("/login");
};

const ORDERS = process.env.ORDER_IDS.split(",");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const page = await ctx.newPage();
if (!(await page_login(page))) { console.log("FATAL login"); process.exit(1); }

for (const id of ORDERS) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/app/pos/orders/${id}/receipt`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5500);
    if (page.url().includes("/login")) { await page_login(page); continue; }
    const rows = await page.locator(".receipt-row").evaluateAll((els) =>
      els.map((e) => {
        const l = e.querySelector(".receipt-row-label");
        const a = e.querySelector(".receipt-amount");
        return `${l ? l.textContent.trim() : "?"}  ==  ${a ? a.textContent.trim() : "?"}`;
      }));
    if (!rows.length) { console.log(`  ${id}: no .receipt-row (attempt ${attempt})`); continue; }
    console.log(`\nORDER ${id}`);
    rows.forEach((r) => console.log("   ", r));
    const fiscal = await page.locator('[aria-label="FBR fiscal information"]').count();
    console.log(`    FBR fiscal region rendered? ${fiscal > 0}`);
    await page.screenshot({ path: `${OUT}/10-receipt-${id.slice(0, 8)}.png`, fullPage: true });
    break;
  }
}
await browser.close();
