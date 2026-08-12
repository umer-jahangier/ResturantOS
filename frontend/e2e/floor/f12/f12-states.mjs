/*
 * F12 — the OTHER states of the relocated forced-change panel.
 *
 * The panel moved from its own route into the login card, so every state it can be in has to be
 * proved where it now lives, not where it used to. Driven for real, on a brand-new hire:
 *
 *   1. VALIDATION, as the user types — a too-short new password and a mismatched confirmation each
 *      name their own field and say the real problem;
 *   2. ERROR from the server — a wrong "current password" surfaces auth-service's refusal in the
 *      panel rather than a blank screen or a silent no-op. (This also spends the token, which is
 *      deliberate on the server side: `changeForcedPassword` commits the claim on an authentication
 *      failure so a stolen token buys one guess, not ten minutes of guesses.);
 *   3. RECOVERY — signing in again with the one-time password mints a fresh token and the panel
 *      comes back, still with no URL involved.
 */
import { PEOPLE, newBrowser, newPage, login, BASE, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F12");
mkdirSync(OUT, { recursive: true });

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `f12.state.${STAMP}@terrace.local`,
  newPassword: "F12#State!Pass1",
};

const fail = [];
function check(ok, what, detail) {
  log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(what);
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
}

const browser = await newBrowser();
const owner = await newPage(browser);
let signedIn = false;
for (let attempt = 1; attempt <= 4 && !signedIn; attempt++) {
  try {
    await login(owner, PEOPLE.owner);
    signedIn = true;
  } catch (e) {
    log(`  owner login attempt ${attempt} failed: ${e.message}`);
    await owner.waitForTimeout(4000);
  }
}
if (!signedIn) throw new Error("owner could not sign in after 4 attempts");

await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
await owner.waitForTimeout(5000);
await owner
  .getByRole("button", { name: /add (a )?user|new user/i })
  .first()
  .click();
await owner.waitForTimeout(1200);
await owner.locator("input[type=email]").first().fill(NEW.email);
const branchSel = owner.locator("#create-user-branch");
const branchOpts = await branchSel.locator("option").allTextContents();
const mainIdx = branchOpts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
await owner.waitForTimeout(500);
const roleSel = owner.locator("[data-testid=role-select]");
const roleOpts = await roleSel.locator("option").allTextContents();
await roleSel.selectOption({ label: roleOpts.find((t) => /cashier/i.test(t)) });
await owner.waitForTimeout(400);
await owner
  .getByRole("button", { name: /^Create user$/i })
  .first()
  .click();
await owner.waitForTimeout(4000);
const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
if (!otp) throw new Error("no one-time password panel — cannot continue");
log("  hired:", NEW.email);

const hire = await newPage(browser);
async function firstSignIn() {
  await hire.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await hire.waitForTimeout(1800);
  const slug = hire.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await hire.locator('input[name="email"]').fill(NEW.email);
  await hire.locator('input[name="password"]').fill(otp);
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
  return (await hire.locator("[data-testid=forced-password-change]").count()) === 1;
}

// ── 1. validation, at the UI, as the user types ──────────────────────────────
log("\n=== validation ===");
check(await firstSignIn(), "the change panel is reached");

await hire.locator('input[name="newPassword"]').fill("short");
await hire.locator('input[name="confirmPassword"]').fill("different");
await hire.getByRole("button", { name: /^Change password$/i }).click();
await hire.waitForTimeout(1200);
const messages = await hire.evaluate(() =>
  Array.from(document.querySelectorAll('[data-slot="form-message"], [role="alert"]'))
    .map((n) => n.textContent.trim())
    .filter(Boolean),
);
log("  field messages:", JSON.stringify(messages));
check(
  messages.some((m) => /at least 12 characters/i.test(m)),
  "a too-short new password names the real rule",
);
check(
  messages.some((m) => /do not match/i.test(m)),
  "a mismatched confirmation says so on the confirm field",
);
await shot(hire, "p09-validation");

// Typing a valid value clears its own message — validation follows the user, it does not stick.
await hire.locator('input[name="newPassword"]').fill(NEW.newPassword);
await hire.locator('input[name="confirmPassword"]').fill(NEW.newPassword);
await hire.waitForTimeout(900);
const after = await hire.evaluate(() =>
  Array.from(document.querySelectorAll('[data-slot="form-message"]'))
    .map((n) => n.textContent.trim())
    .filter(Boolean),
);
log("  messages after correcting:", JSON.stringify(after));
check(after.length === 0, "correcting the fields clears their messages", JSON.stringify(after));

// ── 2. the server's refusal, in the panel ────────────────────────────────────
log("\n=== a wrong current password ===");
await hire.locator('input[name="currentPassword"]').fill("Definitely#NotTheOtp9");
await hire.getByRole("button", { name: /^Change password$/i }).click();
await hire.waitForTimeout(5000);
const alertText = await hire.evaluate(
  () => document.querySelector('[role="alert"]')?.innerText?.replace(/\s+/g, " ").trim() ?? "(none)",
);
log("  alert:", alertText);
check(/expired|current password is wrong/i.test(alertText), "the refusal is shown on the panel", alertText);
check(
  hire.url() === `${BASE}/login`,
  "the failure did not move the address bar either",
  hire.url(),
);
await shot(hire, "p10-wrong-current-password");

// ── 3. recovery — sign in again, get a fresh token, no URL involved ──────────
log("\n=== recovery ===");
check(await firstSignIn(), "signing in again mints a fresh token and the panel returns");
check(hire.url() === `${BASE}/login`, "still no token in the address bar", hire.url());
await hire.locator('input[name="newPassword"]').fill(NEW.newPassword);
await hire.locator('input[name="confirmPassword"]').fill(NEW.newPassword);
await hire.getByRole("button", { name: /^Change password$/i }).click();
await hire.waitForTimeout(5000);
const notice = await hire.evaluate(
  () => document.querySelector('[role="status"]')?.textContent?.trim() ?? "(none)",
);
check(/sign in with your new password/i.test(notice), "the retry completes", notice);
await shot(hire, "p11-recovered");

writeFileSync(
  `${OUT}/f12-states.json`,
  JSON.stringify({ hire: NEW.email, messages, alertText, notice, failures: fail }, null, 2),
);
await browser.close();
log(`\nF12 states done. failures = ${fail.length}${fail.length ? `: ${fail.join(" | ")}` : ""}`);
process.exit(fail.length ? 1 : 0);
