// Honest characterisation of the platform-console logout: what timing actually triggers it?
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const st = async (p) => await p.evaluate(() => /Sign in to RestaurantOS/.test(document.body.innerText) ? "LOGGED_OUT" : "OK");
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.locator('input#email, input[name=email], input[type=email]').first().fill("superadmin@softxlogic.com", { timeout: 20000 });
  await page.locator('input#password, input[name=password], input[type=password]').first().fill("Test@123!");
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(3500);
}
async function trial(browser, waitMs) {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  let bad = 0, codes = [];
  p.on("response", r => { if (r.url().includes("/auth/refresh")) { codes.push(r.status()); if (r.status() >= 400) bad++; } });
  await login(p);
  const routes = ["/platform/dashboard", "/platform/tenants"];
  let died = 0;
  for (let i = 0; i < 6; i++) {
    await p.goto(`${BASE}${routes[i % 2]}`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(waitMs);
    if (await st(p) === "LOGGED_OUT") { died = i + 1; break; }
  }
  await ctx.close();
  return { died, bad, codes: codes.join(",") };
}
async function main() {
  const browser = await chromium.launch();
  for (const w of [800, 1500, 2500]) {
    P(`\n=== wait=${w}ms between hard navigations, 5 trials, sole user ===`);
    let f = 0;
    for (let i = 1; i <= 5; i++) {
      const r = await trial(browser, w);
      if (r.died) f++;
      P(`  trial ${i}: diedAtNav=${r.died || "-"} failedRefreshes=${r.bad} refreshCodes=[${r.codes}]`);
      await new Promise(s => setTimeout(s, 2500)); // stay clear of the login rate limiter
    }
    P(`  >>> logged out in ${f}/5 trials at wait=${w}ms`);
  }
  writeFileSync(`${OUT}/log-11-characterize.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-11-characterize.txt`, log.join("\n")+"\nFATAL "+e); });
