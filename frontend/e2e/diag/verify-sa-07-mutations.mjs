// Re-drive the console's three claimed-working capabilities END TO END, with reload-persistence.
// Creates ONE throwaway tenant, mutates only that, then leaves it for the caller to purge.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const SUFFIX = String(Date.now()).slice(-6);
const NAME = `Verify Bistro ${SUFFIX}`;
const SLUG = `verify-bistro-${SUFFIX}`;

const st = async (p) => await p.evaluate(() => { const t = document.body.innerText.replace(/\s+/g," ");
  return /Sign in to RestaurantOS/.test(t) ? "LOGGED_OUT" : (/doesn't exist/.test(t) ? "404" : "OK"); });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.locator('input#email, input[name=email]').first().fill("superadmin@softxlogic.com");
  await page.locator('input#password, input[name=password]').first().fill("Test@123!");
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(4000);
}
// Navigate, and transparently recover from the refresh-race logout so the audit isn't measuring a dead session.
async function go(page, route, waitMs = 3500) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs);
    const s = await st(page);
    if (s !== "LOGGED_OUT") return s;
    P(`     !! session died navigating to ${route} (attempt ${attempt}) — re-logging in`);
    await login(page);
  }
  return "LOGGED_OUT";
}
const shot = async (page, n) => { await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); P("     shot:", n); };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", r => { const u = r.url(); if (u.includes("/api/v1/platform")) api.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080","")}`); });
  await login(page);
  P("== signed in ==");

  // ---------- 1. CREATE TENANT ----------
  P("\n=== 1. CREATE TENANT via UI ===");
  await go(page, "/platform/tenants");
  await page.locator('button:has-text("Create tenant")').first().click();
  await page.waitForTimeout(1500);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]');
    if (!d) return { found: false };
    const r = d.getBoundingClientRect();
    return { found: true, w: Math.round(r.width), h: Math.round(r.height),
      fields: [...d.querySelectorAll("input,select,textarea")].map(i => `${i.tagName}#${i.id || i.name || "?"}`),
      buttons: [...d.querySelectorAll("button")].map(b => b.textContent.trim()) };
  });
  P("  dialog:", JSON.stringify(dlg));   // the ~24px-wide dialog trap
  await shot(page, "07-create-dialog");
  const fill = async (sel, val) => { const l = page.locator(sel); if (await l.count()) { await l.first().fill(val); return true; } return false; };
  P("  brand-name:", await fill('[role=dialog] input#brand-name', NAME));
  P("  admin-email:", await fill('[role=dialog] input#admin-email', `admin@${SLUG}.local`));
  const tierSel = page.locator('[role=dialog] select#tier');
  if (await tierSel.count()) { await tierSel.selectOption("GROWTH").catch(async () => { await tierSel.selectOption({ index: 1 }); }); P("  tier: selected"); }
  await page.waitForTimeout(800);
  // The slug is derived, not typed — record what the dialog says it will be.
  P("  dialog text:", (await page.locator('[role=dialog]').first().innerText()).replace(/\s+/g, " ").slice(0, 320));
  await shot(page, "07-create-filled");
  const submit = page.locator('[data-testid=create-tenant-submit]');
  P("  submit enabled:", await submit.isEnabled());
  await submit.click({ timeout: 15000 });
  await page.waitForTimeout(9000);
  await shot(page, "07-after-create");
  const created = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 900));
  P("  after create:", created.slice(0, 500));

  // ---------- 2. PERSISTENCE OF CREATE ----------
  P("\n=== 2. does the new tenant survive a reload of the LIST? ===");
  P("  list state:", await go(page, "/platform/tenants"));
  const found = await page.evaluate((s) => {
    const rows = [...document.querySelectorAll("tbody tr")];
    const hit = rows.find(r => r.innerText.includes(s));
    return hit ? { present: true, row: hit.innerText.replace(/\s+/g, " "), href: hit.querySelector("a")?.getAttribute("href") } : { present: false, count: rows.length };
  }, SUFFIX);
  P("  " + JSON.stringify(found));
  if (!found.present) { P("  !! created tenant NOT in list — aborting deeper tests"); writeFileSync(`${OUT}/log-07.txt`, log.join("\n")); await browser.close(); return; }
  const tid = found.href.split("/").pop();
  P("  tenantId =", tid);
  writeFileSync(`${OUT}/created-tenant.txt`, `${SLUG}\n${tid}\n`);

  // ---------- 3. TIER CHANGE + PERSISTENCE ----------
  P("\n=== 3. TIER CHANGE ===");
  await go(page, `/platform/tenants/${tid}`);
  const before = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
  P("  before:", before.slice(0, 260));
  const tierBtn = page.locator('button:has-text("Move to")');
  P("  tier buttons visible:", await tierBtn.count(), await tierBtn.first().textContent().catch(() => ""));
  // pick STARTER (a real downgrade so limits must change)
  const starter = page.locator('label:has-text("STARTER"), button:has-text("STARTER"), [role=radio]:has-text("STARTER")').first();
  if (await starter.count()) { await starter.click(); await page.waitForTimeout(900); }
  P("  after selecting STARTER, button reads:", await page.locator('button:has-text("Move to")').first().textContent().catch(() => "n/a"));
  await shot(page, "07-tier-selected");
  const mv = page.locator('button:has-text("Move to")').first();
  if (await mv.count() && await mv.isEnabled()) {
    await mv.click(); await page.waitForTimeout(2500);
    // a confirm dialog may appear
    const cd = page.locator('[role=dialog]');
    if (await cd.count()) {
      P("  confirm dialog appeared:", (await cd.first().innerText()).replace(/\s+/g, " ").slice(0, 240));
      await shot(page, "07-tier-confirm");
      const ri = cd.locator("input").first();
      if (await ri.count()) { await ri.fill("STARTER"); await page.waitForTimeout(400); }
      const ok = cd.locator('button:has-text("Move"), button:has-text("Confirm"), button[type=submit]').last();
      if (await ok.count()) { await ok.click(); await page.waitForTimeout(3500); }
    }
  } else P("  !! tier button missing or disabled");
  await shot(page, "07-after-tier");
  P("  RELOAD to test persistence…");
  await go(page, `/platform/tenants/${tid}`);
  const afterTier = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 500));
  P("  after reload:", afterTier.slice(0, 330));

  // ---------- 4. MODULE TOGGLE + PERSISTENCE ----------
  P("\n=== 4. MODULE TOGGLE ===");
  const mods = await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => /Enable|Disable|Revert/.test(t)).length);
  P("  module buttons on page:", mods);
  const firstDisable = page.locator('button:has-text("Disable")').first();
  if (await firstDisable.count()) {
    const row = await firstDisable.evaluate(b => (b.closest("li,tr,div[class*=flex]")?.innerText || "").replace(/\s+/g, " ").slice(0, 80));
    P("  clicking Disable on:", row);
    await firstDisable.click(); await page.waitForTimeout(2000);
    const cd2 = page.locator('[role=dialog]');
    if (await cd2.count()) {
      P("  confirm:", (await cd2.first().innerText()).replace(/\s+/g, " ").slice(0, 200));
      const ri2 = cd2.locator("input").first();
      if (await ri2.count()) await ri2.fill("disable");
      const ok2 = cd2.locator('button:has-text("Disable"), button[type=submit]').last();
      if (await ok2.count()) { await ok2.click(); await page.waitForTimeout(3000); }
    }
    await shot(page, "07-module-disabled");
    P("  RELOAD to test persistence…");
    await go(page, `/platform/tenants/${tid}`);
    const st2 = await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => /Enable|Revert/.test(t)));
    P("  after reload, Enable/Revert buttons present:", JSON.stringify(st2.slice(0, 8)));
  } else P("  !! no Disable button found");

  // ---------- 5. SUBSCRIPTION EDIT ----------
  P("\n=== 5. SUBSCRIPTION EDIT (billing fields) ===");
  const edit = page.locator('button:has-text("Edit")').first();
  if (await edit.count()) {
    await edit.click(); await page.waitForTimeout(1500);
    const form = await page.evaluate(() => {
      const ins = [...document.querySelectorAll("input")].map(i => `${i.id || i.name}:${i.type}`);
      return ins;
    });
    P("  editable inputs on page:", JSON.stringify(form));
    await shot(page, "07-subscription-edit");
    const br = page.locator('input#billing-ref');
    if (await br.count()) {
      await br.fill(`DIAG-${SUFFIX}`);
      const re = page.locator('input#renews-at'); if (await re.count()) await re.fill("2027-01-31");
      const save = page.locator('button:has-text("Save")').first();
      if (await save.count()) { await save.click(); await page.waitForTimeout(2500); }
      P("  RELOAD to test persistence…");
      await go(page, `/platform/tenants/${tid}`);
      const sub = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").match(/Subscription.{0,220}/)?.[0] || "n/a");
      P("  subscription card after reload:", sub);
      await shot(page, "07-subscription-after");
    } else P("  !! no #billing-ref input");
  }

  writeFileSync(`${OUT}/api-07.txt`, api.join("\n"));
  writeFileSync(`${OUT}/log-07.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-07.txt`, log.join("\n")+"\nFATAL "+e); process.exit(1); });
