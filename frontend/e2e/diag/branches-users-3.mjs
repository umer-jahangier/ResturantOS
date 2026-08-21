/*
 * DIAGNOSIS stage 3 — complete the loops end to end as OWNER.
 *  1. Assign waiter a SECOND branch role at Rooftop, verify it lands.
 *  2. Self-assign OWNER at Rooftop, verify the branch switcher then appears, switch, and see
 *     whether /app/settings follows to the Rooftop branch.
 *  3. Branch-details save round trip on HQ.
 * Data written here is reverted by e2e/diag/revert.sh.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/branches-users";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;const k=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(k%1000000).padStart(6,"0");}

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v.slice(0, 1200) : JSON.stringify(v).slice(0, 1200)); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log("  shot ->", n); };

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if ((await t.count()) && who.totpSecret) { await t.first().fill(totpNow(who.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000); }
  return !page.url().includes("/login");
}

async function selectUser(page, email) {
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const row = page.locator(`button:has-text("${email}")`).first();
  if (!(await row.count())) return false;
  await row.click();
  await page.waitForTimeout(3500);
  return true;
}

async function assignRole(page, branchLabel, roleLabel) {
  const btn = page.locator('button:has-text("Assign role")').first();
  if (!(await btn.count())) { rec("assign", "no Assign role button"); return null; }
  await btn.click();
  await page.waitForTimeout(2000);
  const dlg = page.locator('[role="dialog"]').first();
  const selects = dlg.locator("select");
  const n = await selects.count();
  rec("assign-dialog-selects", n);
  if (n >= 2) {
    await selects.nth(0).selectOption({ label: branchLabel });
    await page.waitForTimeout(500);
    await selects.nth(1).selectOption({ label: roleLabel });
    await page.waitForTimeout(500);
  }
  await shot(page, `20-assign-${roleLabel}-${branchLabel}`.replace(/[^a-zA-Z0-9-]/g, "_"));
  const submit = dlg.locator('button:has-text("Assign role")').last();
  const resp = page.waitForResponse((r) => r.url().includes("/branch-roles"), { timeout: 20000 }).catch(() => null);
  await submit.click();
  const r = await resp;
  const result = r ? { status: r.status(), body: await r.text().catch(() => "") } : { status: "NO REQUEST OBSERVED" };
  rec("assign-response", result);
  await page.waitForTimeout(3500);
  await shot(page, `21-after-assign-${roleLabel}`.replace(/[^a-zA-Z0-9-]/g, "_"));
  return result;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => rec("pageerror", String(e).slice(0, 200)));

  if (!(await login(page, OWNER))) { rec("FATAL", "login failed"); await browser.close(); return; }

  // ---- 1. assign waiter a role at the SECOND branch ------------------------------------
  if (await selectUser(page, "waiter@terrace.local")) {
    const before = await page.locator("body").innerText();
    rec("waiter-before", before.slice(before.indexOf("Roles by branch"), before.indexOf("Roles by branch") + 400));
    await assignRole(page, "Floating Terrace — Rooftop", "Cashier");
    const after = await page.locator("body").innerText();
    rec("waiter-after", after.slice(after.indexOf("Roles by branch"), after.indexOf("Roles by branch") + 500));
    // is there ANY way to revoke it?
    const btns = await page.locator("button").allInnerTexts();
    rec("revoke-affordances", btns.filter((b) => /revoke|remove|delete|unassign|×/i.test(b) && b.length < 40));
  }

  // ---- 2. self-assign OWNER at Rooftop, then look for the switcher ----------------------
  if (await selectUser(page, "owner@terrace.local")) {
    await assignRole(page, "Floating Terrace — Rooftop", "Owner");
  }
  // a fresh token is needed for /branches/mine to change -> re-login
  await page.goto(`${BASE}/api/session/clear`).catch(() => {});
  await ctx.clearCookies();
  await login(page, OWNER);
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const sw = page.locator('[aria-label="Switch branch"]');
  rec("switcher-count-after-self-assign", await sw.count());
  await shot(page, "22-after-self-assign-dashboard");
  if (await sw.count()) {
    rec("switcher-label", await sw.first().innerText());
    await sw.first().click();
    await page.waitForTimeout(1500);
    rec("switcher-options", await page.locator('[role="menuitem"]').allInnerTexts().catch(() => []));
    await shot(page, "23-switcher-open");
    const roof = page.locator('[role="menuitem"]:has-text("Rooftop")').first();
    if (await roof.count()) {
      await roof.click();
      await page.waitForTimeout(7000);
      await shot(page, "24-after-switch-to-rooftop");
      rec("after-switch-body", (await page.locator("body").innerText()).slice(0, 900));
      // does settings follow?
      await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      const vals = await page.locator("input").evaluateAll((els) => els.map((e) => ({ name: e.getAttribute("name"), value: e.value })));
      rec("settings-values-on-rooftop", vals);
      await shot(page, "25-settings-after-switch");
    }
  }

  writeFileSync(`${OUT}/transcript-3.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
main();
