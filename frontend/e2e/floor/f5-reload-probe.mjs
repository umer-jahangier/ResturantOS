/*
 * Is /app/finance/takings blank after a browser reload?
 *
 * The verification harness saw every FIRST load render and every RELOAD render nothing.
 * That is either a real persistence defect or an artefact of how the harness reloads.
 * This looks at it directly: load, describe the page, reload, describe it again, and
 * capture the network calls and console errors on both.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F5/verify");
mkdirSync(OUT, { recursive: true });
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;const n=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(n%1_000_000).padStart(6,"0");}

async function loginOnce(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    const s = Math.floor(Date.now() / 1000) % 30;
    if (s > 24) await page.waitForTimeout((31 - s) * 1000);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  if (page.url().includes("/login")) throw new Error(`login failed — ${page.url()}`);
}
async function login(page, who) {
  let e0 = null;
  for (let a = 0; a < 4; a++) { try { await loginOnce(page, who); return; } catch (e) { e0 = e; await page.waitForTimeout(15000); } }
  throw e0;
}

async function describe(page, label, waitMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < waitMs) {
    last = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-testid^="figure-tile-"]')]
        .map((e) => (e.innerText || "").replace(/\s+/g, " ").slice(0, 80));
      const body = (document.body.innerText || "").replace(/\s+/g, " ");
      return {
        url: location.href,
        tileCount: tiles.length,
        tiles,
        skeletons: document.querySelectorAll('[class*="animate-pulse"], [data-slot="skeleton"]').length,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => (n.textContent || "").trim()).filter(Boolean),
        bodyHead: body.slice(0, 500),
        hasEmpty: /No trading recorded on this date/i.test(body),
        hasError: /Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch|Access denied/i.test(body),
        dateInput: document.querySelector('[data-testid="takings-date"]')?.value ?? null,
      };
    });
    if (last.tileCount > 0 || last.hasEmpty || last.hasError) break;
    await page.waitForTimeout(1000);
  }
  console.log(`\n── ${label} (after ${((Date.now() - t0) / 1000).toFixed(1)}s) ──`);
  console.log(`   url=${last.url}`);
  console.log(`   tiles=${last.tileCount} skeletons=${last.skeletons} empty=${last.hasEmpty} error=${last.hasError} dateInput=${last.dateInput}`);
  if (last.alerts.length) console.log(`   ALERTS: ${JSON.stringify(last.alerts)}`);
  if (last.tileCount) console.log(`   ${JSON.stringify(last.tiles, null, 2)}`);
  else console.log(`   body: ${last.bodyHead}`);
  return last;
}

(async () => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const net = [];
  const errs = [];
  page.on("response", (r) => { if (r.url().includes("takings") || r.url().includes("/auth/")) net.push({ s: r.status(), u: r.url().slice(0, 120) }); });
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });

  await login(page, OWNER);
  console.log("  · signed in as owner@terrace.local");

  const URL_ = `${BASE}/app/finance/takings?date=2026-08-11`;

  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  const first = await describe(page, "FIRST LOAD (goto)", 45000);
  await page.screenshot({ path: `${OUT}/reload-01-first.png` });
  const netAfterFirst = net.length;

  await page.reload({ waitUntil: "domcontentloaded" });
  const afterReload = await describe(page, "AFTER page.reload()", 60000);
  await page.screenshot({ path: `${OUT}/reload-02-reloaded.png` });

  // And a fresh goto to the SAME url — is it reload specifically, or any second load?
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  const secondGoto = await describe(page, "SECOND LOAD (goto again, same url)", 60000);
  await page.screenshot({ path: `${OUT}/reload-03-second-goto.png` });

  console.log(`\n── network (takings + auth) ──`);
  for (const n of net) console.log(`   ${n.s}  ${n.u}`);
  console.log(`\n── console errors ──`);
  for (const e of errs.slice(0, 15)) console.log(`   ${e}`);

  writeFileSync(`${OUT}/reload-probe.json`, JSON.stringify({ first, afterReload, secondGoto, net, errs, netAfterFirst }, null, 2));
  await browser.close();
})();
