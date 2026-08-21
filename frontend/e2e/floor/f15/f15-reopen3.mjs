/* F15 re-open, leg 3 — the disclosed residuals, checked myself. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F15/reopen");
mkdirSync(OUT, { recursive: true });
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totp(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;return String(((((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff))%1e6)).padStart(6,"0");}
(async()=>{
  const br=await chromium.launch({args:["--disable-dev-shm-usage"]});
  const ctx=await br.newContext({viewport:{width:1440,height:950}});
  const p=await ctx.newPage();
  await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});await p.waitForTimeout(1500);
  const sl=p.locator('input[name="tenantSlug"], input#tenantSlug'); if(await sl.count()) await sl.first().fill(OWNER.slug);
  await p.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await p.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await p.locator('button[type="submit"]').first().click();await p.waitForTimeout(4000);
  const t=p.locator('input[name="totpCode"], input#totpCode');
  if(await t.count()){await t.first().fill(totp(OWNER.totpSecret));await p.locator('button[type="submit"]').first().click();await p.waitForTimeout(5000);}
  console.log("  signed in:", p.url());

  const crumbs = async () => p.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Breadcrumb"], [data-testid="breadcrumb"], header nav');
    return nav ? nav.innerText.replace(/\n/g, " / ") : "(no breadcrumb node found)";
  });

  for (const [label, url] of [["unknown", "/app/reports/definitely-not-a-report"], ["real", "/app/reports/purchases-by-po"]]) {
    await p.goto(`${BASE}${url}`,{waitUntil:"domcontentloaded"});await p.waitForTimeout(5000);
    const c = await crumbs();
    const h1 = await p.evaluate(()=>Array.from(document.querySelectorAll("h1")).map(n=>n.textContent.trim()));
    console.log(`  [${label}] h1=${JSON.stringify(h1)}  breadcrumb="${c}"`);
    await p.waitForTimeout(2000);
  }

  // fbr — the disclosed sibling gap
  await p.goto(`${BASE}/app/reports/fbr`,{waitUntil:"domcontentloaded"});await p.waitForTimeout(6000);
  const fbr = await p.evaluate(()=>({
    h1:Array.from(document.querySelectorAll("h1")).map(n=>n.textContent.trim()),
    alerts:Array.from(document.querySelectorAll('[role="alert"]')).map(n=>n.textContent.trim().slice(0,150)),
    text:(document.body.innerText||"").slice(0,600),
  }));
  console.log("  [fbr]", JSON.stringify(fbr).slice(0,700));
  await p.screenshot({path:`${OUT}/30-fbr.png`});

  // mobile + dark on the not-found state
  await p.setViewportSize({width:390,height:844});
  await p.goto(`${BASE}/app/reports/definitely-not-a-report`,{waitUntil:"domcontentloaded"});await p.waitForTimeout(5000);
  const m = await p.evaluate(()=>({
    scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,
    notFound:!!document.querySelector('[data-testid="report-not-found"]'),
    dark:document.documentElement.classList.contains("dark"),
    h1:Array.from(document.querySelectorAll("h1")).map(n=>n.textContent.trim()),
  }));
  console.log("  [390px light]", JSON.stringify(m));
  await p.screenshot({path:`${OUT}/31-notfound-390-light.png`});

  await p.emulateMedia({colorScheme:"dark"});
  await p.reload({waitUntil:"domcontentloaded"});await p.waitForTimeout(5000);
  const d = await p.evaluate(()=>({
    scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,
    notFound:!!document.querySelector('[data-testid="report-not-found"]'),
    dark:document.documentElement.classList.contains("dark"),
    bg:getComputedStyle(document.body).backgroundColor,
    h1:Array.from(document.querySelectorAll("h1")).map(n=>n.textContent.trim()),
  }));
  console.log("  [390px dark]", JSON.stringify(d));
  await p.screenshot({path:`${OUT}/32-notfound-390-dark.png`});
  await br.close();
})();
