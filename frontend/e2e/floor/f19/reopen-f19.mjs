/*
 * F19 RE-OPEN — an independent drive of "a new hire who sets their password is bounced to /login".
 *
 * Written from the finding text and DONE MEANS, not from the fixing agent's harness. It shares only
 * the shift harness's browser/login/TOTP plumbing.
 *
 * Scenario A  the plain hire (Cashier): create → first sign-in with the one-time password →
 *             forced change → press Change password and NOTHING ELSE → measure → reload → measure.
 * Scenario B  the same, but a role that triggers the TOTP step-up gate (Accountant): the fix claims
 *             every downstream branch is inherited. If the hire is stranded, that claim is false.
 * Scenario C  the cancel path — "Back to sign in" must still leave a usable credentials form.
 * Scenario D  after the change: the one-time password must be dead and the chosen one alive; and no
 *             URL the tab ever held may carry token=/email=/password= (F12 must survive).
 */
import { PEOPLE, newBrowser, newPage, login, BASE, API, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F19/reopen");
mkdirSync(OUT, { recursive: true });

const stamp = Date.now().toString(36);
const results = [];
const urlsSeen = [];

function check(ok, what, detail) {
  log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  results.push({ ok, what, detail: detail ?? null });
  return ok;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot ${name}.png`);
}

/** What a human sees + whether the tab actually holds a session (refresh cookie spent). */
async function measure(page) {
  const view = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      href: location.href,
      passwordInputs: document.querySelectorAll('input[type="password"]').length,
      passwordLabels: Array.from(document.querySelectorAll("label")).map((l) =>
        (l.textContent || "").trim(),
      ),
      signInButton: Array.from(document.querySelectorAll("button")).some(
        (b) => (b.textContent || "").trim() === "Sign in",
      ),
      heading: q("h1")?.textContent?.trim() ?? null,
      status: q('[role="status"]')?.textContent?.trim() ?? null,
      alert: q('[role="alert"]')?.textContent?.trim() ?? null,
      changePanel: document.querySelectorAll("[data-testid=forced-password-change]").length,
      totpField: document.querySelectorAll("[data-testid=totp-code]").length,
      enrolPanel: /scan|authenticator|two-factor|2fa/i.test(document.body.innerText || "")
        ? 1
        : 0,
      text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400),
    };
  });
  const session = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    let b = null;
    try {
      b = await r.json();
    } catch {}
    return { refresh: r.status, token: Boolean(b?.accessToken ?? b?.data?.accessToken) };
  }, API);
  return { ...view, ...session };
}

/** Owner hires someone with the named role and returns the one-time password. */
async function hire(owner, email, roleRe, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
      await owner.waitForTimeout(6000);
      const addBtn = owner.getByRole("button", { name: /^Add (a )?user$/i }).first();
      if (!(await addBtn.count())) {
        const diag = await owner.evaluate(() => ({
          href: location.href,
          alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
            (n.textContent || "").trim(),
          ),
          text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500),
        }));
        throw new Error(`no Add user button — ${JSON.stringify(diag)}`);
      }
      await addBtn.click({ timeout: 20_000 });
      await owner.waitForTimeout(1500);
      await owner.locator("input[type=email]").first().fill(email);
      const nameInput = owner.locator('input[placeholder="Optional"]');
      if (await nameInput.count()) await nameInput.first().fill("F19 Reopen");
      const branchSel = owner.locator("#create-user-branch");
      const opts = await branchSel.locator("option").allTextContents();
      const idx = opts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
      await branchSel.selectOption({ index: idx > 0 ? idx : 1 });
      await owner.waitForTimeout(600);
      const roleSel = owner.locator("[data-testid=role-select]");
      const roles = await roleSel.locator("option").allTextContents();
      const wanted = roles.find((t) => roleRe.test(t));
      if (!wanted) throw new Error(`no role matching ${roleRe} in ${JSON.stringify(roles)}`);
      await roleSel.selectOption({ label: wanted });
      await owner.waitForTimeout(500);
      await owner
        .getByRole("button", { name: /^Create user$/i })
        .first()
        .click();
      await owner.waitForSelector("[data-testid=one-time-password-value]", { timeout: 25_000 });
      const otp = await owner.evaluate(() =>
        document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim(),
      );
      const panelText = await owner.evaluate(() =>
        (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 900),
      );
      await owner
        .getByRole("button", { name: /^Done$/i })
        .first()
        .click();
      await owner.waitForTimeout(1500);
      if (!otp) throw new Error("no one-time password shown");
      log(`  hired ${email} as ${wanted} — otp length ${otp.length}`);
      return { otp, role: wanted, panelText };
    } catch (e) {
      last = e;
      log(`  hire attempt ${i} failed: ${e.message}`);
      await owner.keyboard.press("Escape").catch(() => {});
      await owner.waitForTimeout(4000);
    }
  }
  throw last;
}

/** First sign-in with the one-time password; stops at the forced-change panel. */
async function firstSignIn(page, email, otp) {
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) urlsSeen.push(f.url());
  });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(otp);
  await page.locator("[data-testid=login-submit]").first().click();
  await page.waitForSelector("[data-testid=forced-password-change]", { timeout: 25_000 });
  await page.waitForTimeout(600);
}

async function fillNewPassword(page, pw) {
  await page.getByLabel("New password", { exact: true }).fill(pw);
  await page.getByLabel("Confirm new password", { exact: true }).fill(pw);
}

async function scenarioA(browser, owner) {
  log("\n── A · the plain hire (Cashier) ─────────────────────────────");
  const email = `f19re.cashier.${stamp}@terrace.local`;
  const { otp } = await hire(owner, email, /cashier/i);
  const NEW = "F19Reopen#Cash1";

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__net = [];
  page.on("response", (r) => {
    if (r.url().startsWith(API)) page.__net.push(`${r.request().method()} ${r.status()} ${r.url().replace(API, "")}`);
  });

  await firstSignIn(page, email, otp);
  await shot(page, "a1-forced-change-panel");
  const atPanel = await measure(page);
  check(atPanel.href === `${BASE}/login`, "A: change panel renders on /login (F12)", atPanel.href);
  check(atPanel.changePanel === 1, "A: the forced-change panel is on screen", atPanel.changePanel);

  await fillNewPassword(page, NEW);
  await shot(page, "a2-filled");
  page.__net.length = 0;
  await page.getByRole("button", { name: /^Change password$/i }).click();
  // Nothing else is pressed. Give the change + the sign-in it should trigger time to land.
  await page.waitForTimeout(9000);
  const after = await measure(page);
  await shot(page, "a3-after-change");
  log(`  net: ${JSON.stringify(page.__net)}`);

  check(after.href === `${BASE}/app/dashboard`, "A: lands in the app, not /login", after.href);
  check(after.passwordInputs === 0, "A: no second password prompt", after.passwordInputs);
  check(!after.signInButton, "A: no Sign in button", after.signInButton);
  check(after.alert === null, "A: no error alert", after.alert);
  check(after.refresh === 200 && after.token, "A: a real session exists (refresh 200 + token)", {
    refresh: after.refresh,
    token: after.token,
  });
  check(
    page.__net.some((n) => /POST 200 \/api\/v1\/auth\/login/.test(n)),
    "A: the client signed in for the user",
    page.__net.filter((n) => /auth/.test(n)),
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const reloaded = await measure(page);
  await shot(page, "a4-after-reload");
  check(reloaded.href.startsWith(`${BASE}/app/`), "A: session survives a reload", reloaded.href);
  check(reloaded.passwordInputs === 0, "A: still no password prompt after reload", reloaded.passwordInputs);
  check(reloaded.refresh === 200, "A: refresh still 200 after reload", reloaded.refresh);

  // D · the credentials themselves, straight at the gateway.
  const oldPw = await page.evaluate(
    async ({ api, e, p }) => {
      const r = await fetch(`${api}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e, password: p }),
      });
      return r.status;
    },
    { api: API, e: email, p: otp },
  );
  const newPw = await page.evaluate(
    async ({ api, e, p }) => {
      const r = await fetch(`${api}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e, password: p }),
      });
      return r.status;
    },
    { api: API, e: email, p: NEW },
  );
  check(oldPw === 401, "D: the one-time password is dead", oldPw);
  check(newPw === 200, "D: the chosen password signs in", newPw);
  check(
    !urlsSeen.some((u) => /token=|email=|password=/.test(u)),
    "D: no URL ever carried token=/email=/password= (F12 intact)",
    urlsSeen,
  );
  await ctx.close();
  return { email, otp, NEW };
}

async function scenarioB(browser, owner) {
  log("\n── B · a hire whose role trips the step-up gate (Accountant) ─");
  const email = `f19re.acct.${stamp}@terrace.local`;
  let hired;
  try {
    hired = await hire(owner, email, /accountant/i);
  } catch (e) {
    check(false, "B: could not hire an accountant (inconclusive, not a finding)", e.message);
    return;
  }
  const NEW = "F19Reopen#Acct1";
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await firstSignIn(page, email, hired.otp);
  await fillNewPassword(page, NEW);
  await page.getByRole("button", { name: /^Change password$/i }).click();
  await page.waitForTimeout(9000);
  const after = await measure(page);
  await shot(page, "b1-after-change-stepup-role");
  log(`  B measured: ${JSON.stringify(after).slice(0, 900)}`);

  const landed = after.href === `${BASE}/app/dashboard`;
  const challenged = after.totpField > 0 || /authenticator|two-factor|scan/i.test(after.text);
  check(
    landed || challenged,
    "B: the step-up hire is either signed in or challenged — not stranded",
    { href: after.href, totpField: after.totpField, heading: after.heading, status: after.status, alert: after.alert },
  );
  check(
    !(after.changePanel === 0 && after.passwordInputs > 0 && after.signInButton && !challenged),
    "B: the step-up hire is NOT handed a bare password box again",
    { passwordInputs: after.passwordInputs, signInButton: after.signInButton },
  );
  check(
    !/Signing you in/i.test(after.heading ?? ""),
    "B: not stuck on the interstitial",
    after.heading,
  );
  await ctx.close();
}

async function scenarioC(browser, owner) {
  log("\n── C · the cancel path ──────────────────────────────────────");
  const email = `f19re.cancel.${stamp}@terrace.local`;
  const { otp } = await hire(owner, email, /cashier/i);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await firstSignIn(page, email, otp);
  await page.getByRole("button", { name: /^Back to sign in$/i }).click();
  await page.waitForTimeout(1500);
  const m = await measure(page);
  await shot(page, "c1-after-cancel");
  check(m.changePanel === 0 && m.passwordInputs === 1 && m.signInButton,
    "C: cancel returns a usable credentials form", { pw: m.passwordInputs, btn: m.signInButton });
  check(!/Signing you in/i.test(m.heading ?? ""), "C: cancel does not enter the interstitial", m.heading);
  await ctx.close();
}

(async () => {
  const browser = await newBrowser();
  let owner;
  try {
    owner = await newPage(browser);
    for (let i = 1; i <= 4; i++) {
      try {
        await login(owner, PEOPLE.owner);
        break;
      } catch (e) {
        log(`  owner login attempt ${i}: ${e.message}`);
        if (i === 4) throw e;
        await owner.waitForTimeout(4000);
      }
    }
    await scenarioA(browser, owner);
    await scenarioB(browser, owner);
    await scenarioC(browser, owner);
  } catch (e) {
    check(false, `harness aborted: ${e.message}`);
    log(e.stack ?? "");
  } finally {
    const fails = results.filter((r) => !r.ok);
    writeFileSync(
      `${OUT}/reopen-f19.json`,
      JSON.stringify({ at: new Date().toISOString(), stamp, results, urlsSeen }, null, 2),
    );
    log(`\n${results.length - fails.length}/${results.length} checks passed`);
    if (fails.length) log(`FAILED: ${fails.map((f) => f.what).join(" | ")}`);
    await browser.close();
    process.exit(fails.length ? 1 : 0);
  }
})();
