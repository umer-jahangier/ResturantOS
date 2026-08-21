/*
 * RECHECK A — the whole "new restaurant" chain, driven in one Chromium session:
 *   SuperAdmin creates the tenant  ->  owner's forced password change  ->  owner's TOTP enrolment
 *   COMPLETED (the step the first audit never did)  ->  owner signs in  ->  reload survives.
 *
 * The first audit called provisioning WORKS and enrolment PARTIAL without ever finishing enrolment.
 * If the happy path does not complete, "WORKS" on provisioning is a lie: the tenant is a shell no
 * human can enter.
 */
import { launch, login, OUT, BASE, totpNow, api } from "./rc-lib.mjs";
import { writeFileSync } from "node:fs";

const STAMP = Date.now().toString().slice(-6);
const BRAND = `Recheck Grill ${STAMP}`;
const EMAIL = `owner@recheck-grill-${STAMP}.local`;
const SLUG = `recheck-grill-${STAMP}`;
const NEWPW = "Recheck#Owner1";

const { browser, page, net } = await launch();
const record = { brand: BRAND, email: EMAIL, slug: SLUG, password: NEWPW };

try {
  // ── 1. SuperAdmin creates the tenant ────────────────────────────────────────────────
  await login(page, "superadmin");
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /create tenant/i }).first().click();
  await page.waitForTimeout(1500);

  const dlg = page.locator('[role="dialog"]').last();
  const box = await dlg.boundingBox();
  console.log("DIALOG BOX:", JSON.stringify(box));
  if (!box || box.width < 200) throw new Error(`dialog is ${box?.width}px wide — the 24px trap`);

  await page.locator("#brand-name").first().fill(BRAND);
  await page.locator("#admin-email").first().fill(EMAIL);
  await page.locator("#tier").first().selectOption("GROWTH");
  await page.screenshot({ path: `${OUT}/A1-create-filled.png`, fullPage: true });
  await dlg.getByRole("button", { name: /create tenant/i }).click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/A2-after-create.png`, fullPage: true });

  const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("AFTER CREATE TEXT:", after.slice(0, 1400));
  const codeEls = await page.locator("code, pre, [data-testid*=password]").allInnerTexts();
  console.log("CODE ELEMENTS:", JSON.stringify(codeEls.slice(0, 12)));
  const tempPw = codeEls.map((s) => s.trim()).find((s) => /^[^\s]{10,40}$/.test(s) && /[A-Z]/.test(s) && /\d/.test(s));
  console.log("TEMP PASSWORD READ FROM UI:", tempPw ?? "NOT FOUND");
  if (!tempPw) throw new Error("no temp password on screen — cannot continue as the owner");
  record.tempPassword = tempPw;

  // Real slug as the console shows it
  const slugMatch = after.match(/recheck-grill-\d+/);
  if (slugMatch) record.slug = slugMatch[0];
  console.log("SLUG:", record.slug);

  // ── 2. Owner first login: forced password change ────────────────────────────────────
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p2 = await ctx2.newPage();
  p2.on("response", (r) => {
    if (r.url().includes("/api/v1/auth")) console.log(`   [net] ${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]}`);
  });
  await p2.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(2000);
  await p2.locator('input[name="tenantSlug"], input#tenantSlug').first().fill(record.slug);
  await p2.locator('input[name="email"], input#email').first().fill(EMAIL);
  await p2.locator('input[name="password"], input#password').first().fill(tempPw);
  await p2.locator('button[type="submit"]').first().click();
  await p2.waitForTimeout(6000);
  await p2.screenshot({ path: `${OUT}/A3-after-first-login.png`, fullPage: true });
  console.log("URL after first login:", p2.url());
  console.log("BODY:", (await p2.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700));

  if (!p2.url().includes("change-password")) throw new Error("no forced password change screen");
  const pwFields = p2.locator('input[type="password"]');
  const n = await pwFields.count();
  console.log("password fields on change screen:", n);
  // current, new, confirm
  if (n >= 3) {
    await pwFields.nth(0).fill(tempPw);
    await pwFields.nth(1).fill(NEWPW);
    await pwFields.nth(2).fill(NEWPW);
  } else {
    await pwFields.nth(0).fill(NEWPW);
    await pwFields.nth(1).fill(NEWPW);
  }
  await p2.screenshot({ path: `${OUT}/A4-change-password-filled.png`, fullPage: true });
  await p2.locator('button[type="submit"]').first().click();
  await p2.waitForTimeout(6000);
  await p2.screenshot({ path: `${OUT}/A5-after-change.png`, fullPage: true });
  console.log("URL after change:", p2.url());
  console.log("BODY:", (await p2.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500));

  // ── 3. Second login -> TOTP enrolment, COMPLETED this time ──────────────────────────
  await p2.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(2000);
  await p2.locator('input[name="tenantSlug"], input#tenantSlug').first().fill(record.slug);
  await p2.locator('input[name="email"], input#email').first().fill(EMAIL);
  await p2.locator('input[name="password"], input#password').first().fill(NEWPW);
  await p2.locator('button[type="submit"]').first().click();
  await p2.waitForTimeout(6000);
  await p2.screenshot({ path: `${OUT}/A6-second-login.png`, fullPage: true });
  console.log("URL:", p2.url());
  console.log("BODY:", (await p2.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700));

  const enroll = p2.locator('[data-testid="totp-enrollment"]');
  console.log("TOTP ENROLMENT PANEL PRESENT:", await enroll.count());
  if (await enroll.count()) {
    await p2.locator('[data-testid="totp-enroll-start"]').click();
    await p2.waitForTimeout(4000);
    await p2.screenshot({ path: `${OUT}/A7-totp-secret.png`, fullPage: true });
    const secretText = (await p2.locator('[data-testid="totp-secret"]').innerText()).replace(/\s+/g, "");
    console.log("SECRET SHOWN:", secretText);
    record.totp = secretText;
    // The step the first audit never took.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = totpNow(secretText);
      await p2.locator('[data-testid="totp-enroll-code"]').fill(code);
      await p2.locator('[data-testid="totp-enroll-verify"]').click();
      await p2.waitForTimeout(5000);
      const t = (await p2.locator("body").innerText()).replace(/\s+/g, " ");
      console.log(`VERIFY attempt ${attempt + 1} -> ${t.slice(0, 300)}`);
      if (!/wasn't accepted|Setup failed/i.test(t)) break;
      await p2.waitForTimeout(30000);
    }
    await p2.screenshot({ path: `${OUT}/A8-after-verify.png`, fullPage: true });
  }

  // ── 4. Third login: password + code, all the way into the product ───────────────────
  await p2.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(2000);
  await p2.locator('input[name="tenantSlug"], input#tenantSlug').first().fill(record.slug);
  await p2.locator('input[name="email"], input#email').first().fill(EMAIL);
  await p2.locator('input[name="password"], input#password').first().fill(NEWPW);
  await p2.locator('button[type="submit"]').first().click();
  await p2.waitForTimeout(6000);
  const totpField = p2.locator('input[name="totpCode"], input#totpCode');
  console.log("TOTP CODE FIELD AT LOGIN:", await totpField.count());
  if (await totpField.count()) {
    await totpField.first().fill(totpNow(record.totp));
    await p2.locator('button[type="submit"]').first().click();
    await p2.waitForTimeout(8000);
  }
  await p2.screenshot({ path: `${OUT}/A9-landed.png`, fullPage: true });
  console.log("FINAL URL:", p2.url());
  const landed = (await p2.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("LANDED BODY:", landed.slice(0, 900));
  record.landedUrl = p2.url();

  // Reload survival
  await p2.reload({ waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(5000);
  await p2.screenshot({ path: `${OUT}/A10-after-reload.png`, fullPage: true });
  console.log("AFTER RELOAD URL:", p2.url());
} catch (e) {
  console.error("RECHECK-A FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/A-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/tenant-A.json`, JSON.stringify(record, null, 2));
  console.log("RECORD:", JSON.stringify(record));
  await browser.close();
}
