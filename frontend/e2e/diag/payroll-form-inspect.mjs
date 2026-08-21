/* DIAGNOSIS ONLY — dump the real input attributes on the HR Tax & EOBI form. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";

const BASE = "http://localhost:3000";
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
function base32Decode(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",base32Decode(s)).update(b).digest();const o=h[h.length-1]&0x0f;const code=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(code%1000000).padStart(6,"0");}
async function login(page){await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(1500);const s=page.locator('input[name="tenantSlug"], input#tenantSlug');if(await s.count())await s.first().fill(OWNER.slug);await page.locator('input[name="email"], input#email').first().fill(OWNER.email);await page.locator('input[name="password"], input#password').first().fill(OWNER.password);await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(3000);const t=page.locator('input[name="totpCode"], input#totpCode');if(await t.count()){await t.first().fill(totpNow(OWNER.totpSecret));await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(4500);}return !page.url().includes("/login");}

const browser=await chromium.launch();
const page=await (await browser.newContext({viewport:{width:1440,height:1200}})).newPage();
await login(page);
await page.goto(`${BASE}/app/hr/settings/tax`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(7000);
if(page.url().includes("/login")){await login(page);await page.goto(`${BASE}/app/hr/settings/tax`);await page.waitForTimeout(7000);}
const inputs=await page.locator("form input").evaluateAll(els=>els.map(e=>({
  name:e.getAttribute("name"), id:e.id, type:e.type, placeholder:e.getAttribute("placeholder"),
  aria:e.getAttribute("aria-label"), labelledby:e.getAttribute("aria-labelledby"), value:e.value,
})));
console.log(JSON.stringify(inputs,null,1));
console.log("--- forms:",await page.locator("form").count());
console.log("--- save disabled?",await page.locator('button[type="submit"]').last().isDisabled());
await browser.close();
