/*
 * DIAGNOSIS — independent replication of the claimed silent fiscal-code wipe.
 * Edits ONLY the description of a throwaway "Audit Item" through the real UI and records the
 * outbound PUT body. The item's tax fields are restored by the caller afterwards.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/tax-config-verify";
const TARGET = "Audit Item 60568";
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const sent = [];
page.on("request", (r) => {
  if (r.method() === "PUT" && /\/pos\/menu\/items\//.test(r.url())) sent.push({ url: r.url(), body: r.postData() });
});

if (!(await login(page))) { console.log("FATAL login"); process.exit(1); }
console.log("signed in as OWNER");

await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5500);
if (page.url().includes("/login")) { await login(page); await page.goto(`${BASE}/app/menu/items`); await page.waitForTimeout(5500); }

await page.locator(`button[aria-label="Actions for ${TARGET}"]`).first().click();
await page.waitForTimeout(1000);
await page.getByRole("menuitem", { name: /^edit/i }).first().click();
await page.waitForTimeout(2200);

const dlg = page.locator('[role="dialog"]').first();
const desc = dlg.locator('[name="description"], #description').first();
await desc.fill("gap audit (description touched by verification pass)");
console.log("changed ONLY the description; saving…");
await dlg.getByRole("button", { name: /save|update|submit/i }).first().click();
await page.waitForTimeout(3500);

await page.screenshot({ path: `${OUT}/11-wipe-after-save.png` });
console.log("\nOUTBOUND PUT REQUESTS CAPTURED:");
for (const s of sent) console.log("  ", s.url, "\n   body:", s.body);
await browser.close();
