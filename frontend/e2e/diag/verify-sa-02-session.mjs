// Isolate: what kills the platform session? Nth hard navigation, or a specific route?
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('input[name="email"], input#email').first().fill("superadmin@softxlogic.com");
  await page.locator('input[name="password"], input#password').first().fill("Test@123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  return page.url();
}
const state = async (page) => await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  if (/Sign in to RestaurantOS/.test(t)) return "LOGIN_PAGE" + (/session expired/i.test(t) ? " (session expired)" : "");
  if (/This page doesn't exist/.test(t)) return "404_PAGE";
  return "OK: " + t.slice(0, 70);
});

async function run(label, routes) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  P(`\n===== ${label} =====`);
  P("login ->", await login(page));
  let n = 0;
  for (const r of routes) {
    n++;
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    P(`  nav#${n} ${r} -> ${await state(page)}`);
  }
  await browser.close();
}

async function main() {
  // A: only VALID routes, many hard navigations — is it navigation count?
  await run("A: 6 hard navs, all VALID routes", [
    "/platform/dashboard", "/platform/tenants", "/platform/dashboard",
    "/platform/tenants", "/platform/dashboard", "/platform/tenants",
  ]);
  // B: repeated 404 routes — is it the 404 itself?
  await run("B: hard navs to NON-EXISTENT platform routes", [
    "/platform/health", "/platform/users", "/platform/settings", "/platform/billing",
  ]);
  // C: does the console recover after a 404? go back to a valid route
  await run("C: valid -> 404 -> valid (recovery?)", [
    "/platform/dashboard", "/platform/health", "/platform/dashboard", "/platform/users", "/platform/tenants",
  ]);
  // D: single 404 then wait then valid
  await run("D: one 404 then valid", ["/platform/nonexistent-xyz", "/platform/dashboard"]);
  writeFileSync(`${OUT}/log-02-session.txt`, log.join("\n"));
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-02-session.txt`, log.join("\n") + "\nFATAL " + e); });
