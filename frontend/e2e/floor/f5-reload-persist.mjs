/*
 * Does /app/finance/takings survive a reload for the owner?
 *
 * The earlier probe hit "Access denied" with a sidebar collapsed to a single item,
 * i.e. the CLIENT held no permissions — which is a session-hydration question, not a
 * takings question. This separates the two: it logs in ONCE cleanly (waiting for a
 * fresh TOTP window so no attempt is ever rejected), then reloads the takings screen
 * five times, recording on each pass how many permissions the client holds and what
 * the screen actually rendered.
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

/** Never spend a TOTP code with less than 12s left — a rejected code is not a defect. */
async function waitForFreshTotpWindow(page) {
  const s = Math.floor(Date.now() / 1000) % 30;
  if (s > 18) await page.waitForTimeout((31 - s) * 1000);
}

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
    await waitForFreshTotpWindow(page);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
  }
  if (page.url().includes("/login")) throw new Error(`login failed — ${page.url()}`);
}

/** How many nav items the sidebar offers = a visible proxy for the permissions the client holds. */
async function snapshot(page, label) {
  const t0 = Date.now();
  let s = null;
  let firstDeniedAt = null;
  while (Date.now() - t0 < 45000) {
    s = await page.evaluate(() => {
      const body = (document.body.innerText || "").replace(/\s+/g, " ");
      const tiles = [...document.querySelectorAll('[data-testid^="figure-tile-"]')];
      const by = {};
      for (const el of tiles) {
        const label = (el.querySelector("p")?.textContent || "").trim();
        const m = (el.innerText || "").match(/Rs\s[-\d,]+\.\d{2}/);
        by[label] = m ? m[0] : null;
      }
      return {
        navItems: document.querySelectorAll('nav a, aside a').length,
        tileCount: tiles.length,
        tiles: by,
        denied: /Access denied/i.test(body),
        empty: /No trading recorded on this date/i.test(body),
        error: /Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(body),
        spinner: !!document.querySelector('[aria-label="Loading session…"]'),
      };
    });
    // Do NOT break on `denied`: on a hard load the finance PermissionGuard evaluates
    // BEFORE the session bootstrap hydrates the in-memory token, so the owner is shown
    // "Access denied" for a moment and then the real screen replaces it. Breaking on the
    // first denial measures that flash and scores it as a lost permission — the timing
    // form of "an error state looks exactly like an empty state". Wait for a settled
    // outcome: tiles, an explicit empty day, or a hard error.
    if (s.tileCount > 0 || s.empty || s.error) break;
    if (s.denied && !firstDeniedAt) firstDeniedAt = Date.now() - t0;
    await page.waitForTimeout(1000);
  }
  const verdict = s.tileCount ? `${s.tileCount} tiles` : s.empty ? "empty state" : s.error ? "ERROR" : s.denied ? "ACCESS DENIED (settled)" : "still loading";
  const flash = firstDeniedAt !== null ? `  [denied flashed at ${(firstDeniedAt / 1000).toFixed(1)}s]` : "";
  console.log(`  ${label.padEnd(22)} settled in ${((Date.now() - t0) / 1000).toFixed(1)}s  ${verdict}${flash}`);
  s.deniedFlashMs = firstDeniedAt;
  if (s.tileCount) console.log(`      ${JSON.stringify(s.tiles)}`);
  return s;
}

(async () => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await loginClean(page, OWNER);
  console.log("  · signed in as owner@terrace.local (single clean attempt)\n");

  const URL_ = `${BASE}/app/finance/takings?date=2026-08-11`;
  const passes = [];

  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  passes.push(await snapshot(page, "first load"));
  await page.screenshot({ path: `${OUT}/persist-00-first.png` });

  for (let i = 1; i <= 5; i++) {
    await page.reload({ waitUntil: "domcontentloaded" });
    const s = await snapshot(page, `reload #${i}`);
    passes.push(s);
    if (i === 1) await page.screenshot({ path: `${OUT}/persist-01-reload.png` });
  }

  const good = passes.filter((p) => p.tileCount === 7);
  const denied = passes.filter((p) => p.denied);
  console.log(`\n  ================ RESULT ================`);
  console.log(`  passes with all 7 tiles : ${good.length}/${passes.length}`);
  console.log(`  passes showing DENIED   : ${denied.length}/${passes.length}`);
  const allSame = good.length > 1 && good.every((p) => JSON.stringify(p.tiles) === JSON.stringify(good[0].tiles));
  console.log(`  figures identical across every rendering pass: ${allSame}`);
  if (good.length) console.log(`  figures: ${JSON.stringify(good[0].tiles)}`);
  console.log(`  ========================================`);

  writeFileSync(`${OUT}/reload-persist.json`, JSON.stringify({ passes }, null, 2));
  await browser.close();
})();
