/*
 * DIAGNOSIS stage 4
 *  A. MANAGER (the only persona on BOTH branches): does the switcher appear, switch, and does
 *     data scope follow? Does the manager reach branch settings at all?
 *  B. OWNER: self-assign at Rooftop (robust), re-login, switcher, switch, settings follow?
 *  C. OWNER: branch-details save round trip.
 *  D. OWNER: multi-branch reporting — is branch a dimension anywhere?
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
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v.slice(0, 1000) : JSON.stringify(v).slice(0, 1000)); };
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

async function switcherProbe(page, tag) {
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  const sw = page.locator('[aria-label="Switch branch"]');
  const n = await sw.count();
  rec(`${tag}-switcher-count`, n);
  await shot(page, `30-${tag}-dashboard`);
  if (!n) return null;
  rec(`${tag}-switcher-current`, await sw.first().innerText());
  await sw.first().click();
  await page.waitForTimeout(1800);
  const opts = await page.locator('[role="menuitem"]').allInnerTexts().catch(() => []);
  rec(`${tag}-switcher-options`, opts);
  await shot(page, `31-${tag}-switcher-open`);
  return opts;
}

async function main() {
  const browser = await chromium.launch();

  // ================= A. MANAGER =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => rec("mgr-pageerror", String(e).slice(0, 200)));
    if (await login(page, MANAGER)) {
      rec("manager-login", "ok");
      // dashboard numbers BEFORE the switch
      await page.goto(`${BASE}/app/pos/orders`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      const ordersHQ = await page.locator("body").innerText();
      rec("manager-orders-on-HQ", ordersHQ.slice(0, 700));
      await shot(page, "32-manager-orders-HQ");

      const opts = await switcherProbe(page, "manager");
      if (opts) {
        const roof = page.locator('[role="menuitem"]:has-text("Rooftop")').first();
        if (await roof.count()) {
          await roof.click();
          await page.waitForTimeout(9000);
          await shot(page, "33-manager-after-switch");
          const sw = page.locator('[aria-label="Switch branch"]');
          rec("manager-switcher-after", await sw.first().innerText().catch(() => "(gone)"));
          const bodyAfter = await page.locator("body").innerText();
          rec("manager-body-after-switch", bodyAfter.slice(0, 700));
          await page.goto(`${BASE}/app/pos/orders`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(6500);
          const ordersRoof = await page.locator("body").innerText();
          rec("manager-orders-on-ROOFTOP", ordersRoof.slice(0, 700));
          rec("data-scope-followed", ordersHQ !== ordersRoof);
          await shot(page, "34-manager-orders-ROOFTOP");
        }
      }
      // can the manager reach branch settings / users at all?
      for (const r of ["/app/settings", "/app/users"]) {
        await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(5000);
        const b = await page.locator("body").innerText();
        rec(`manager-${r}`, { denied: /Access denied|do not have permission|don't have permission/i.test(b), head: b.slice(b.indexOf("Search…") > 0 ? b.indexOf("Search…") : 0, 500) });
        await shot(page, `35-manager${r.replace(/\//g, "_")}`);
      }
    } else rec("manager-login", "FAILED");
    await ctx.close();
  }

  // ================= B + C + D. OWNER =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => rec("own-pageerror", String(e).slice(0, 200)));
    if (!(await login(page, OWNER))) { rec("owner-login", "FAILED"); await ctx.close(); await browser.close(); return; }

    // ---- C. branch details save round trip -------------------------------------------
    await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6500);
    const stamp = `DIAG ${Date.now()}`;
    const addr = page.locator('input[name="address"]').first();
    if (await addr.count()) {
      await addr.fill(stamp);
      const resp = page.waitForResponse((r) => r.url().includes("/api/v1/branches/") && r.request().method() === "PUT", { timeout: 20000 }).catch(() => null);
      await page.locator('button:has-text("Save changes")').first().click();
      const r = await resp;
      rec("settings-save-response", r ? { status: r.status(), body: (await r.text().catch(() => "")).slice(0, 300) } : "NO PUT OBSERVED");
      await page.waitForTimeout(3000);
      await shot(page, "40-settings-saved");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6500);
      const back = await page.locator('input[name="address"]').first().inputValue();
      rec("settings-persisted", { wrote: stamp, readBack: back, persisted: back === stamp });
    } else rec("settings-save", "no address input found");

    // ---- B. self-assign OWNER at Rooftop ----------------------------------------------
    await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6500);
    // find the row whose text contains the owner email
    const rows = page.locator("button").filter({ hasText: "owner@terrace.local" });
    rec("owner-row-matches", await rows.count());
    if (await rows.count()) {
      await rows.first().click();
      await page.waitForTimeout(4000);
      await shot(page, "41-owner-selected");
      const ab = page.locator('button:has-text("Assign role")').first();
      rec("owner-assign-button", await ab.count());
      if (await ab.count()) {
        await ab.click();
        await page.waitForTimeout(2200);
        const dlg = page.locator('[role="dialog"]').first();
        const sels = dlg.locator("select");
        rec("owner-dialog-selects", await sels.count());
        if ((await sels.count()) >= 2) {
          await sels.nth(0).selectOption({ label: "Floating Terrace — Rooftop" });
          await sels.nth(1).selectOption({ label: "Owner" });
          await page.waitForTimeout(500);
          const resp = page.waitForResponse((r) => r.url().includes("/branch-roles"), { timeout: 20000 }).catch(() => null);
          await dlg.locator('button:has-text("Assign role")').last().click();
          const r = await resp;
          rec("owner-selfassign-response", r ? { status: r.status(), body: (await r.text().catch(() => "")).slice(0, 300) } : "NO REQUEST");
          await page.waitForTimeout(3500);
          await shot(page, "42-owner-selfassigned");
        }
      }
    }
    await ctx.close();
  }

  // fresh session so /branches/mine is re-read
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
    const page = await ctx.newPage();
    if (await login(page, OWNER)) {
      const opts = await switcherProbe(page, "owner-after-selfassign");
      if (opts) {
        const roof = page.locator('[role="menuitem"]:has-text("Rooftop")').first();
        if (await roof.count()) {
          await roof.click();
          await page.waitForTimeout(9000);
          await shot(page, "43-owner-on-rooftop");
          await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(7000);
          const vals = await page.locator("input").evaluateAll((els) => els.map((e) => ({ name: e.getAttribute("name"), value: e.value })));
          rec("owner-settings-on-rooftop", vals);
          await shot(page, "44-owner-settings-rooftop");
        }
      }
      // ---- D. multi-branch reporting ----
      await page.goto(`${BASE}/app/reports`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7000);
      const rbody = await page.locator("body").innerText();
      rec("reports-catalogue", rbody.slice(rbody.indexOf("Search…") > 0 ? rbody.indexOf("Search…") + 10 : 0, 2500));
      rec("reports-mentions-branch", /branch/i.test(rbody));
      await shot(page, "45-reports-catalogue");
    }
    await ctx.close();
  }

  writeFileSync(`${OUT}/transcript-4.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
main();
