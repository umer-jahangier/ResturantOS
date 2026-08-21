/* DIAGNOSIS stage 2 — user detail, branch-role assignment, branch switcher. OWNER persona. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/branches-users";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

function b32(input) { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of input.replace(/=+$/, "").toUpperCase()) { const i = a.indexOf(c); if (i === -1) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(o); }
function totpNow(s) { const c = Math.floor(Date.now() / 1000 / 30); const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32(s)).update(b).digest(); const o = h[h.length - 1] & 0x0f; const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff); return String(code % 1000000).padStart(6, "0"); }

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v.slice(0, 900) : JSON.stringify(v).slice(0, 1400)); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log("  shot ->", n); };

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count() && who.totpSecret) { await t.first().fill(totpNow(who.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000); }
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => rec("pageerror", String(e).slice(0, 250)));

  if (!(await login(page, OWNER))) { rec("FATAL", "owner login failed"); await browser.close(); return; }
  rec("login", "owner ok");

  // ---- (e) branch switcher present for the OWNER? --------------------------------------
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const sw = page.locator('[aria-label="Switch branch"]');
  rec("owner-branch-switcher-count", await sw.count());
  rec("owner-header-text", await page.locator("header").innerText().catch(() => "(no header)"));
  await shot(page, "10-owner-dashboard-no-switcher");

  // ---- (c)/(d) users -> detail panel ----------------------------------------------------
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  // click the manager row (assigned to BOTH branches per API)
  const managerRow = page.locator('button:has-text("manager@terrace.local")').first();
  rec("manager-row-found", await managerRow.count());
  if (await managerRow.count()) {
    await managerRow.click();
    await page.waitForTimeout(4000);
  }
  await shot(page, "11-users-manager-selected");
  const panelText = await page.locator("body").innerText();
  const idx = panelText.indexOf("Terrace Manager");
  rec("detail-panel-text", panelText.slice(idx > 0 ? idx : 0, (idx > 0 ? idx : 0) + 2000));
  const detailButtons = await page.locator("button").allInnerTexts();
  rec("buttons-after-select", detailButtons.filter((b) => b.length < 60));

  // ---- role assignment dialog ------------------------------------------------------------
  for (const label of ["Assign role", "Add role", "Assign", "Edit roles", "Manage roles"]) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count()) {
      rec("found-role-button", label);
      await b.click();
      await page.waitForTimeout(2500);
      const dlg = page.locator('[role="dialog"]');
      if (await dlg.count()) {
        const box = await dlg.first().boundingBox();
        rec("role-dialog-box", box);
        rec("role-dialog-text", await dlg.first().innerText());
        const opts = await dlg.locator("select, [role='combobox'], input").evaluateAll((els) => els.map((e) => ({ tag: e.tagName, name: e.getAttribute("name"), role: e.getAttribute("role"), text: e.textContent?.trim().slice(0, 80) })));
        rec("role-dialog-fields", opts);
      } else rec("role-dialog", "NO [role=dialog] appeared");
      await shot(page, "12-assign-role-dialog");
      // try to open the branch picker inside the dialog
      const combos = page.locator('[role="dialog"] [role="combobox"]');
      const n = await combos.count();
      rec("dialog-combobox-count", n);
      for (let i = 0; i < n; i++) {
        await combos.nth(i).click();
        await page.waitForTimeout(1200);
        const items = await page.locator('[role="option"]').allInnerTexts().catch(() => []);
        rec(`dialog-combobox-${i}-options`, items);
        await shot(page, `13-dialog-combobox-${i}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
      }
      await page.keyboard.press("Escape");
      break;
    }
  }

  // ---- add user dialog: is a branch selectable? -------------------------------------------
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const add = page.locator('button:has-text("Add user")').first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(2500);
    const dlg = page.locator('[role="dialog"]').first();
    rec("adduser-dialog-box", await dlg.boundingBox().catch(() => null));
    rec("adduser-dialog-text", await dlg.innerText().catch(() => "(none)"));
    await shot(page, "14-add-user-dialog");
    const combos = page.locator('[role="dialog"] [role="combobox"]');
    const n = await combos.count();
    for (let i = 0; i < n; i++) {
      await combos.nth(i).click();
      await page.waitForTimeout(1200);
      rec(`adduser-combobox-${i}`, await page.locator('[role="option"]').allInnerTexts().catch(() => []));
      await shot(page, `15-adduser-combobox-${i}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
    await page.keyboard.press("Escape");
  }

  writeFileSync(`${OUT}/transcript-2.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
main();
