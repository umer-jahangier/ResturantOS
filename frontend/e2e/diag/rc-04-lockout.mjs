/*
 * RECHECK C — is the self-lockout real, and is it recoverable through ANY product surface?
 *
 * Creates a second fresh tenant, does the forced password change, presses "Generate my key",
 * then DISCARDS the key (the real-world "closed the tab" case). Then hunts for a way back in:
 *   - the login card itself (bootstrap again / forgot password / any escape hatch)
 *   - the SuperAdmin platform console, tenant detail page, every control it offers
 */
import { launch, login, OUT, BASE, api } from "./rc-lib.mjs";
import { writeFileSync } from "node:fs";

const STAMP = Date.now().toString().slice(-6);
const BRAND = `Lockout Cafe ${STAMP}`;
const EMAIL = `owner@lockout-cafe-${STAMP}.local`;
const NEWPW = "Lockout#Owner1";
const rec = { brand: BRAND, email: EMAIL, password: NEWPW };

const { browser, page } = await launch();
try {
  // ── 1. provision ───────────────────────────────────────────────────────────────────
  await login(page, "superadmin");
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /create tenant/i }).first().click();
  await page.waitForTimeout(1500);
  await page.locator("#brand-name").first().fill(BRAND);
  await page.locator("#admin-email").first().fill(EMAIL);
  await page.locator("#tier").first().selectOption("STARTER");
  await page.locator('[role="dialog"]').last().getByRole("button", { name: /create tenant/i }).click();
  await page.waitForTimeout(8000);
  const codeEls = await page.locator("code, pre").allInnerTexts();
  const temp = codeEls.map((s) => s.trim()).find((s) => /^[^\s]{10,40}$/.test(s));
  console.log("TEMP:", temp);
  rec.temp = temp;

  // ── 2. owner: change password, bootstrap, then WALK AWAY ───────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  p.on("response", (r) => {
    if (r.url().includes("/api/v1/auth")) console.log(`   [net] ${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]}`);
  });
  const doLogin = async (pw) => {
    await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2500);
    await p.locator('input[name="email"], input#email').first().fill(EMAIL);
    await p.locator('input[name="password"], input#password').first().fill(pw);
    await p.locator('button[type="submit"]').first().click();
    await p.waitForTimeout(7000);
  };
  await doLogin(temp);
  const pw = p.locator('input[type="password"]');
  await pw.nth(0).fill(temp); await pw.nth(1).fill(NEWPW); await pw.nth(2).fill(NEWPW);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForTimeout(7000);

  await doLogin(NEWPW);
  await p.locator('[data-testid="totp-enroll-start"]').click();
  await p.waitForTimeout(5000);
  const shown = (await p.locator('[data-testid="totp-secret"]').innerText()).replace(/\s+/g, "");
  console.log("KEY WAS SHOWN (and is now being deliberately discarded):", shown.slice(0, 6) + "…");
  await p.screenshot({ path: `${OUT}/C1-key-shown.png`, fullPage: true });

  // ── 3. the user closes the tab. Come back with nothing but the password. ────────────
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const q = await ctx2.newPage();
  q.on("response", (r) => {
    if (r.url().includes("/api/v1/auth")) console.log(`   [net] ${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]}`);
  });
  await q.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await q.waitForTimeout(2500);
  await q.locator('input[name="email"], input#email').first().fill(EMAIL);
  await q.locator('input[name="password"], input#password').first().fill(NEWPW);
  await q.locator('button[type="submit"]').first().click();
  await q.waitForTimeout(7000);
  await q.screenshot({ path: `${OUT}/C2-locked-out.png`, fullPage: true });
  const t = (await q.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("LOCKED-OUT LOGIN CARD:", t.slice(0, 900));
  rec.lockedOutText = t.slice(0, 700);

  // Every escape hatch the login page offers
  const links = await q.locator("a, button").allInnerTexts();
  console.log("EVERY CONTROL ON THE LOGIN CARD:", JSON.stringify(links.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)));
  console.log("ENROLMENT PANEL OFFERED AGAIN?", await q.locator('[data-testid="totp-enrollment"]').count());
  console.log("FORGOT-PASSWORD AFFORDANCE?", await q.getByText(/forgot|reset your password|can't sign in|trouble/i).count());

  // Direct API: can enrolment be restarted?
  const boot = await api("POST", "/api/v1/auth/2fa/bootstrap", null, { email: EMAIL, password: NEWPW, tenantSlug: rec.slug ?? "" });
  console.log("RE-BOOTSTRAP:", boot.status, boot.text.slice(0, 250));
  rec.rebootstrap = `${boot.status} ${boot.text.slice(0, 200)}`;

  // ── 4. can a SuperAdmin rescue them from the console? ───────────────────────────────
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const row = page.locator(`a[href*="/platform/tenants/"]`).first();
  const hrefs = await page.locator('a[href*="/platform/tenants/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  console.log("TENANT LINKS:", JSON.stringify(hrefs.slice(0, 4)));
  // find the one for this brand
  await page.getByText(BRAND).first().click().catch(() => {});
  await page.waitForTimeout(4000);
  if (!page.url().includes("/platform/tenants/")) { await row.click(); await page.waitForTimeout(4000); }
  await page.screenshot({ path: `${OUT}/C3-tenant-detail.png`, fullPage: true });
  console.log("TENANT DETAIL URL:", page.url());
  const detail = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("TENANT DETAIL TEXT:", detail.slice(0, 1800));
  const btns = await page.locator("button, a[role=button]").allInnerTexts();
  console.log("EVERY CONTROL ON TENANT DETAIL:", JSON.stringify(btns.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)));
  console.log("ANY 2FA / RESET CONTROL?", await page.getByText(/two.factor|2fa|reset|unlock|impersonat/i).count());
  console.log("ANY USER LIST ON THE PLATFORM SIDE?", await page.getByText(/users?/i).count());
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/C-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/tenant-C.json`, JSON.stringify(rec, null, 2));
  console.log("RECORD:", JSON.stringify(rec));
  await browser.close();
}
