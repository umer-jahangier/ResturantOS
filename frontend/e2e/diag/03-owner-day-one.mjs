/* Day one as the owner of the tenant just created through the console. */
import { launch, visit, OUT, BASE } from "./onboarding-lib.mjs";
import { createHmac } from "node:crypto";

const SLUG = process.argv[2];
const EMAIL = process.argv[3];
const TEMP = process.argv[4];
const NEWPW = "Diag#Owner1!";

function b32(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of input.replace(/[^A-Za-z2-7]/g, "").toUpperCase()) {
    const i = a.indexOf(c); if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1e6).padStart(6, "0");
}

const { browser, page } = await launch();
page.on("response", async (r) => {
  if (r.url().includes("/api/v1/auth/")) console.log(`   <- ${r.status()} ${r.url().replace("http://localhost:8080", "")}`);
});
try {
  await page.goto(`${BASE}/login?tenant=${SLUG}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/d1-01-login.png`, fullPage: true });
  const slugToggle = page.getByTestId("show-tenant-field");
  if (await slugToggle.count()) { await slugToggle.click(); await page.waitForTimeout(500); }
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(SLUG);
  await page.locator('input[name="email"], input#email').first().fill(EMAIL);
  await page.locator('input[name="password"], input#password').first().fill(TEMP);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  console.log("STEP1 url:", page.url());
  await page.screenshot({ path: `${OUT}/d1-02-after-first-login.png`, fullPage: true });
  console.log("STEP1 body:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600));

  // Forced password change
  if (page.url().includes("change-password")) {
    const pwInputs = page.locator('input[type="password"]');
    const n = await pwInputs.count();
    console.log("  change-password inputs:", n);
    for (let i = 0; i < n; i++) await pwInputs.nth(i).fill(i === 0 && n === 3 ? TEMP : NEWPW);
    await page.screenshot({ path: `${OUT}/d1-03-change-password.png`, fullPage: true });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
    console.log("STEP2 url:", page.url());
    console.log("STEP2 body:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600));
    await page.screenshot({ path: `${OUT}/d1-04-after-change.png`, fullPage: true });
  }

  // Re-login with the new password if we were bounced back
  if (page.url().includes("/login") && !page.url().includes("change-password")) {
    const st = page.getByTestId("show-tenant-field");
    if (await st.count()) { await st.click(); await page.waitForTimeout(400); }
    const sf = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await sf.count()) await sf.first().fill(SLUG);
    const ef = page.locator('input[name="email"], input#email');
    if (await ef.count()) await ef.first().fill(EMAIL);
    await page.locator('input[name="password"], input#password').first().fill(NEWPW);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
    console.log("STEP3 url:", page.url());
    await page.screenshot({ path: `${OUT}/d1-05-second-login.png`, fullPage: true });
    console.log("STEP3 body:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 900));
  }

  // TOTP enrolment, if the app offers it
  const enroll = page.getByTestId("totp-enrollment");
  if (await enroll.count()) {
    console.log("  TOTP ENROLMENT UI PRESENT");
    await page.screenshot({ path: `${OUT}/d1-06-totp-enroll.png`, fullPage: true });
    const start = page.getByTestId("totp-enroll-start");
    if (await start.count()) { await start.click(); await page.waitForTimeout(4000); }
    await page.screenshot({ path: `${OUT}/d1-07-totp-secret.png`, fullPage: true });
    const txt = (await page.locator("body").innerText());
    console.log("  ENROLL BODY:", txt.replace(/\s+/g, " ").slice(0, 900));
    const m =
      txt.match(/\b([A-Z2-7]{4}(?:\s+[A-Z2-7]{4}){3,})\b/) || txt.match(/\b([A-Z2-7]{16,64})\b/);
    if (m) {
      const secret = m[1];
      console.log("  SECRET:", secret);
      await page.getByTestId("totp-enroll-code").fill(totp(secret));
      await page.getByTestId("totp-enroll-verify").click();
      await page.waitForTimeout(7000);
      console.log("STEP4 url:", page.url());
      await page.screenshot({ path: `${OUT}/d1-08-after-enroll.png`, fullPage: true });
      console.log("STEP4 body:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700));
      // may need one more login
      if (page.url().includes("/login")) {
        const tf = page.locator('input[name="totpCode"], input#totpCode');
        if (await tf.count()) {
          await tf.first().fill(totp(secret));
          await page.locator('button[type="submit"]').first().click();
          await page.waitForTimeout(6000);
        } else {
          const st = page.getByTestId("show-tenant-field");
          if (await st.count()) { await st.click(); await page.waitForTimeout(400); }
          const sf = page.locator('input[name="tenantSlug"], input#tenantSlug');
          if (await sf.count()) await sf.first().fill(SLUG);
          await page.locator('input[name="email"], input#email').first().fill(EMAIL);
          await page.locator('input[name="password"], input#password').first().fill(NEWPW);
          await page.locator('button[type="submit"]').first().click();
          await page.waitForTimeout(4000);
          const tf2 = page.locator('input[name="totpCode"], input#totpCode');
          if (await tf2.count()) {
            await tf2.first().fill(totp(secret));
            await page.locator('button[type="submit"]').first().click();
            await page.waitForTimeout(6000);
          }
        }
      }
      console.log("SECRET_FOR_REUSE=", secret);
    } else {
      console.log("  NO BASE32 SECRET FOUND ON SCREEN");
    }
  } else {
    console.log("  NO TOTP ENROLMENT UI on this screen");
  }

  console.log("FINAL URL:", page.url());
  await page.screenshot({ path: `${OUT}/d1-09-landed.png`, fullPage: true });
  console.log("FINAL BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1200));

  if (!page.url().includes("/login")) {
    // What does a brand-new restaurant see on the screens it must fill in?
    for (const [route, name] of [
      ["/app/dashboard", "d1-10-dashboard"],
      ["/app/settings", "d1-11-settings"],
      ["/app/users", "d1-12-users"],
      ["/app/tables", "d1-13-tables"],
      ["/app/stations", "d1-14-stations"],
      ["/app/terminals", "d1-15-terminals"],
      ["/app/menu/items", "d1-16-menu"],
      ["/app/pos", "d1-17-pos"],
    ]) {
      await visit(page, route, name, { chars: 700 });
    }
    // The sidebar: what is a fresh tenant even offered?
    const nav = await page.locator("nav").allInnerTexts();
    console.log("SIDEBAR:", JSON.stringify(nav.join(" | ").replace(/\s+/g, " ").slice(0, 1200)));
  }
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/d1-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
