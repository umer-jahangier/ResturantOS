/*
 * DIAGNOSIS ONLY — (e) what tax breakdown a customer actually sees on the receipt, and
 * (c) whether payroll/income-tax configuration is a real, savable screen.
 *
 * Drives as OWNER. Every route re-authenticates on a session bounce and refuses to file a
 * screenshot of a refusal or an error state as evidence of a feature.
 *
 * Run: node e2e/diag/tax-receipt-and-payroll.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/tax-config");
const BASE = "http://localhost:3000";
// ORD-20260812-0001 — CLOSED, 2 x Chicken Karahi, tax 46400 paisa at 16%.
const ORDER_ID = "322b2cdd-abad-426c-ae34-dbf584fbc0a8";

const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const REFUSAL = /Access denied|You do not have permission/i;
const BROKEN = /Couldn't load|Could not load|Something went wrong|Failed to load/i;

function base32Decode(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",base32Decode(s)).update(b).digest();const o=h[h.length-1]&0x0f;const code=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(code%1000000).padStart(6,"0");}
async function login(page){await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(1500);const s=page.locator('input[name="tenantSlug"], input#tenantSlug');if(await s.count())await s.first().fill(OWNER.slug);await page.locator('input[name="email"], input#email').first().fill(OWNER.email);await page.locator('input[name="password"], input#password').first().fill(OWNER.password);await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(3000);const t=page.locator('input[name="totpCode"], input#totpCode');if(await t.count()){await t.first().fill(totpNow(OWNER.totpSecret));await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(4500);}return !page.url().includes("/login");}

const report=[];
function log(...a){const s=a.join(" ");console.log(s);report.push(s);}

async function open(page,name,route){
  await page.goto(`${BASE}${route}`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(6000);
  let n=0;
  while(page.url().includes("/login")&&n<3){n++;log(`  bounced to login on ${name}; re-authenticating (${n})`);await login(page);await page.goto(`${BASE}${route}`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(6500);}
  const body=await page.locator("body").innerText();
  const alerts=await page.locator('[role="alert"]').allInnerTexts();
  const refused=REFUSAL.test(body), broken=BROKEN.test(body)||alerts.some(t=>BROKEN.test(t));
  log(`\n### ${name} (${route})  url=${page.url()}  refused=${refused} broken=${broken}`);
  await page.screenshot({path:`${OUT}/${refused?"REFUSED-":broken?"ERROR-":""}${name}.png`,fullPage:true});
  return {body,refused,broken};
}

async function main(){
  mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1440,height:1100}})).newPage();
  if(!(await login(page))){log("LOGIN FAILED");await browser.close();process.exit(1);}
  log("signed in as owner@terrace.local");

  // ── (e) THE RECEIPT ────────────────────────────────────────────────────────
  const r=await open(page,"receipt-ORD-20260812-0001",`/app/pos/orders/${ORDER_ID}/receipt`);
  log("--- RECEIPT AS RENDERED IN THE BROWSER ---");
  log(r.body.split("\n").filter(l=>l.trim()).slice(-40).join("\n"));
  log(`--- fiscal region present? ${await page.locator('[aria-label="FBR fiscal information"]').count()} ---`);
  log(`--- QR reserve present?    ${await page.locator('[data-testid="fbr-qr-reserved"]').count()} ---`);
  const taxRows = await page.locator('.receipt-row').allInnerTexts().catch(()=>[]);
  log(`--- receipt rows: ${JSON.stringify(taxRows)}`);

  // ── (c) PAYROLL / INCOME TAX ──────────────────────────────────────────────
  const h=await open(page,"hr-tax-config","/app/hr/settings/tax");
  log("--- HR TAX & EOBI SCREEN ---");
  log(h.body.split("\n").filter(l=>l.trim()).slice(6).join("\n").slice(0,2500));
  const inputs=await page.locator("input").evaluateAll(els=>els.map(e=>({name:e.getAttribute("name"),ph:e.getAttribute("placeholder"),type:e.type,val:e.value})));
  log("--- inputs on the tax screen ---"); log(JSON.stringify(inputs,null,1).slice(0,3000));
  const btns=await page.locator("button").allInnerTexts();
  log("--- buttons ---"+JSON.stringify(btns.filter(b=>b.trim())));

  await browser.close();
  writeFileSync(`${OUT}/receipt-and-payroll-log.txt`,report.join("\n"));
  console.log("\nevidence →",OUT);
}
main();
