// Prove the mechanism behind the 404-induced platform logout.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("response", async (r) => {
    const u = r.url();
    if (!/auth|platform|refresh|logout/.test(u)) return;
    if (/_next|\.js|\.css/.test(u)) return;
    let body = "";
    try { if (r.status() >= 400) body = (await r.text()).slice(0, 180); } catch {}
    P(`    NET ${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080","GW").replace("http://localhost:3000","FE")} ${body}`);
  });

  const go = async (r) => { P(`  -- goto ${r}`); await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000);
    P("     state:", await page.evaluate(() => { const t=document.body.innerText.replace(/\s+/g," "); return /Sign in to RestaurantOS/.test(t)?"LOGIN"+(/session expired/i.test(t)?"(expired)":""):(/doesn't exist/.test(t)?"404":"OK "+t.slice(0,50)); })); };

  P("== login ==");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.locator('input#email, input[name=email]').first().fill("superadmin@softxlogic.com");
  await page.locator('input#password, input[name=password]').first().fill("Test@123!");
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(4000);
  P("  landed", page.url());
  const cookiesBefore = (await ctx.cookies()).map(c => `${c.name}=${String(c.value).slice(0,14)}...`);
  P("  cookies:", JSON.stringify(cookiesBefore));

  await go("/platform/dashboard");
  await go("/platform/health");
  const cookiesAfter404 = (await ctx.cookies()).map(c => `${c.name}=${String(c.value).slice(0,14)}...`);
  P("  cookies after 404:", JSON.stringify(cookiesAfter404));
  await go("/platform/dashboard");
  const cookiesEnd = (await ctx.cookies()).map(c => `${c.name}=${String(c.value).slice(0,14)}...`);
  P("  cookies at end:", JSON.stringify(cookiesEnd));

  writeFileSync(`${OUT}/log-03-sessionwhy.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-03-sessionwhy.txt`, log.join("\n")+"\nFATAL "+e); });
