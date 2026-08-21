/* DIAGNOSIS ONLY — dump the structure of /app/menu/items so the wipe probe can target a row. */
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  if (!(await login(page))) { console.log("LOGIN FAILED"); await browser.close(); process.exit(1); }
  await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  if (page.url().includes("/login")) { await login(page); await page.goto(`${BASE}/app/menu/items`); await page.waitForTimeout(7000); }

  console.log("url:", page.url());
  console.log("\n--- FULL PAGE TEXT ---\n" + (await page.locator("body").innerText()));
  console.log("\n--- BUTTONS ---");
  const btns = await page.locator("button").evaluateAll((els) => els.map((e) => ({ text: e.innerText.trim().slice(0,40), aria: e.getAttribute("aria-label") })));
  console.log(JSON.stringify(btns, null, 1));
  console.log("\n--- TABLE COLUMN HEADERS ---");
  console.log(JSON.stringify(await page.locator("th").allInnerTexts()));
  console.log("\n--- ROW COUNT ---", await page.locator("tbody tr").count());
  await page.screenshot({ path: `${OUT}/menu-items-fullpage.png`, fullPage: true });
  await browser.close();
}
main();
