/**
 * DIAGNOSIS ONLY — tenant lifecycle + platform-wide surfaces.
 * Operates on the tenant created by superadmin-mutations.mjs (Diag Bistro *).
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const PLATFORM = { email: "superadmin@softxlogic.com", password: "Test@123!" };
const TARGET = /^Diag Bistro /;

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); note("  [shot]", n); };
const dismiss = async (page) => {
  for (let i = 0; i < 4; i++) {
    const d = page.locator('[role="dialog"]');
    if (!(await d.count())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
};

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('input#email, input[name="email"]').first().fill(PLATFORM.email);
  await page.locator('input#password, input[name="password"]').first().fill(PLATFORM.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}

async function openTarget(page) {
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const row = page.locator("main a", { hasText: TARGET }).first();
  if (!(await row.count())) { note("!! target tenant not in list"); return false; }
  await row.click();
  await page.waitForTimeout(4000);
  return true;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/platform")) api.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "")}`);
  });

  await login(page);
  if (!(await openTarget(page))) { await browser.close(); return; }
  const tenantUrl = page.url();
  note("target tenant:", tenantUrl);
  const detail = await page.locator("main").innerText();
  await shot(page, "20-target-detail");
  note("DETAIL TEXT (2000):\n" + detail.slice(0, 2000));

  // billing tokens
  note("\n=== Billing / subscription state tokens present in detail ===");
  const found = ["Trial","trial","Past due","PAST_DUE","past_due","Invoice","Billing","Payment","MRR","Renewal","renew","Card","Price","Amount","PKR","$"]
    .filter((w) => detail.includes(w));
  note("found:", JSON.stringify(found));

  // subscription card region
  const subTxt = await page.locator("main").innerText();
  note("\nSTATUS/TIER region:", subTxt.split("Usage")[0].slice(0, 1200));

  // ---------- tier change ----------
  note("\n=== Change tier ===");
  // Pick a DIFFERENT tier first — the submit is disabled while target == current.
  const tierRadio = page.locator('input[type="radio"][value="ENTERPRISE"], input[value="ENTERPRISE"]').first();
  if (await tierRadio.count()) { await tierRadio.check().catch(() => {}); note("selected ENTERPRISE via radio"); }
  else {
    const lbl = page.locator("main label", { hasText: /^ENTERPRISE$/ }).first();
    if (await lbl.count()) { await lbl.click(); note("selected ENTERPRISE via label"); }
    const sel = page.locator("main select").first();
    if (await sel.count()) { await sel.selectOption("ENTERPRISE").catch(() => {}); note("selected ENTERPRISE via select"); }
  }
  await page.waitForTimeout(1200);
  const tierBtn = page.locator('[data-testid="change-tier-submit"]').first();
  if (await tierBtn.count()) {
    const label = await tierBtn.innerText();
    note("submit enabled?", await tierBtn.isEnabled());
    note("clicking:", label);
    await tierBtn.click();
    await page.waitForTimeout(2000);
    const d = page.locator('[role="dialog"]');
    if (await d.count()) {
      note("tier dialog box:", JSON.stringify(await d.first().boundingBox()));
      note("tier dialog:\n" + (await d.first().innerText()).slice(0, 1000));
      await shot(page, "21-tier-dialog");
      const inp = d.first().locator('input[type="text"], input:not([type]):not([type=checkbox])').first();
      if (await inp.count()) { const ph = await inp.getAttribute("placeholder"); note("confirm placeholder:", ph); if (ph) await inp.fill(ph); }
      const go = d.first().locator("button", { hasText: /move|confirm|change/i }).last();
      await go.click().catch((e) => note("confirm click failed", e.message.slice(0,80)));
      await page.waitForTimeout(5000);
    } else { await page.waitForTimeout(4000); }
    await dismiss(page);
    note("after tier:\n" + (await page.locator("main").innerText()).slice(0, 500));
    await shot(page, "22-after-tier");
  } else note("!! no Move-to-tier button");

  // ---------- module toggle ----------
  note("\n=== Toggle FEATURE_CRM ===");
  const crmRow = () => page.locator("main tr", { hasText: "FEATURE_CRM" }).first();
  if (await crmRow().count()) {
    note("before:", (await crmRow().innerText()).replace(/\s*\n+\s*/g, " | "));
    const b = crmRow().locator("button").first();
    const lbl = await b.innerText();
    await b.click();
    await page.waitForTimeout(4000);
    await dismiss(page);
    await page.waitForTimeout(1500);
    note(`clicked "${lbl}" -> after:`, (await crmRow().innerText()).replace(/\s*\n+\s*/g, " | "));
    await shot(page, "23-crm-toggled");
    const rowBtns = await crmRow().locator("button").allInnerTexts();
    note("FEATURE_CRM row buttons now:", JSON.stringify(rowBtns));
  }

  // ---------- impersonation / users ----------
  note("\n=== Impersonation & tenant user controls ===");
  const all = await page.locator("main button, main a").allInnerTexts();
  const uniq = [...new Set(all.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean))];
  note("EVERY control on tenant detail:", JSON.stringify(uniq));
  note("impersonate present:", uniq.some((t) => /impersonat|sign in as|view as|support/i.test(t)));
  note("reset-password present:", uniq.some((t) => /reset password/i.test(t)));
  note("tenant users list present:", uniq.some((t) => /^users?$/i.test(t) || /manage users/i.test(t)));
  note("delete present:", uniq.some((t) => /delete|purge|terminate/i.test(t)));

  // ---------- suspend ----------
  note("\n=== Suspend ===");
  const s = page.locator("main button", { hasText: /^Suspend$/i }).first();
  if (await s.count()) {
    await s.click(); await page.waitForTimeout(2000);
    const d = page.locator('[role="dialog"]').first();
    note("suspend dialog box:", JSON.stringify(await d.boundingBox().catch(() => null)));
    const dt = await d.innerText().catch(() => "(none)");
    note("suspend dialog:\n" + dt.slice(0, 1200));
    const flds = await d.locator("input, textarea, select").evaluateAll((e) => e.map((x) => `${x.tagName}#${x.id || x.name || "?"}[${x.getAttribute("placeholder") || ""}]`));
    note("suspend fields:", JSON.stringify(flds));
    await shot(page, "24-suspend-dialog");
    const inp = d.locator("input").first();
    if (await inp.count()) { const ph = await inp.getAttribute("placeholder"); if (ph) await inp.fill(ph); }
    await d.locator("button", { hasText: /suspend/i }).last().click().catch((e) => note("click fail", e.message.slice(0,60)));
    await page.waitForTimeout(5000);
    await dismiss(page);
    note("after suspend:\n" + (await page.locator("main").innerText()).slice(0, 500));
    await shot(page, "25-after-suspend");
  }

  // ---------- reactivate ----------
  note("\n=== Reactivate ===");
  const r = page.locator("main button", { hasText: /reactivate|resume|unsuspend/i }).first();
  if (await r.count()) {
    await r.click(); await page.waitForTimeout(2000);
    const d = page.locator('[role="dialog"]');
    if (await d.count()) {
      const inp = d.first().locator("input").first();
      if (await inp.count()) { const ph = await inp.getAttribute("placeholder"); if (ph) await inp.fill(ph); }
      await d.first().locator("button", { hasText: /reactivat|resume|confirm/i }).last().click().catch(() => {});
    }
    await page.waitForTimeout(5000); await dismiss(page);
    note("after reactivate:\n" + (await page.locator("main").innerText()).slice(0, 400));
    await shot(page, "26-after-reactivate");
  } else note("!! NO reactivate control after suspending");

  // ---------- delete ----------
  note("\n=== Delete ===");
  const del = page.locator("main button", { hasText: /delete|purge|terminate/i }).first();
  if (await del.count()) {
    note("delete button:", await del.innerText());
    await del.click(); await page.waitForTimeout(2000);
    const d = page.locator('[role="dialog"]').first();
    note("delete dialog:\n" + (await d.innerText().catch(() => "(none)")).slice(0, 900));
    await shot(page, "27-delete-dialog");
    const inp = d.locator("input").first();
    if (await inp.count()) { const ph = await inp.getAttribute("placeholder"); note("type-to-confirm:", ph); if (ph) await inp.fill(ph); }
    await d.locator("button", { hasText: /delete|purge/i }).last().click().catch(() => {});
    await page.waitForTimeout(5000); await dismiss(page);
    note("after delete, url:", page.url());
    note("after delete:\n" + (await page.locator("main").innerText()).slice(0, 500));
    await shot(page, "28-after-delete");
  } else note("!! NO delete control on tenant detail");

  // ---------- platform-wide routes ----------
  note("\n=== Platform-wide routes ===");
  for (const r2 of ["/platform/audit","/platform/health","/platform/users","/platform/settings","/platform/billing","/platform/plans","/platform/usage","/platform/tiers"]) {
    const resp = await page.goto(BASE + r2, { waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForTimeout(2000);
    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 130);
    note(`  ${r2} -> HTTP ${resp ? resp.status() : "?"} | ${t}`);
  }

  writeFileSync(`${OUT}/lifecycle-log.txt`, log.join("\n"));
  writeFileSync(`${OUT}/lifecycle-api.txt`, api.join("\n"));
  note("\n=== API ===\n" + api.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); writeFileSync(`${OUT}/lifecycle-log.txt`, log.join("\n") + "\nFATAL " + e.message); process.exit(1); });
