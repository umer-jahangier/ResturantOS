/*
 * DIAGNOSIS — the two surfaces the prior report credited or skipped without driving:
 *   (a) /app/hr/settings/tax  — "the only tax a human can set". Is it actually usable?
 *   (b) /app/reports/fbr      — reachable by CLICKING, not just by typing the URL?
 * READ ONLY. Deliberately does not save anything: an HR audit runs against this same stack and
 * configuring the live payroll year would corrupt its measurement.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/tax-config-verify";
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/verify-log-3.txt`;
writeFileSync(LOG, `hr-tax + fbr-report ${new Date().toISOString()}\n`);
const log = (...a) => { const s = a.join(" "); console.log(s); appendFileSync(LOG, s + "\n"); };

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
async function go(page, route, settle = 5500) {
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(settle);
    if (page.url().includes("/login")) { log(`  [trap] bounce on ${route}; re-auth`); await login(page); continue; }
    return await page.locator("body").innerText().catch(() => "");
  }
  return "";
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();
if (!(await login(page))) { log("FATAL login"); process.exit(1); }
log("signed in as OWNER");

// ---------- (a) HR payroll tax ----------------------------------------------------------------
log("\n[A] /app/hr/settings/tax");
const hr = await go(page, "/app/hr/settings/tax", 6500);
const main = hr.split("Collapse").pop() ?? hr;
log("  page text:\n" + main.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 45).map((l) => "    " + l).join("\n"));
const hrBtns = await page.getByRole("button").allInnerTexts();
log("  buttons: " + JSON.stringify(hrBtns));
const hrInputs = await page.locator("input,select").evaluateAll((e) => e.map((x) => x.getAttribute("name") || x.id || x.getAttribute("placeholder")));
log("  inputs: " + JSON.stringify(hrInputs));
const hrTables = await page.locator("table tbody tr").count();
log("  table rows: " + hrTables);
await page.screenshot({ path: `${OUT}/12-hr-tax.png`, fullPage: true });

// ---------- (b) FBR report discoverability -----------------------------------------------------
log("\n[B] /app/reports — is the FBR report reachable by CLICKING?");
await go(page, "/app/reports", 6000);
const links = await page.locator("a[href]").evaluateAll((els) => els.map((e) => `${e.textContent.trim().slice(0,40)} -> ${e.getAttribute("href")}`));
const reportLinks = links.filter((l) => /\/app\/reports\//.test(l));
log("  report links on the index: " + JSON.stringify(reportLinks));
const fbrLink = page.locator('a[href="/app/reports/fbr"]').first();
log("  direct FBR link present? " + (await fbrLink.count() > 0));
if (await fbrLink.count()) {
  await fbrLink.click();
  await page.waitForTimeout(6000);
  log("  after click, url = " + page.url());
  const body = await page.locator("body").innerText();
  const rows = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const idx = rows.findIndex((r) => /FBR Tax Summary/i.test(r));
  log("  FBR report content:\n" + rows.slice(idx, idx + 30).map((l) => "    " + l).join("\n"));
  await page.screenshot({ path: `${OUT}/13-fbr-report-clicked.png`, fullPage: true });
}
await browser.close();
log("\nDONE");
