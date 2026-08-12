/*
 * F19 — REPRODUCTION.
 *
 * Walkthrough §0: "After setting their password they are bounced to /login and must type the
 * password they set ten seconds earlier."
 *
 * F12 has since moved the forced change off `/login/change-password?token=…` and into a panel on
 * `/login`, so the literal "bounced" is no longer a navigation. This script measures the thing the
 * finding is actually about, which survived that move: after the change succeeds, does the new
 * hire have a session, or are they asked for a credential a second time?
 *
 * The click path is the one in DONE MEANS:
 *   owner@terrace.local → /app/users → Add a user (Cashier) → one-time password
 *   → new hire signs in with it → forced change → set a new password → ???
 *
 * Measured, not assumed:
 *   - the number of password inputs on screen after the change;
 *   - whether a "Sign in" button is present;
 *   - whether the HttpOnly refresh cookie can mint an access token (the only honest test of
 *     "is this browser signed in" — a URL proves nothing).
 */
import {
  BASE,
  newBrowser,
  newPage,
  ownerSignedIn,
  hireCashier,
  measure,
  shot,
  reporter,
  log,
  OUT,
} from "./lib.mjs";
import { writeFileSync } from "node:fs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `f19.hire.${STAMP}@terrace.local`,
  fullName: `F19 Hire ${STAMP}`,
  newPassword: "F19#Hire!Pass1",
};

const { check, fails } = reporter();
const browser = await newBrowser();
const journal = { email: NEW.email, steps: [] };

log("=== owner hires a cashier ===");
const owner = await ownerSignedIn(browser);
const otp = await hireCashier(owner, NEW);
log(`  one-time password handed over: ${otp.length} chars`);

log("\n=== the new hire's first minute ===");
const hire = await newPage(browser);
const urls = [];
hire.on("framenavigated", (f) => {
  if (f === hire.mainFrame()) urls.push(f.url());
});

await hire.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await hire.waitForTimeout(1800);

const slug = hire.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await hire.locator('input[name="email"]').first().fill(NEW.email);
await hire.locator('input[name="password"]').first().fill(otp);
await hire.locator('button[type="submit"]').first().click();
await hire.waitForTimeout(5000);

const atChange = await measure(hire);
journal.steps.push({ label: "forced-change-panel", ...atChange });
log(`  [change step] href=${atChange.href} heading=${JSON.stringify(atChange.heading)}`);
await shot(hire, "r01-forced-change-panel");
check(atChange.changePanel === 1, "the forced-change panel is on screen", `n=${atChange.changePanel}`);

await hire.locator('input[name="newPassword"]').fill(NEW.newPassword);
await hire.locator('input[name="confirmPassword"]').fill(NEW.newPassword);
await shot(hire, "r02-change-filled");

log("\n=== they press Change password ===");
await hire.getByRole("button", { name: /^Change password$/i }).click();
await hire.waitForTimeout(6000);

const after = await measure(hire);
journal.steps.push({ label: "after-change", ...after });
log(`  [after change] href=${after.href}`);
log(`  [after change] heading=${JSON.stringify(after.heading)}`);
log(`  [after change] status=${JSON.stringify(after.status)}`);
log(`  [after change] passwordPrompts=${after.passwordPrompts} signInButton=${after.hasSignInButton}`);
log(`  [after change] refresh=${after.refreshStatus} hasAccessToken=${after.hasAccessToken}`);
log(`  [after change] snippet=${JSON.stringify(after.snippet)}`);
await shot(hire, "r03-after-change");

// THE FINDING, stated as the three things a signed-in user would not see.
check(
  after.passwordPrompts === 0,
  "no password is asked for again after the change",
  `passwordPrompts=${after.passwordPrompts}`,
);
check(!after.hasSignInButton, "no second Sign in button", `present=${after.hasSignInButton}`);
check(
  after.hasAccessToken,
  "the browser holds a session after the change",
  `refresh=${after.refreshStatus}`,
);
check(
  after.href.startsWith(`${BASE}/app`),
  "the hire has landed in the application",
  after.href,
);

log("\n=== every URL this tab held ===");
for (const u of urls) log("   ", u);
journal.urls = urls;

journal.fails = fails;
writeFileSync(`${OUT}/f19-repro.json`, JSON.stringify(journal, null, 2));
log(`\n${fails.length === 0 ? "REPRODUCED: no" : "REPRODUCED: yes"} — ${fails.length} failing check(s)`);
for (const f of fails) log("   ✗", f);
await browser.close();
process.exit(0);
