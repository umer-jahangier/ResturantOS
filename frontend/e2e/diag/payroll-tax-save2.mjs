/*
 * DIAGNOSIS ONLY — (c) can an owner SAVE a payroll income-tax table from the screen?
 * Targets FY2028, not the live payroll year FY2027.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/tax-config");
const BASE = "http://localhost:3000";
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
function base32Decode(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",base32Decode(s)).update(b).digest();const o=h[h.length-1]&0x0f;const code=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(code%1000000).padStart(6,"0");}
async function login(page){await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(1500);const s=page.locator('input[name="tenantSlug"], input#tenantSlug');if(await s.count())await s.first().fill(OWNER.slug);await page.locator('input[name="email"], input#email').first().fill(OWNER.email);await page.locator('input[name="password"], input#password').first().fill(OWNER.password);await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(3000);const t=page.locator('input[name="totpCode"], input#totpCode');if(await t.count()){await t.first().fill(totpNow(OWNER.totpSecret));await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(4500);}return !page.url().includes("/login");}

const browser=await chromium.launch();
const page=await (await browser.newContext({viewport:{width:1440,height:1300}})).newPage();
const wire=[];
page.on("request",r=>{if(r.method()!=="GET"&&/hr\/config\/tax/.test(r.url()))wire.push({m:r.method(),u:r.url(),b:r.postData()});});
page.on("response",async r=>{if(/hr\/config\/tax/.test(r.url())&&r.request().method()!=="GET")console.log("  RESPONSE",r.status(),(await r.text().catch(()=>"")).slice(0,400));});
mkdirSync(OUT,{recursive:true});

await login(page);
await page.goto(`${BASE}/app/hr/settings/tax`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(7000);
if(page.url().includes("/login")){await login(page);await page.goto(`${BASE}/app/hr/settings/tax`);await page.waitForTimeout(7000);}

await page.locator("select").first().selectOption({label:"FY2028"});
await page.waitForTimeout(3500);
console.log("selected FY2028; effectiveFrom now =",await page.locator('input[name="effectiveFrom"]').inputValue());

const fill=async(n,v)=>{const l=page.locator(`input[name="${n}"]`);if(await l.count()){await l.first().fill(v);return true;}return false;};
console.log("effectiveFrom:",await fill("effectiveFrom","2027-07-01"));
console.log("effectiveTo:  ",await fill("effectiveTo","2028-06-30"));
console.log("slab0 min:    ",await fill("slabs.0.minRupees","0"));
console.log("slab0 max:    ",await fill("slabs.0.maxRupees","600000"));
console.log("slab0 base:   ",await fill("slabs.0.baseTaxRupees","0"));
console.log("slab0 rate:   ",await fill("slabs.0.ratePct","0"));
await page.locator('button:has-text("Add band")').first().click();
await page.waitForTimeout(1500);
console.log("slab1 min:    ",await fill("slabs.1.minRupees","600000"));
console.log("slab1 base:   ",await fill("slabs.1.baseTaxRupees","0"));
console.log("slab1 rate:   ",await fill("slabs.1.ratePct","5"));
console.log("eobi er:      ",await fill("eobiEmployerRatePct","5"));
console.log("eobi ee:      ",await fill("eobiEmployeeRatePct","1"));
const cb=page.locator('input[type="checkbox"]').first();
if(await cb.count()){await cb.check().catch(()=>{});console.log("ticked In force");}

await page.screenshot({path:`${OUT}/payroll-tax-filled.png`,fullPage:true});
const save=page.locator('button[type="submit"]').last();
console.log("save text:",await save.innerText(),"disabled:",await save.isDisabled());
if(!(await save.isDisabled())){
  await save.click();
  await page.waitForTimeout(7000);
}
await page.screenshot({path:`${OUT}/payroll-tax-after-save.png`,fullPage:true});
console.log("write requests:",JSON.stringify(wire,null,1).slice(0,1200));
const body=await page.locator("body").innerText();
console.log("page signals:",body.split("\n").filter(l=>/saved|in force|cannot|error|invalid|must/i.test(l)).slice(0,10).join(" | "));
await browser.close();
