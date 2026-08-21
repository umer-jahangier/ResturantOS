/* DIAGNOSIS — does the vendor-invoice dialog let a user enter input sales tax (GST paid to a
 * supplier)? The FBR Tax Summary's "Input tax" figure is summed from that column. READ ONLY:
 * opens the dialog, reads it, escapes without saving. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/tax-config-verify";
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totp(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;return String((((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff))%1000000).padStart(6,"0");}
async function login(page){
  await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(1500);
  const s=page.locator('input[name="tenantSlug"], input#tenantSlug'); if(await s.count()) await s.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(3000);
  const t=page.locator('input[name="totpCode"], input#totpCode');
  if(await t.count()){await t.first().fill(totp(OWNER.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(4500);}
  return !page.url().includes("/login");
}
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

// TOTP codes straddle a 30s boundary and this stack is shared with other agents, so a single
// failed sign-in is noise, not a finding. Retry on a fresh code before believing it.
let signedIn = false;
for (let attempt = 1; attempt <= 4 && !signedIn; attempt++) {
  signedIn = await login(page);
  if (!signedIn) {
    const body = await page.locator("body").innerText().catch(() => "");
    console.log(`  login attempt ${attempt} failed; url=${page.url()}; page says: ${JSON.stringify(body.slice(0, 200))}`);
    await page.waitForTimeout(31000); // cross into the next TOTP window
  }
}
if (!signedIn) { console.log("FATAL login after 4 attempts"); await page.screenshot({ path: `${OUT}/LOGIN-FAILED.png` }); process.exit(1); }
console.log("signed in as OWNER");

for (let i = 0; i < 3; i++) {
  await page.goto(`${BASE}/app/purchasing/invoices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) { console.log("  [trap] bounce; re-auth"); await login(page); continue; }
  break;
}
const btns = await page.getByRole("button").allInnerTexts();
console.log("buttons on invoices page:", JSON.stringify(btns.slice(0, 20)));
const add = page.getByRole("button", { name: /book invoice|record invoice|new invoice/i }).first();
if (await add.count()) {
  await add.click();
  await page.waitForTimeout(2500);
  const dlg = page.locator('[role="dialog"]').first();
  if (await dlg.count()) {
    const box = await dlg.boundingBox();
    console.log(`dialog box = ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "null"}`);
    console.log("labels:", JSON.stringify(await dlg.locator("label").allInnerTexts()));
    console.log("fields:", JSON.stringify(await dlg.locator("input,select,textarea").evaluateAll((e)=>e.map(x=>x.getAttribute("name")||x.id))));
    const txt = await dlg.innerText();
    console.log("ANY input-tax / GST control?", /input tax|gst|sales tax|tax/i.test(txt));
    await page.screenshot({ path: `${OUT}/14-vendor-invoice-dialog.png` });
  } else console.log("NO DIALOG");
} else console.log("no create-invoice button found");
await browser.close();
