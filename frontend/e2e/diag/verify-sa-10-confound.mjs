// Rule out a test-environment confound: does a SECOND, independent SuperAdmin login
// (separate cookie jar — i.e. another operator, or another agent) revoke the FIRST session?
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
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(4000);
}
async function main() {
  const browser = await chromium.launch();
  // Operator A signs in and works.
  const ctxA = await browser.newContext(); const A = await ctxA.newPage();
  A.on("response", async r => { if (r.url().includes("/auth/refresh")) P(`      [A] refresh ${r.status()}`); });
  await login(A);
  P("A signed in ->", A.url());
  await A.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" }); await A.waitForTimeout(3000);
  P("A on tenants:", await st(A));

  // Operator B (a different browser profile entirely) signs in as the SAME account.
  const ctxB = await browser.newContext(); const B = await ctxB.newPage();
  await login(B);
  P("B signed in ->", B.url(), await st(B));

  // Does A survive?
  for (let i = 1; i <= 3; i++) {
    await A.goto(`${BASE}/platform/dashboard`, { waitUntil: "domcontentloaded" }); await A.waitForTimeout(3000);
    P(`A nav#${i} after B logged in -> ${await st(A)}`);
    if (await st(A) === "LOGGED_OUT") break;
  }
  P("B still ok? ->", await st(B));

  // And a strictly-alone session, no competitor, 10 hard navigations.
  P("\n-- ALONE: one context, 10 hard navigations, nothing else touching the account --");
  await ctxA.close(); await ctxB.close();
  const ctxC = await browser.newContext(); const C = await ctxC.newPage();
  let fails = 0;
  C.on("response", async r => { if (r.url().includes("/auth/refresh") && r.status() >= 400) { fails++; P(`      [C] refresh ${r.status()} <-- FAILED`); } });
  await login(C);
  const routes = ["/platform/dashboard", "/platform/tenants"];
  const res = [];
  for (let i = 0; i < 10; i++) {
    await C.goto(`${BASE}${routes[i % 2]}`, { waitUntil: "domcontentloaded" }); await C.waitForTimeout(2500);
    res.push(await st(C));
  }
  P("  " + res.join(" "));
  P(`  failed refreshes: ${fails}`);
  writeFileSync(`${OUT}/log-10-confound.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-10-confound.txt`, log.join("\n")+"\nFATAL "+e); });
