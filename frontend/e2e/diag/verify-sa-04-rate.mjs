// Measure how often a SuperAdmin gets thrown out of the console during ordinary navigation.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const FT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

const st = async (p) => await p.evaluate(() => { const t = document.body.innerText.replace(/\s+/g," ");
  return /Sign in to RestaurantOS/.test(t) ? "LOGGED_OUT" : (/doesn't exist/.test(t) ? "404" : "OK"); });

async function trial(browser, i, waitMs, seq) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let refreshes = 0, failedRefresh = 0;
  page.on("response", r => { if (r.url().includes("/auth/refresh")) { refreshes++; if (r.status() >= 400) failedRefresh++; } });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1000);
  await page.locator('input#email, input[name=email]').first().fill("superadmin@softxlogic.com");
  await page.locator('input#password, input[name=password]').first().fill("Test@123!");
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(3500);
  const steps = [];
  let died = -1;
  for (let n = 0; n < seq.length; n++) {
    await page.goto(`${BASE}${seq[n]}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs);
    const s = await st(page);
    steps.push(`${seq[n]}=${s}`);
    if (s === "LOGGED_OUT" && died < 0) died = n + 1;
  }
  P(`  trial ${i} (wait ${waitMs}ms): refreshes=${refreshes} failed=${failedRefresh} diedAtNav=${died < 0 ? "-" : died} | ${steps.join(" ")}`);
  await ctx.close();
  return died > 0;
}

async function main() {
  const browser = await chromium.launch();
  const SEQ = ["/platform/dashboard", "/platform/health", "/platform/dashboard", `/platform/tenants/${FT}`, "/platform/tenants"];
  for (const wait of [1500, 2200]) {
    P(`\n===== sequence: valid,404,valid,detail,list @ wait=${wait}ms =====`);
    let fails = 0;
    for (let i = 1; i <= 6; i++) if (await trial(browser, i, wait, SEQ)) fails++;
    P(`  >>> LOGGED OUT in ${fails}/6 trials at wait=${wait}ms`);
  }
  P(`\n===== control: only valid routes @ 1500ms =====`);
  const VALID = ["/platform/dashboard", "/platform/tenants", "/platform/dashboard", `/platform/tenants/${FT}`, "/platform/tenants"];
  let f2 = 0;
  for (let i = 1; i <= 6; i++) if (await trial(browser, i, 1500, VALID)) f2++;
  P(`  >>> LOGGED OUT in ${f2}/6 trials (valid routes only)`);
  writeFileSync(`${OUT}/log-04-rate.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-04-rate.txt`, log.join("\n")+"\nFATAL "+e); });
