/*
 * SHIFT STEP 1c — a new cashier starts today.
 *
 * The shared drawer cannot be cashed up (133 inherited open orders), so the day is run by
 * a cashier hired this morning: owner creates the account on /app/users, hands over the
 * one-time password, the new hire signs in, changes it, and counts Rs 5,000.00 into a
 * drawer nobody has touched. Every rupee after this point is mine and is checkable.
 *
 * This also exercises the onboarding path a real restaurant uses on week one.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, finding, apiGet, log, BASE } from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `shift.cashier.${STAMP}@terrace.local`,
  fullName: `Shift Cashier ${STAMP}`,
  newPassword: "Shift#Cashier1",
};

const browser = await newBrowser();
log("  new hire will be:", NEW.email);

/** The login form only asks for a tenant slug when it has not already resolved one. */
async function fillLogin(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}

// ── owner creates the account ─────────────────────────────────────────────────
log("\n=== owner hires a cashier ===");
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
let tr = await go(owner, "/app/users", { waitMs: 5000 });
log("  /app/users trouble:", JSON.stringify(tr));
await shot(owner, "01k-users-screen");

const addBtn = owner.getByRole("button", { name: /add (a )?user|new user/i });
log("  add-user buttons:", await addBtn.count());
await addBtn.first().click();
await owner.waitForTimeout(1200);
await owner.locator('input[type=email]').first().fill(NEW.email);
const nameInput = owner.locator('input[placeholder="Optional"]');
if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);

// Branch: F-7 / the main branch.
const branchSel = owner.locator("#create-user-branch");
const branchOpts = await branchSel.locator("option").allTextContents();
log("  branch options:", JSON.stringify(branchOpts));
const mainIdx = branchOpts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
await owner.waitForTimeout(500);

const roleSel = owner.locator("[data-testid=role-select]");
const roleOpts = await roleSel.locator("option").allTextContents();
log("  role options:", JSON.stringify(roleOpts));
await roleSel.selectOption({ label: roleOpts.find((t) => /cashier/i.test(t)) });
await owner.waitForTimeout(400);
await shot(owner, "01l-add-user-filled");

await owner.getByRole("button", { name: /^Create user$/i }).click();
await owner.waitForTimeout(4000);
await shot(owner, "01m-account-created");

const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
log("  one-time password:", otp);
if (!otp) {
  const dialogText = await owner.evaluate(
    () => document.querySelector("[role=dialog]")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
  );
  log("  dialog said:", dialogText);
  throw new Error("no one-time password panel — cannot continue");
}
await owner.getByRole("button", { name: /^Done$/i }).click();
await owner.waitForTimeout(1000);

// ── the new hire signs in ─────────────────────────────────────────────────────
log("\n=== the new hire signs in for the first time ===");
const hire = await newPage(browser);
saveState({ newCashier: NEW, tempPassword: otp });
await fillLogin(hire, NEW.email, otp);
log("  landed at:", hire.url());
await shot(hire, "01n-first-login");

// The forced change used to be its own route, so this branch used to key off the URL. F12 moved
// it INSIDE the login form — the single-use token is a prop in memory now instead of `?token=` in
// the address bar — so the screen has to be recognised by what is on it, not by where it is.
const onChangeScreen =
  hire.url().includes("change-password") ||
  (await hire.locator("[data-testid=forced-password-change]").count()) > 0;

if (onChangeScreen) {
  const fields = await hire.locator("input[type=password]").count();
  log("  change-password fields:", fields);
  const inputs = hire.locator("input[type=password]");
  for (let i = 0; i < fields; i++) {
    const name = await inputs.nth(i).getAttribute("name");
    log("    field", i, name);
  }
  // current, new, confirm — fill by name where possible
  const byName = async (re, val) => {
    for (let i = 0; i < fields; i++) {
      const n = (await inputs.nth(i).getAttribute("name")) ?? "";
      const id = (await inputs.nth(i).getAttribute("id")) ?? "";
      if (re.test(n) || re.test(id)) {
        await inputs.nth(i).fill(val);
        return true;
      }
    }
    return false;
  };
  const okCur = await byName(/current|old/i, otp);
  const okNew = await byName(/^newPassword$|new(?!.*confirm)/i, NEW.newPassword);
  const okConf = await byName(/confirm/i, NEW.newPassword);
  log("  filled cur/new/confirm:", okCur, okNew, okConf);
  if (!okCur && fields === 3) {
    await inputs.nth(0).fill(otp);
    await inputs.nth(1).fill(NEW.newPassword);
    await inputs.nth(2).fill(NEW.newPassword);
  }
  await shot(hire, "01o-change-password-filled");
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
  log("  after change-password, at:", hire.url());
  await shot(hire, "01p-after-change-password");
}

if (hire.url().includes("/login")) {
  // Some flows bounce back to login after a password change.
  await fillLogin(hire, NEW.email, NEW.newPassword);
  log("  re-login landed at:", hire.url());
}

// ── count the float into a brand-new drawer ───────────────────────────────────
tr = await go(hire, "/app/pos", { waitMs: 7000 });
log("  new cashier /app/pos trouble:", JSON.stringify(tr));
await shot(hire, "01q-new-cashier-pos");
const hasOpen = await hire.locator("[data-testid=open-till-button]").count();
log("  open-till button:", hasOpen);
if (hasOpen) {
  await hire.locator("[data-testid=open-till-button]").click();
  await hire.waitForTimeout(700);
  await hire.locator("[data-testid=open-till-panel] input").first().fill("5000");
  await hire.locator("[data-testid=open-till-confirm-button]").click();
  await hire.waitForTimeout(4000);
  await shot(hire, "01r-fresh-drawer-open");
}
const strip = await hire.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  return b ? b.parentElement.innerText.replace(/\s+/g, " ").trim() : "(no open till)";
});
log("  fresh drawer strip:", strip);

saveState({ newCashier: NEW, tempPassword: otp, freshDrawerStrip: strip });
await browser.close();
log("\nstep 1c done");
