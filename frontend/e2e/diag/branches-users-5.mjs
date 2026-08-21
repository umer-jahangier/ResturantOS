/*
 * DIAGNOSIS stage 5 — careful re-verification of the branch switch.
 *  A. MANAGER on both branches: switch, and check data scope on several branch-scoped screens,
 *     retrying any error state before recording it.
 *  B. OWNER self-assign at Rooftop, completing the approval-limit step this time.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/branches-users";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;const k=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(k%1000000).padStart(6,"0");}

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v.slice(0, 900) : JSON.stringify(v).slice(0, 900)); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log("  shot ->", n); };

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if ((await t.count()) && who.totpSecret) { await t.first().fill(totpNow(who.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5500); }
  return !page.url().includes("/login");
}

/** Load a route, retry once on an error/404 so we never record a mid-failure state. */
async function look(page, route, tag) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const body = await page.locator("body").innerText().catch(() => "");
    const bad = /This page doesn't exist|Couldn'?t load|Something went wrong/i.test(body);
    if (!bad || attempt === 2) {
      // strip the sidebar chrome so comparisons are about the content
      const i = body.indexOf("⌘K");
      const content = i > 0 ? body.slice(i + 2) : body;
      rec(`${tag}`, { route, attempt, bad, content: content.slice(0, 800) });
      await shot(page, tag);
      return content;
    }
    console.log(`  ! ${tag} bad on attempt ${attempt} — retrying`);
  }
}

async function main() {
  const browser = await chromium.launch();

  // ================= A. MANAGER =================
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => rec("mgr-pageerror", String(e).slice(0, 200)));
  if (await login(page, MANAGER)) {
    rec("manager-login", "ok");
    const beforeDash = await look(page, "/app/dashboard", "50-mgr-dashboard-HQ");
    const beforeOrders = await look(page, "/app/pos/orders", "51-mgr-orders-HQ");
    const beforeTables = await look(page, "/app/tables", "52-mgr-tables-HQ");

    // switch
    await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const sw = page.locator('[aria-label="Switch branch"]');
    rec("mgr-switcher-count", await sw.count());
    if (await sw.count()) {
      rec("mgr-switcher-current", await sw.first().innerText());
      await sw.first().click();
      await page.waitForTimeout(1800);
      rec("mgr-switcher-options", await page.locator('[role="menuitem"]').allInnerTexts().catch(() => []));
      await shot(page, "53-mgr-switcher-open");
      const roof = page.locator('[role="menuitem"]:has-text("Rooftop")').first();
      await roof.click();
      await page.waitForTimeout(10000);
      await shot(page, "54-mgr-just-switched");
      rec("mgr-url-after-switch", page.url());
      const swAfter = page.locator('[aria-label="Switch branch"]');
      rec("mgr-switcher-after", await swAfter.first().innerText().catch(() => "(no switcher)"));

      const afterDash = await look(page, "/app/dashboard", "55-mgr-dashboard-ROOFTOP");
      const afterOrders = await look(page, "/app/pos/orders", "56-mgr-orders-ROOFTOP");
      const afterTables = await look(page, "/app/tables", "57-mgr-tables-ROOFTOP");
      rec("scope-dashboard-changed", beforeDash !== afterDash);
      rec("scope-orders-changed", beforeOrders !== afterOrders);
      rec("scope-tables-changed", beforeTables !== afterTables);
    }
  } else rec("manager-login", "FAILED");
  await ctx.close();

  // ================= B. OWNER self-assign =================
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page2 = await ctx2.newPage();
  if (await login(page2, OWNER)) {
    await page2.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
    await page2.waitForTimeout(7000);
    const row = page2.locator("button").filter({ hasText: "owner@terrace.local" }).first();
    await row.click();
    await page2.waitForTimeout(4000);
    await page2.locator('button:has-text("Assign role")').first().click();
    await page2.waitForTimeout(2200);
    const dlg = page2.locator('[role="dialog"]').first();
    const sels = dlg.locator("select");
    await sels.nth(0).selectOption({ label: "Floating Terrace — Rooftop" });
    await sels.nth(1).selectOption({ label: "Owner" });
    await page2.waitForTimeout(1200);
    rec("owner-dialog-after-role", await dlg.innerText());
    await shot(page2, "60-owner-assign-dialog-owner-role");
    // the approval-limit step
    const radios = dlg.locator('input[type="radio"], [role="radio"]');
    rec("owner-dialog-radios", await radios.count());
    if (await radios.count()) {
      await radios.first().click({ force: true });
      await page2.waitForTimeout(900);
    }
    const numeric = dlg.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
    if (await numeric.count()) { await numeric.first().fill("1000000"); await page2.waitForTimeout(700); }
    await shot(page2, "61-owner-assign-limit-filled");
    const submit = dlg.locator('button:has-text("Assign role")').last();
    rec("owner-submit-enabled", await submit.isEnabled());
    if (await submit.isEnabled()) {
      const resp = page2.waitForResponse((r) => r.url().includes("/branch-roles"), { timeout: 25000 }).catch(() => null);
      await submit.click();
      const r = await resp;
      rec("owner-selfassign-response", r ? { status: r.status(), body: (await r.text().catch(() => "")).slice(0, 300) } : "NO REQUEST");
      await page2.waitForTimeout(4000);
      await shot(page2, "62-owner-selfassigned");
    }
  }
  await ctx2.close();

  // fresh login -> does the switcher now exist for the owner, and does settings follow?
  const ctx3 = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page3 = await ctx3.newPage();
  if (await login(page3, OWNER)) {
    await page3.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
    await page3.waitForTimeout(7500);
    const sw = page3.locator('[aria-label="Switch branch"]');
    rec("owner-switcher-count-after", await sw.count());
    await shot(page3, "63-owner-dashboard-after-selfassign");
    if (await sw.count()) {
      await sw.first().click();
      await page3.waitForTimeout(1800);
      await shot(page3, "64-owner-switcher-open");
      await page3.locator('[role="menuitem"]:has-text("Rooftop")').first().click();
      await page3.waitForTimeout(10000);
      await look(page3, "/app/settings", "65-owner-settings-on-ROOFTOP");
      const vals = await page3.locator("input").evaluateAll((els) => els.map((e) => ({ name: e.getAttribute("name"), value: e.value })));
      rec("owner-settings-values-rooftop", vals);
    }
    await look(page3, "/app/reports", "66-reports");
  }
  await ctx3.close();

  writeFileSync(`${OUT}/transcript-5.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
main();
