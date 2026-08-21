/*
 * DIAGNOSIS stage 8 — the fair test of "does Settings follow the switched branch?"
 * Must use CLIENT-SIDE navigation (sidebar click), because a full page load is already known to
 * reset the branch to the user's primary. Re-grants the owner a Rooftop role via the UI, tests,
 * and the caller reverts afterwards.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/branches-users";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;const k=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(k%1000000).padStart(6,"0");}
const log=[]; const rec=(k,v)=>{log.push({k,v});console.log(`[${k}]`,typeof v==="string"?v.slice(0,700):JSON.stringify(v).slice(0,800));};
const shot=async(p,n)=>{await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});};

async function login(page){
  await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(1800);
  const s=page.locator('input[name="tenantSlug"], input#tenantSlug'); if(await s.count()) await s.first().fill(OWNER.slug);
  await page.locator('input#email, input[name="email"]').first().fill(OWNER.email);
  await page.locator('input#password, input[name="password"]').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(3500);
  const t=page.locator('input[name="totpCode"], input#totpCode');
  if(await t.count()){await t.first().fill(totpNow(OWNER.totpSecret));await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(6000);}
  return !page.url().includes("/login");
}

async function main(){
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1500,height:1050}});
  const page=await ctx.newPage();
  if(!(await login(page))){rec("FATAL","login");await browser.close();return;}

  // grant owner a role at Rooftop through the UI so the switcher exists
  await page.goto(`${BASE}/app/users`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(7000);
  await page.locator("button").filter({hasText:"owner@terrace.local"}).first().click();
  await page.waitForTimeout(3500);
  await page.locator('button:has-text("Assign role")').first().click(); await page.waitForTimeout(2200);
  const dlg=page.locator('[role="dialog"]').first();
  const sels=dlg.locator("select");
  await sels.nth(0).selectOption({label:"Floating Terrace — Rooftop"});
  await sels.nth(1).selectOption({label:"Owner"});
  await page.waitForTimeout(1000);
  const radios=dlg.locator('input[type="radio"], [role="radio"]');
  if(await radios.count()) await radios.first().click({force:true});
  await page.waitForTimeout(800);
  const num=dlg.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
  if(await num.count()) await num.first().fill("1000000");
  await page.waitForTimeout(600);
  const submit=dlg.locator('button:has-text("Assign role")').last();
  if(await submit.isEnabled()){ await submit.click(); await page.waitForTimeout(4000); rec("granted","owner now has a Rooftop role"); }
  else rec("granted","SUBMIT STILL DISABLED");

  await ctx.close();

  // fresh session, then CLIENT-SIDE nav only
  const ctx2=await browser.newContext({viewport:{width:1500,height:1050}});
  const p2=await ctx2.newPage();
  await login(p2);
  await p2.goto(`${BASE}/app/dashboard`,{waitUntil:"domcontentloaded"}); await p2.waitForTimeout(7500);
  const sw=p2.locator('[aria-label="Switch branch"]');
  rec("owner-switcher-present", await sw.count());
  if(await sw.count()){
    await sw.first().click(); await p2.waitForTimeout(1500);
    await p2.locator('[role="menuitem"]:has-text("Rooftop")').first().click();
    await p2.waitForTimeout(9000);
    rec("label-after-switch", await sw.first().innerText());
    // CLIENT-SIDE navigation to Settings via the sidebar
    await p2.locator('a[href="/app/settings"]').first().click();
    await p2.waitForTimeout(8000);
    const vals=await p2.locator("input").evaluateAll((els)=>els.map((e)=>({name:e.getAttribute("name"),value:e.value})));
    rec("settings-values-after-CLIENTSIDE-switch", vals);
    rec("label-on-settings", await p2.locator('[aria-label="Switch branch"]').first().innerText().catch(()=>"(gone)"));
    await shot(p2,"90-settings-after-clientside-switch");
    // now F5 on the settings screen
    await p2.reload({waitUntil:"domcontentloaded"}); await p2.waitForTimeout(8000);
    const vals2=await p2.locator("input").evaluateAll((els)=>els.map((e)=>({name:e.getAttribute("name"),value:e.value})));
    rec("settings-values-after-F5", vals2);
    rec("label-after-F5", await p2.locator('[aria-label="Switch branch"]').first().innerText().catch(()=>"(gone)"));
    await shot(p2,"91-settings-after-F5");
  }
  await ctx2.close();
  writeFileSync(`${OUT}/transcript-8.json`,JSON.stringify(log,null,2));
  await browser.close();
}
main();
