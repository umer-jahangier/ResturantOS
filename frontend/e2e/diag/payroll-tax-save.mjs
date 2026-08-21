/*
 * DIAGNOSIS ONLY — (c) can an owner actually SAVE a payroll income-tax table from the screen?
 *
 * Targets FY2028, deliberately NOT the current payroll year (FY2027), so this probe cannot
 * change what payroll would do today for any other audit running against the same stack.
 *
 * Run: node e2e/diag/payroll-tax-save.mjs
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

async function main(){
  mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1440,height:1200}})).newPage();
  const wire=[];
  page.on("request",r=>{ if(["POST","PUT","PATCH"].includes(r.method())&&/hr\/config\/tax/.test(r.url())) wire.push({m:r.method(),u:r.url(),b:r.postData()}); });
  page.on("response",async r=>{ if(/hr\/config\/tax/.test(r.url())&&r.request().method()!=="GET") console.log("  response",r.status(),r.url(),(await r.text().catch(()=>"")).slice(0,300)); });

  if(!(await login(page))){console.log("LOGIN FAILED");await browser.close();process.exit(1);}
  await page.goto(`${BASE}/app/hr/settings/tax`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(7000);
  if(page.url().includes("/login")){await login(page);await page.goto(`${BASE}/app/hr/settings/tax`);await page.waitForTimeout(7000);}

  // Pick FY2028 — NOT the live payroll year.
  const sel=page.locator("select").first();
  console.log("fiscal-year options:",JSON.stringify(await sel.locator("option").allInnerTexts()));
  await sel.selectOption({label:"FY2028"}).catch(async()=>{ await sel.selectOption("2028"); });
  await page.waitForTimeout(3000);
  console.log("selected FY2028");

  // Fill a minimal, legal two-band table: 0–600,000 @ 0%; above 600,000 @ 5%.
  const set=async(label,val)=>{const l=page.locator(`input[aria-label="${label}"], input[name="${label}"]`).first();
    if(await l.count()){await l.fill(val);return true;} return false;};

  console.log("effective-from filled:", await set("Effective from","2027-07-01"));
  console.log("band1 from filled:  ", await set("Band 1 starts at","0"));
  console.log("band1 upto filled:  ", await set("Band 1 ends at","600000"));
  console.log("band1 fixed filled: ", await set("Band 1 fixed tax","0"));
  console.log("band1 rate filled:  ", await set("Band 1 rate","0"));

  await page.locator('button:has-text("Add band")').first().click();
  await page.waitForTimeout(1200);
  console.log("band2 from filled:  ", await set("Band 2 starts at","600000"));
  console.log("band2 upto (blank = top band)");
  console.log("band2 fixed filled: ", await set("Band 2 fixed tax","0"));
  console.log("band2 rate filled:  ", await set("Band 2 rate","5"));
  console.log("eobi employer:      ", await set("EOBI employer %","5"));
  console.log("eobi employee:      ", await set("EOBI employee %","1"));

  const inForce=page.locator('input[type="checkbox"]').first();
  if(await inForce.count()){ await inForce.check().catch(()=>{}); console.log("ticked In force"); }

  await page.screenshot({path:`${OUT}/payroll-tax-filled.png`,fullPage:true});

  const saveBtn=page.locator('button:has-text("Save"), button[type="submit"]').last();
  console.log("save button text:",(await saveBtn.innerText().catch(()=>"?")));
  await saveBtn.click();
  await page.waitForTimeout(6000);
  await page.screenshot({path:`${OUT}/payroll-tax-after-save.png`,fullPage:true});

  console.log("write requests sent:",JSON.stringify(wire,null,1).slice(0,1500));
  const alerts=await page.locator('[role="alert"]').allInnerTexts();
  console.log("alerts after save:",JSON.stringify(alerts.filter(a=>a.trim())));
  const body=await page.locator("body").innerText();
  console.log("page says:",body.split("\n").filter(l=>/saved|error|force|cannot|invalid|band/i.test(l)).slice(0,12).join(" | "));
  await browser.close();
}
main();
