/*
 * RECHECK A2 — day one for the owner of the tenant rc-01 created.
 * Login is email + password only (the slug field is an escape hatch behind a link).
 *
 * argv: <email> <tempPassword> <newPassword>
 */
import { launch, OUT, BASE, totpNow } from "./rc-lib.mjs";
import { writeFileSync } from "node:fs";

const EMAIL = process.argv[2];
const TEMP = process.argv[3];
const NEWPW = process.argv[4] ?? "Recheck#Owner1";
const record = { email: EMAIL, password: NEWPW };

async function fillLogin(p, email, password) {
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);
  await p.locator('input[name="email"], input#email').first().fill(email);
  await p.locator('input[name="password"], input#password').first().fill(password);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForTimeout(7000);
}

const { browser, page } = await launch();
page.on("response", (r) => {
  if (r.url().includes("/api/v1/auth")) console.log(`   [net] ${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]}`);
});

try {
  // ── forced password change ─────────────────────────────────────────────────────────
  await fillLogin(page, EMAIL, TEMP);
  await page.screenshot({ path: `${OUT}/A3-after-first-login.png`, fullPage: true });
  console.log("URL after first login:", page.url());
  console.log("BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600));

  if (page.url().includes("change-password")) {
    const pw = page.locator('input[type="password"]');
    const n = await pw.count();
    console.log("password inputs:", n);
    if (n >= 3) { await pw.nth(0).fill(TEMP); await pw.nth(1).fill(NEWPW); await pw.nth(2).fill(NEWPW); }
    else { await pw.nth(0).fill(NEWPW); await pw.nth(1).fill(NEWPW); }
    await page.screenshot({ path: `${OUT}/A4-change-filled.png`, fullPage: true });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${OUT}/A5-after-change.png`, fullPage: true });
    console.log("URL after change:", page.url());
    console.log("BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500));
    record.forcedChange = "reached and submitted";
  } else {
    record.forcedChange = "NOT SHOWN";
  }

  // ── second login -> TOTP enrolment, completed ──────────────────────────────────────
  await fillLogin(page, EMAIL, NEWPW);
  await page.screenshot({ path: `${OUT}/A6-second-login.png`, fullPage: true });
  console.log("URL:", page.url());
  console.log("BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700));

  const enroll = page.locator('[data-testid="totp-enrollment"]');
  record.enrolPanel = (await enroll.count()) > 0;
  console.log("TOTP ENROLMENT PANEL:", record.enrolPanel);
  if (record.enrolPanel) {
    await page.locator('[data-testid="totp-enroll-start"]').click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/A7-totp-secret.png`, fullPage: true });
    const secret = (await page.locator('[data-testid="totp-secret"]').innerText()).replace(/\s+/g, "");
    console.log("SECRET SHOWN ON SCREEN:", secret);
    record.totp = secret;
    writeFileSync(`${OUT}/tenant-A.json`, JSON.stringify(record, null, 2));

    for (let i = 0; i < 3; i++) {
      await page.locator('[data-testid="totp-enroll-code"]').fill(totpNow(secret));
      await page.locator('[data-testid="totp-enroll-verify"]').click();
      await page.waitForTimeout(6000);
      const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      console.log(`VERIFY try ${i + 1}: ${t.slice(0, 260)}`);
      if (!/wasn't accepted|Setup failed/i.test(t)) { record.enrolCompleted = true; break; }
      await page.waitForTimeout(31000);
    }
    await page.screenshot({ path: `${OUT}/A8-after-verify.png`, fullPage: true });
  }

  // ── third login: password + code ───────────────────────────────────────────────────
  await fillLogin(page, EMAIL, NEWPW);
  const totpField = page.locator('input[name="totpCode"], input#totpCode, [data-testid="totp-code"]');
  console.log("TOTP FIELD AT LOGIN:", await totpField.count());
  if (await totpField.count()) {
    await totpField.first().fill(totpNow(record.totp));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(9000);
  }
  await page.screenshot({ path: `${OUT}/A9-landed.png`, fullPage: true });
  console.log("FINAL URL:", page.url());
  const landed = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("LANDED BODY:", landed.slice(0, 1000));
  record.landedUrl = page.url();
  record.landedText = landed.slice(0, 600);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/A10-after-reload.png`, fullPage: true });
  console.log("AFTER RELOAD URL:", page.url());
  record.afterReload = page.url();
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/A-FAIL2.png`, fullPage: true }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/tenant-A.json`, JSON.stringify(record, null, 2));
  console.log("RECORD:", JSON.stringify(record));
  await browser.close();
}
