/*
 * RECHECK F — restore FEATURE_HR, then re-drive the onboarding route probes cleanly as the OWNER
 * with an explicit session-alive assertion before every probe (my first pass was killed by a 429
 * and reported the login page as "EXISTS" — exactly the trap this audit is meant to avoid).
 * argv: <ownerEmail> <ownerPassword> <ownerTotp> <brandName>
 */
import { launch, login, loginAs, OUT, BASE } from "./rc-lib.mjs";

const OWNER = { slug: "", email: process.argv[2], password: process.argv[3], totp: process.argv[4] };
const BRAND = process.argv[5];

const { browser, page } = await launch();
try {
  // ── restore the module ─────────────────────────────────────────────────────────────
  await login(page, "superadmin");
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await page.getByText(BRAND, { exact: false }).first().click();
  await page.waitForTimeout(5000);
  const row = () => page.locator("tr", { hasText: "FEATURE_HR" }).first();
  console.log("FEATURE_HR now:", (await row().innerText()).replace(/\s+/g, " "));
  const revert = row().getByRole("button", { name: /revert/i });
  if (await revert.count()) {
    await revert.first().click();
    await page.waitForTimeout(3000);
    const dlg = page.locator('[role="dialog"], [role="alertdialog"]').last();
    if (await dlg.count()) {
      const box = dlg.locator("input").first();
      if (await box.count()) await box.fill(BRAND);
      await dlg.locator('[data-testid="confirm-destructive-submit"], button:has-text("Revert")').last().click().catch(() => {});
      await page.waitForTimeout(5000);
    }
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  console.log("FEATURE_HR restored to:", (await row().innerText()).replace(/\s+/g, " "));

  // What can a SuperAdmin actually EDIT about a tenant?
  const edit = page.getByRole("button", { name: /^edit$/i });
  if (await edit.count()) {
    await edit.first().click();
    await page.waitForTimeout(2500);
    const d = page.locator('[role="dialog"]').last();
    console.log("EDIT DIALOG BOX:", JSON.stringify(await d.boundingBox()));
    console.log("EDIT DIALOG TEXT:", (await d.innerText()).replace(/\s+/g, " ").slice(0, 700));
    const f = await d.locator("input, select, textarea").evaluateAll((els) => els.map((e) => ({ id: e.id, name: e.name, type: e.type })));
    console.log("EDIT DIALOG FIELDS:", JSON.stringify(f));
    await page.screenshot({ path: `${OUT}/H1-tenant-edit-dialog.png`, fullPage: true });
    await page.keyboard.press("Escape");
  }
} catch (e) {
  console.error("RESTORE FAILED:", e.message);
} finally {
  await browser.close();
}

// ── clean route probes as the owner ──────────────────────────────────────────────────
const b2 = await launch();
try {
  await loginAs(b2.page, OWNER, "owner");
  const p = b2.page;
  const ROUTES = [
    "/app/onboarding", "/app/setup", "/app/getting-started", "/app/welcome",
    "/app/settings/tax", "/app/settings/business", "/app/settings/general",
    "/app/settings/branches", "/app/branches", "/app/settings/company",
    "/app/settings/currency", "/app/settings/receipt", "/app/settings/hours",
    "/onboarding", "/setup", "/welcome", "/signup", "/register", "/app/settings/tenant",
  ];
  for (const r of ROUTES) {
    // Session-alive assertion FIRST: a dead session renders the login card and every probe lies.
    await p.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2500);
    if (p.url().includes("/login")) { console.log(`  SESSION DEAD before ${r} — skipping (would have lied)`); break; }
    await p.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(3000);
    const t = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    const onLogin = p.url().includes("/login") || /Sign in to RestaurantOS/.test(t);
    const is404 = /This page doesn't exist|Page not found/i.test(t);
    const denied = /Access denied/i.test(t);
    console.log(`  ${r.padEnd(26)} -> ${onLogin ? "SESSION-LOST(invalid probe)" : is404 ? "404" : denied ? "DENIED" : "EXISTS"}`);
    if (!onLogin && !is404) {
      await p.screenshot({ path: `${OUT}/H2-probe${r.replace(/\//g, "_")}.png`, fullPage: true });
      console.log(`      "${t.slice(0, 260)}"`);
    }
    await p.waitForTimeout(1200);
  }
} catch (e) {
  console.error("PROBE FAILED:", e.message);
} finally {
  await b2.browser.close();
}
