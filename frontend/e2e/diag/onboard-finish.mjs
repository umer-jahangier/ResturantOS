/**
 * DIAGNOSIS ONLY — finish the onboarding journey started by onboard-e2e.mjs:
 * complete the forced password change in the browser, then see whether the new
 * administrator reaches a working app or hits a wall.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const SLUG = process.argv[2];
const ADMIN = process.argv[3];
const TEMP = process.argv[4];
const NEWPW = "Onboard#Audit2026";

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const q = await ctx.newPage();
  const api = [];
  q.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });

  await q.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await q.waitForTimeout(1500);
  const sl = q.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await sl.count()) await sl.first().fill(SLUG);
  await q.locator('input[name="email"], input#email').first().fill(ADMIN);
  await q.locator('input[name="password"], input#password').first().fill(TEMP);
  await q.locator('button[type="submit"]').first().click();
  await q.waitForTimeout(5000);
  note("redirected to:", q.url().split("?")[0]);

  // fill the three password fields
  const pws = q.locator('input[type="password"]');
  const n = await pws.count();
  note("password fields:", n);
  if (n >= 3) {
    await pws.nth(0).fill(TEMP);
    await pws.nth(1).fill(NEWPW);
    await pws.nth(2).fill(NEWPW);
  }
  await q.screenshot({ path: `${OUT}/52-change-password-filled.png`, fullPage: true });
  await q.locator('button[type="submit"], button', { hasText: /change password/i }).first().click();
  await q.waitForTimeout(6000);
  note("URL after change:", q.url());
  let body = (await q.locator("body").innerText()).replace(/\s*\n+\s*/g, " | ");
  note("SCREEN:", body.slice(0, 1000));
  await q.screenshot({ path: `${OUT}/53-after-change-password.png`, fullPage: true });

  // if bounced to login, sign in with the new password
  if (q.url().includes("/login") && !q.url().includes("change-password")) {
    note("\n-> bounced to login; signing in with the NEW password");
    const sl2 = q.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await sl2.count()) await sl2.first().fill(SLUG);
    await q.locator('input[name="email"], input#email').first().fill(ADMIN);
    await q.locator('input[name="password"], input#password').first().fill(NEWPW);
    await q.locator('button[type="submit"]').first().click();
    await q.waitForTimeout(6000);
    note("URL:", q.url());
    body = (await q.locator("body").innerText()).replace(/\s*\n+\s*/g, " | ");
    note("SCREEN:", body.slice(0, 1200));
    await q.screenshot({ path: `${OUT}/54-second-login.png`, fullPage: true });
  }

  note("\nTOTP enrolment UI present?");
  note("  QR/canvas/svg:", await q.locator('img[alt*="QR" i], canvas').count());
  note("  otpauth text:", /otpauth|authenticator|two-factor|2FA/i.test(body));
  note("  reached the app:", q.url().includes("/app/"));
  note("\nAPI:", JSON.stringify([...new Set(api)], null, 1));

  writeFileSync(`${OUT}/onboard-finish-log.txt`, log.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); writeFileSync(`${OUT}/onboard-finish-log.txt`, log.join("\n") + "\nFATAL " + e.message); process.exit(1); });
