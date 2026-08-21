// Corrected drive of tier change / module toggle / subscription edit, using the real test ids.
// Operates ONLY on the throwaway tenant recorded in created-tenant.txt.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/superadmin-verify";
const BASE = "http://localhost:3000";
const log = []; const P = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const [SLUG, TID] = readFileSync(`${OUT}/created-tenant.txt`, "utf8").trim().split("\n");
const BRAND = "Verify Bistro " + SLUG.split("-").pop();
P(`target: ${BRAND} / ${SLUG} / ${TID}`);

const st = async (p) => await p.evaluate(() => /Sign in to RestaurantOS/.test(document.body.innerText) ? "LOGGED_OUT" : "OK");
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
  await page.locator('input#email, input[name=email], input[type=email]').first().fill("superadmin@softxlogic.com", { timeout: 20000 });
  await page.locator('input#password, input[name=password], input[type=password]').first().fill("Test@123!");
  await page.locator('button[type=submit]').first().click(); await page.waitForTimeout(4000);
}
async function go(page, route, w = 3500) {
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(w);
    if (await st(page) !== "LOGGED_OUT") return true;
    P("     !! session died — re-login"); await login(page);
  }
  return false;
}
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); P("     shot:", n); };
const card = async (p) => await p.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return t.match(/Billing reference.{0,190}/)?.[0] || t.slice(0, 200);
});

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", async r => { const u = r.url(); if (u.includes("/api/v1/platform")) {
    let b = ""; try { if (r.status() >= 400) b = (await r.text()).slice(0, 160); } catch {}
    api.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080","")} ${b}`); } });
  await login(page);

  // ---------- TIER CHANGE ----------
  P("\n=== TIER CHANGE: GROWTH -> STARTER ===");
  await go(page, `/platform/tenants/${TID}`);
  P("  limits before:", await card(page));
  await page.locator('[data-testid=target-tier-select]').selectOption("STARTER");
  await page.waitForTimeout(600);
  const btn = page.locator('[data-testid=change-tier-submit]');
  P("  button:", await btn.textContent(), "| enabled:", await btn.isEnabled());
  await btn.click(); await page.waitForTimeout(4000);
  await shot(page, "08-after-tier-click");
  const refusal = page.locator('[data-testid=tier-refusal]');
  if (await refusal.count()) P("  REFUSAL shown:", (await refusal.innerText()).replace(/\s+/g, " ").slice(0, 300));
  const result = page.locator('[data-testid=tier-change-result]');
  if (await result.count()) P("  result:", (await result.innerText()).replace(/\s+/g, " ").slice(0, 250));
  P("  --- RELOAD ---");
  await go(page, `/platform/tenants/${TID}`);
  P("  limits after reload:", await card(page));
  const tierNow = await page.evaluate(() => document.body.innerText.replace(/\s+/g," ").match(/(STARTER|GROWTH|ENTERPRISE|CUSTOM)/)?.[0]);
  P("  tier badge now:", tierNow);
  await shot(page, "08-tier-persisted");

  // ---------- MODULE TOGGLE ----------
  P("\n=== MODULE TOGGLE (disable one, reload, re-enable) ===");
  const before = await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => /^(Enable|Disable|Revert)$/.test(t)).join(","));
  P("  buttons before:", before.slice(0, 200));
  const dis = page.locator('button:has-text("Disable")').first();
  const modRow = await dis.evaluate(b => { let e = b; for (let i = 0; i < 6 && e; i++) { e = e.parentElement; if (e && /FEATURE_/.test(e.innerText)) return e.innerText.replace(/\s+/g," ").slice(0,70); } return "?"; });
  P("  disabling:", modRow);
  await dis.click(); await page.waitForTimeout(1800);
  const d = page.locator('[data-testid=confirm-destructive]');
  P("  dialog:", (await d.innerText()).replace(/\s+/g, " ").slice(0, 260));
  const box = await d.boundingBox(); P("  dialog size:", JSON.stringify(box && { w: Math.round(box.width), h: Math.round(box.height) }));
  await page.locator('[data-testid=confirm-phrase-input]').fill(BRAND);
  const rIn = page.locator('[data-testid=confirm-reason-input]');
  P("  reason field present:", await rIn.count() > 0);
  if (await rIn.count()) await rIn.fill("diagnosis probe");
  await page.waitForTimeout(500);
  const sub = page.locator('[data-testid=confirm-destructive-submit]');
  P("  submit enabled after typing brand:", await sub.isEnabled());
  await shot(page, "08-module-dialog");
  await sub.click(); await page.waitForTimeout(3500);
  await shot(page, "08-module-after");
  P("  --- RELOAD ---");
  await go(page, `/platform/tenants/${TID}`);
  const after = await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => /^(Enable|Disable|Revert)$/.test(t)).join(","));
  P("  buttons after reload:", after.slice(0, 220));
  P("  changed?", before !== after);
  const overrideText = await page.evaluate(() => document.body.innerText.replace(/\s+/g," ").match(/Overrid\w+.{0,120}/)?.[0] || "no 'override' wording");
  P("  override wording:", overrideText);

  // ---------- SUBSCRIPTION EDIT ----------
  P("\n=== SUBSCRIPTION EDIT ===");
  await page.locator('button:has-text("Edit")').first().click(); await page.waitForTimeout(1500);
  const inputs = await page.evaluate(() => [...document.querySelectorAll("input")].map(i => `${i.id}(${i.type})`));
  P("  inputs:", JSON.stringify(inputs));
  await shot(page, "08-sub-edit");
  const br = page.locator('input#billing-ref');
  if (await br.count()) {
    await br.fill(`DIAG-REF-001`);
    const ra = page.locator('input#renews-at'); if (await ra.count()) await ra.fill("2027-01-31");
    await page.locator('button:has-text("Save")').first().click(); await page.waitForTimeout(3000);
    P("  --- RELOAD ---");
    await go(page, `/platform/tenants/${TID}`);
    P("  subscription after reload:", await card(page));
    await shot(page, "08-sub-persisted");
  }

  // ---------- SUSPEND VIA UI + does the LIST reflect it ----------
  P("\n=== SUSPEND VIA UI ===");
  await page.locator('button:has-text("Suspend")').first().click(); await page.waitForTimeout(1800);
  const sd = page.locator('[data-testid=confirm-destructive]');
  P("  suspend dialog says:", (await sd.innerText()).replace(/\s+/g, " ").slice(0, 400));
  await shot(page, "08-suspend-dialog");
  await page.locator('[data-testid=confirm-phrase-input]').fill(BRAND);
  await page.locator('[data-testid=confirm-reason-input]').fill("diagnosis: verifying suspend");
  await page.waitForTimeout(400);
  await page.locator('[data-testid=confirm-destructive-submit]').click(); await page.waitForTimeout(3500);
  await shot(page, "08-after-suspend");
  await go(page, "/platform/tenants");
  const listRow = await page.evaluate((s) => [...document.querySelectorAll("tbody tr")].find(r => r.innerText.includes(s))?.innerText.replace(/\s+/g, " "), SLUG);
  P("  list row now:", listRow);
  await go(page, "/platform/dashboard");
  P("  dashboard:", (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))).slice(0, 300));
  await shot(page, "08-dashboard-suspended");

  // can the operator find a way to CANCEL/DELETE?
  await go(page, `/platform/tenants/${TID}`);
  const controls = await page.evaluate(() => [...new Set([...document.querySelectorAll("button")].map(b => b.textContent.trim()))]);
  P("\n=== CONTROL INVENTORY on a SUSPENDED tenant ===");
  P("  " + JSON.stringify(controls));

  writeFileSync(`${OUT}/api-08.txt`, api.join("\n"));
  writeFileSync(`${OUT}/log-08.txt`, log.join("\n"));
  await browser.close();
}
main().catch(e => { console.error(e); writeFileSync(`${OUT}/log-08.txt`, log.join("\n")+"\nFATAL "+e); process.exit(1); });
