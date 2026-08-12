/*
 * Is the "Access denied" I am now seeing specific to /app/finance/takings,
 * or is the whole app in that state for this persona right now?
 *
 * This matters for the F5 verdict: a takings screen that denies the owner is an F5
 * regression; an app that denies the owner everywhere is an environment fault that
 * says nothing about F5. It also dumps what the CLIENT actually holds — the decoded
 * JWT in the session store — so the answer is not a guess.
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

async function loginClean(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    const s = Math.floor(Date.now() / 1000) % 30;
    if (s > 18) await page.waitForTimeout((31 - s) * 1000);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
  }
  if (page.url().includes("/login")) throw new Error(`login failed — ${page.url()}`);
}

const ROUTES = [
  "/app/dashboard",
  "/app/finance/takings",
  "/app/finance/accounts",
  "/app/pos",
  "/app/menu/items",
  "/app/reports",
  "/app/users",
];

(async () => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await loginClean(page, OWNER);
  console.log("  · signed in as owner@terrace.local\n");

  // What does the CLIENT hold? Decode the token the app is actually using.
  const held = await page.evaluate(() => {
    const dec = (t) => { try { const p = t.split(".")[1]; return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; } };
    // The session lives in an in-memory zustand store; mint the same view the app has
    // by spending the refresh cookie, which is what a reload does anyway.
    return fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    }).then((r) => r.json()).then((j) => {
      const tok = j?.data?.accessToken ?? j?.accessToken;
      const c = tok ? dec(tok) : null;
      return { refreshOk: !!tok, tokenLen: tok ? tok.length : 0, permCount: c?.permissions?.length ?? 0, roles: c?.roles ?? null, sample: (c?.permissions ?? []).slice(0, 5) };
    }).catch((e) => ({ error: String(e) }));
  });
  console.log(`  what the client can obtain from /auth/refresh:`);
  console.log(`    ${JSON.stringify(held)}\n`);

  const rows = [];
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    let s = null;
    while (Date.now() - t0 < 25000) {
      s = await page.evaluate(() => {
        const body = (document.body.innerText || "").replace(/\s+/g, " ");
        return {
          nav: document.querySelectorAll("nav a, aside a").length,
          denied: /Access denied/i.test(body),
          spinner: !!document.querySelector('[aria-label="Loading session…"]'),
          head: body.slice(0, 120),
        };
      });
      if (s.denied || (!s.spinner && s.head.length > 60)) break;
      await page.waitForTimeout(1000);
    }
    rows.push({ route: r, ...s });
    console.log(`  ${r.padEnd(26)} nav=${String(s.nav).padStart(3)}  ${s.denied ? "ACCESS DENIED" : "rendered"}`);
  }

  const denied = rows.filter((r) => r.denied);
  console.log(`\n  ================= SCOPE =================`);
  console.log(`  routes denied: ${denied.length}/${rows.length}  -> ${denied.length === rows.length ? "APP-WIDE (environment/session fault, NOT takings)" : denied.length === 0 ? "none — takings is reachable" : "PARTIAL: " + denied.map((d) => d.route).join(", ")}`);
  console.log(`  ========================================`);

  writeFileSync(`${OUT}/scope-probe.json`, JSON.stringify({ held, rows }, null, 2));
  await page.screenshot({ path: `${OUT}/scope-last.png` });
  await browser.close();
})();
