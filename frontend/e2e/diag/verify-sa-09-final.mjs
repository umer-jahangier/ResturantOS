// Final sweep: things the previous report never tested at all.
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
async function go(page, r, w = 3500) {
  for (let i = 0; i < 3; i++) { await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(w);
    if (await st(page) !== "LOGGED_OUT") return true; P("     !! re-login"); await login(page); }
  return false;
}
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); P("     shot:", n); };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page);

  // 1. Does the SuperAdmin login form ever ask for a second factor?
  P("=== 1. PLATFORM MFA ===");
  P("  landed straight on:", page.url(), "— no TOTP step was presented");
  const claims = await page.evaluate(() => {
    const m = document.cookie; return m.slice(0, 200);
  });
  P("  cookies visible to JS:", claims);

  // 2. Purged-tenant toggle
  P("\n=== 2. PURGED TENANTS TOGGLE ===");
  await go(page, "/platform/tenants");
  const t1 = await page.evaluate(() => ({ rows: document.querySelectorAll("tbody tr").length,
    btn: [...document.querySelectorAll("button")].map(b => b.textContent.trim()).find(t => /purged/i.test(t)) }));
  P("  before:", JSON.stringify(t1));
  if (t1.btn) {
    await page.locator(`button:has-text("purged")`).first().click(); await page.waitForTimeout(2000);
    const t2 = await page.evaluate(() => ({ rows: document.querySelectorAll("tbody tr").length,
      btn: [...document.querySelectorAll("button")].map(b => b.textContent.trim()).find(t => /purged/i.test(t)) }));
    P("  after:", JSON.stringify(t2));
    await shot(page, "09-purged-shown");
  }

  // 3. Search / filter / sort / pagination on the tenant list
  P("\n=== 3. TENANT LIST AFFORDANCES (scale) ===");
  const aff = await page.evaluate(() => ({
    textInputs: [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')].map(i => i.placeholder || i.id || "?"),
    selects: [...document.querySelectorAll("select")].map(s => s.id || "?"),
    sortableHeaders: [...document.querySelectorAll("th")].map(h => `${h.innerText.trim()}${h.querySelector("button") ? "(sortable)" : ""}`),
    pagination: /next|previous|page \d|rows per page/i.test(document.body.innerText),
  }));
  P("  " + JSON.stringify(aff));

  // 4. Is there ANY account control for the platform operator?
  P("\n=== 4. PLATFORM OPERATOR ACCOUNT CONTROLS ===");
  const shellControls = await page.evaluate(() => ({
    buttons: [...new Set([...document.querySelectorAll("header button, header a")].map(b => b.textContent.trim()))],
    avatarMenu: !!document.querySelector('[aria-label*=account i], [data-testid*=user-menu]'),
  }));
  P("  " + JSON.stringify(shellControls));
  for (const r of ["/platform/profile", "/profile", "/settings/appearance", "/app/profile"]) {
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);
    const s = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 100));
    P(`  ${r} -> ${s}`);
  }

  // 5. Can a SuperAdmin reach the tenant app at all? (support scenario)
  P("\n=== 5. CAN THE PLATFORM OPERATOR SEE A TENANT'S APP? ===");
  await login(page);
  for (const r of ["/app/dashboard", "/app/pos"]) {
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3500);
    const s = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 160));
    P(`  ${r} -> ${s}`);
    await shot(page, `09-sa-in-tenant-app-${r.replace(/\//g, "_")}`);
  }

  // 6. Sign out
  P("\n=== 6. SIGN OUT ===");
  await go(page, "/platform/dashboard");
  const so = page.locator('button:has-text("Sign out")').first();
  if (await so.count()) { await so.click(); await page.waitForTimeout(3000); P("  after sign out ->", page.url(), await st(page)); }

  writeFileSync(`${OUT}/log-09.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-09.txt`, log.join("\n")+"\nFATAL "+e); });
