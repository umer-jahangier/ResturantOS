// Clean isolation: ONE session at a time, serial, with the failing refresh body captured.
// Then: does a second concurrent SuperAdmin tab kill the first?
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const FT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";
const st = async (p) => await p.evaluate(() => { const t = document.body.innerText.replace(/\s+/g," ");
  return /Sign in to RestaurantOS/.test(t) ? ("LOGGED_OUT" + (/session expired/i.test(t)?"(expired)":"")) : (/doesn't exist/.test(t) ? "404" : "OK"); });

function wire(page, tag) {
  page.on("response", async r => {
    if (!r.url().includes("/auth/refresh")) return;
    let b = ""; try { if (r.status() >= 400) b = (await r.text()).slice(0, 200); } catch {}
    P(`      [${tag}] refresh -> ${r.status()} ${b}`);
  });
}
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.locator('input#email, input[name=email]').first().fill("superadmin@softxlogic.com");
  await page.locator('input#password, input[name=password]').first().fill("Test@123!");
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(4000);
  return page.url();
}

async function main() {
  const browser = await chromium.launch();

  // --- PART 1: strictly serial, one context, generous waits, valid routes only ---
  P("== PART 1: single fresh session, 8 sequential valid navigations, 3s waits ==");
  for (let t = 1; t <= 3; t++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); wire(page, `T${t}`);
    P(`  -- trial ${t}: login -> ${await login(page)}`);
    const seq = ["/platform/dashboard","/platform/tenants",`/platform/tenants/${FT}`,"/platform/tenants","/platform/dashboard","/platform/tenants",`/platform/tenants/${FT}`,"/platform/dashboard"];
    const res = [];
    for (const r of seq) { await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000); res.push(await st(page)); }
    P(`     ${res.join(" ")}`);
    await ctx.close();
    await new Promise(r => setTimeout(r, 3000));
  }

  // --- PART 2: SPA navigation (clicking nav links) instead of hard navigation ---
  P("\n== PART 2: same session, but navigating by CLICKING the nav (SPA) ==");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); wire(page, "SPA");
    P("  login ->", await login(page));
    const res = [];
    for (let i = 0; i < 8; i++) {
      const label = i % 2 === 0 ? "Tenants" : "Overview";
      const l = page.locator(`nav[aria-label=Platform] a:has-text("${label}")`);
      if (await l.count()) { await l.first().click(); await page.waitForTimeout(2500); }
      res.push(`${label}=${await st(page)}`);
    }
    P("  " + res.join(" "));
    await ctx.close();
  }

  // --- PART 3: two concurrent SuperAdmin tabs (same browser context = same cookie jar) ---
  P("\n== PART 3: TWO TABS, same context (what an operator actually does) ==");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p1 = await ctx.newPage(); wire(p1, "tab1");
    P("  tab1 login ->", await login(p1));
    const p2 = await ctx.newPage(); wire(p2, "tab2");
    await p2.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" }); await p2.waitForTimeout(3000);
    P("  tab2 opened /platform/tenants ->", await st(p2));
    await p1.reload({ waitUntil: "domcontentloaded" }); await p1.waitForTimeout(3000);
    P("  tab1 after reload ->", await st(p1));
    // now hit both at once
    await Promise.all([
      p1.goto(`${BASE}/platform/dashboard`, { waitUntil: "domcontentloaded" }),
      p2.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" }),
    ]);
    await p1.waitForTimeout(3500);
    P("  after simultaneous nav: tab1 =", await st(p1), "| tab2 =", await st(p2));
    await ctx.close();
  }

  writeFileSync(`${OUT}/log-05-clean.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-05-clean.txt`, log.join("\n")+"\nFATAL "+e); });
