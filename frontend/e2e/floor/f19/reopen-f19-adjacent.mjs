/*
 * F19 RE-OPEN, part 2 — the adjacent paths.
 *
 * The fix claims "every downstream branch — TOTP required, TOTP enrolment required, tenant
 * selection, lockout — is inherited rather than rebuilt". Part 1 drove the plain hire and the
 * un-enrolled step-up hire. This drives the two that are left and cost something to reach:
 *
 * E · a step-up account that is ALREADY ENROLLED meets a forced change.
 *     Hire an Accountant → forced change → enrol a real authenticator → sign in with a code →
 *     the owner RESETS their password → sign in with the issued one-time password → forced
 *     change again → the automatic sign-in must now meet 401 TOTP_REQUIRED. The user must be
 *     asked for a CODE (not for the password they just chose), told the change was saved, and
 *     be able to finish. This is the branch the fix inherits rather than writes, so it is the
 *     one most likely to be broken.
 *
 * F · another tenant. The same flow inside Control Bistro, then the hire's OWN bearer is asked
 *     what it can see. A new hire must land in their own tenant and nowhere else.
 */
import { PEOPLE, newBrowser, newPage, login, totpNow, BASE, API, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F19/reopen");
mkdirSync(OUT, { recursive: true });

const stamp = Date.now().toString(36);
const results = [];

function check(ok, what, detail) {
  log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  results.push({ ok, what, detail: detail ?? null });
  return ok;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function measure(page) {
  const view = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      href: location.href,
      passwordInputs: document.querySelectorAll('input[type="password"]').length,
      signInButton: Array.from(document.querySelectorAll("button")).some(
        (b) => (b.textContent || "").trim() === "Sign in",
      ),
      heading: q("h1")?.textContent?.trim() ?? null,
      status: q('[role="status"]')?.textContent?.trim() ?? null,
      alert: q('[role="alert"]')?.textContent?.trim() ?? null,
      changePanel: document.querySelectorAll("[data-testid=forced-password-change]").length,
      totpField: document.querySelectorAll("[data-testid=totp-code]").length,
      passwordValue: (document.querySelector('input[name="password"]') || {}).value?.length ?? 0,
      text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
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
    const tok = b?.accessToken ?? b?.data?.accessToken ?? null;
    return { refresh: r.status, token: tok };
  }, API);
  return { ...view, ...session };
}

async function hire(owner, email, roleRe, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
      await owner.waitForTimeout(6000);
      await owner.getByRole("button", { name: /^Add (a )?user$/i }).first().click({ timeout: 20_000 });
      await owner.waitForTimeout(1500);
      await owner.locator("input[type=email]").first().fill(email);
      const branchSel = owner.locator("#create-user-branch");
      const opts = await branchSel.locator("option").allTextContents();
      await branchSel.selectOption({ index: Math.max(1, opts.findIndex((t) => t.trim().length > 2 && !/select/i.test(t))) });
      await owner.waitForTimeout(600);
      const roleSel = owner.locator("[data-testid=role-select]");
      const roles = await roleSel.locator("option").allTextContents();
      const wanted = roles.find((t) => roleRe.test(t));
      if (!wanted) throw new Error(`no role ${roleRe} in ${JSON.stringify(roles)}`);
      await roleSel.selectOption({ label: wanted });
      await owner.waitForTimeout(500);
      await owner.getByRole("button", { name: /^Create user$/i }).first().click();
      await owner.waitForSelector("[data-testid=one-time-password-value]", { timeout: 25_000 });
      const otp = await owner.evaluate(() =>
        document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim(),
      );
      await owner.getByRole("button", { name: /^Done$/i }).first().click();
      await owner.waitForTimeout(1500);
      log(`  hired ${email} as ${wanted}`);
      return otp;
    } catch (e) {
      last = e;
      log(`  hire attempt ${i}: ${e.message}`);
      await owner.keyboard.press("Escape").catch(() => {});
      await owner.waitForTimeout(4000);
    }
  }
  throw last;
}

/** Drive the owner's Reset password action and return the issued one-time password. */
async function adminReset(owner, email) {
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(5000);
  await owner.getByLabel("Search users").fill(email);
  await owner.waitForTimeout(3500);
  await owner.getByRole("button", { name: email }).first().click();
  await owner.waitForTimeout(2500);
  await owner.getByRole("button", { name: /^Reset password$/i }).first().click();
  await owner.waitForTimeout(1200);
  await owner.locator("#reset-reason").fill("F19 re-open: forcing a second forced change");
  await owner.getByRole("button", { name: /^Reset password$/i }).last().click();
  await owner.waitForSelector("[data-testid=one-time-password-value]", { timeout: 25_000 });
  const otp = await owner.evaluate(() =>
    document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim(),
  );
  await owner.getByRole("button", { name: /^Done$/i }).first().click();
  await owner.waitForTimeout(1200);
  return otp;
}

async function firstSignIn(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(pw);
  await page.locator("[data-testid=login-submit]").first().click();
  await page.waitForSelector("[data-testid=forced-password-change]", { timeout: 25_000 });
  await page.waitForTimeout(600);
}

async function changeTo(page, pw) {
  await page.getByLabel("New password", { exact: true }).fill(pw);
  await page.getByLabel("Confirm new password", { exact: true }).fill(pw);
  await page.getByRole("button", { name: /^Change password$/i }).click();
}

async function scenarioE(browser, owner) {
  log("\n── E · an ENROLLED step-up account meets a forced change ────");
  const email = `f19re.enr.${stamp}@terrace.local`;
  const PW1 = "F19Reopen#Enrol1";
  const PW2 = "F19Reopen#Enrol2";
  const otp1 = await hire(owner, email, /accountant/i);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await firstSignIn(page, email, otp1);
  await changeTo(page, PW1);
  await page.waitForSelector("[data-testid=totp-enrollment]", { timeout: 25_000 });
  check(true, "E: the un-enrolled step-up hire reaches the enrolment panel");

  // Enrol a real authenticator.
  await page.locator("[data-testid=totp-enroll-start]").click();
  await page.waitForSelector("[data-testid=totp-secret]", { timeout: 25_000 });
  const secret = (await page.locator("[data-testid=totp-secret]").innerText()).replace(/\s+/g, "");
  await page.locator("[data-testid=totp-enroll-code]").fill(totpNow(secret));
  await page.locator("[data-testid=totp-enroll-verify]").click();
  await page.waitForTimeout(4000);
  await shot(page, "e1-after-enrolment");

  // Ordinary sign-in with the chosen password + a code, to prove the account is really enrolled.
  const afterEnrol = await measure(page);
  if (afterEnrol.passwordInputs > 0) {
    await page.locator('input[name="password"], input#password').first().fill(PW1);
  }
  if (!(await page.locator("[data-testid=totp-code]").count())) {
    await page.locator('input[name="email"], input#email').first().fill(email);
    await page.locator("[data-testid=login-submit]").first().click();
    await page.waitForTimeout(4000);
  }
  await page.locator("[data-testid=totp-code]").first().fill(totpNow(secret));
  await page.locator("[data-testid=login-submit]").first().click();
  await page.waitForTimeout(6000);
  const enrolledIn = await measure(page);
  check(
    enrolledIn.href.startsWith(`${BASE}/app/`),
    "E: the account is genuinely enrolled and signs in with a code",
    enrolledIn.href,
  );
  await ctx.close();

  // Now the owner resets it — a second forced change, on an ENROLLED step-up account.
  let otp2;
  try {
    otp2 = await adminReset(owner, email);
  } catch (e) {
    check(false, "E: could not drive the owner's Reset password (inconclusive)", e.message);
    return;
  }
  check(Boolean(otp2), "E: the owner issued a new one-time password", otp2?.length);

  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p2 = await ctx2.newPage();
  await firstSignIn(p2, email, otp2);
  await changeTo(p2, PW2);
  await p2.waitForTimeout(9000);
  const m = await measure(p2);
  await shot(p2, "e2-after-second-change-totp-required");
  log(`  E measured: ${JSON.stringify({ ...m, token: Boolean(m.token) })}`);

  check(m.totpField === 1, "E: the enrolled hire is asked for a CODE, not for a password", {
    totpField: m.totpField,
    heading: m.heading,
  });
  check(
    m.passwordValue >= PW2.length,
    "E: the password they just chose is still in the box (nothing to retype)",
    m.passwordValue,
  );
  check(
    /new password is saved/i.test(m.status ?? ""),
    "E: the user is told the change itself succeeded",
    m.status,
  );
  check(m.alert === null, "E: no error alert on the challenge", m.alert);

  // Finish it: type the code and nothing else.
  await p2.locator("[data-testid=totp-code]").first().fill(totpNow(secret));
  await p2.locator("[data-testid=login-submit]").first().click();
  await p2.waitForTimeout(7000);
  const done = await measure(p2);
  await shot(p2, "e3-signed-in-after-code");
  check(
    done.href.startsWith(`${BASE}/app/`) && done.refresh === 200,
    "E: typing only the code finishes the sign-in",
    { href: done.href, refresh: done.refresh },
  );
  await ctx2.close();
}

async function scenarioF(browser) {
  log("\n── F · another tenant (Control Bistro) ──────────────────────");
  const controlOwner = {
    slug: "control-bistro-isolation-test-tenant",
    email: "owner@control.local",
    password: "Control#Owner1",
    totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
  };
  const owner = await newPage(browser);
  let signedIn = false;
  for (let i = 1; i <= 4; i++) {
    try {
      await login(owner, controlOwner);
      signedIn = true;
      break;
    } catch (e) {
      log(`  control owner attempt ${i}: ${e.message}`);
      await owner.waitForTimeout(4000);
    }
  }
  if (!signedIn) {
    check(false, "F: could not sign in as the Control Bistro owner (inconclusive)");
    return;
  }
  const email = `f19re.ctl.${stamp}@control.local`;
  const PW = "F19Reopen#Ctrl1";
  let otp;
  try {
    otp = await hire(owner, email, /cashier/i);
  } catch (e) {
    check(false, "F: could not hire in Control Bistro (inconclusive)", e.message);
    return;
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await firstSignIn(page, email, otp);
  await changeTo(page, PW);
  await page.waitForTimeout(9000);
  const m = await measure(page);
  await shot(page, "f1-control-bistro-after-change");
  check(m.href === `${BASE}/app/dashboard`, "F: the other tenant's hire lands in the app too", m.href);
  check(m.passwordInputs === 0, "F: no second password prompt in the other tenant", m.passwordInputs);

  // What can this brand-new session actually see? Asked with the hire's OWN bearer.
  const scope = await page.evaluate(
    async ({ api, tok }) => {
      const get = async (p) => {
        const r = await fetch(`${api}${p}`, { headers: { Authorization: `Bearer ${tok}` } });
        let b = null;
        try {
          b = await r.json();
        } catch {}
        return { status: r.status, body: b };
      };
      const mine = await get("/api/v1/branches/mine");
      return { mine };
    },
    { api: API, tok: m.token },
  );
  const branches = scope.mine.body?.data ?? scope.mine.body ?? [];
  const names = Array.isArray(branches) ? branches.map((b) => b.name ?? b.branchName) : [];
  check(
    scope.mine.status === 200 && names.length > 0 && !names.some((n) => /terrace/i.test(n ?? "")),
    "F: the hire's own token sees only its own tenant's branches",
    { status: scope.mine.status, names },
  );
  await ctx.close();
}

(async () => {
  const browser = await newBrowser();
  try {
    const owner = await newPage(browser);
    for (let i = 1; i <= 5; i++) {
      try {
        await login(owner, PEOPLE.owner);
        break;
      } catch (e) {
        log(`  owner login attempt ${i}: ${e.message}`);
        if (i === 5) throw e;
        await owner.waitForTimeout(4000);
      }
    }
    await scenarioE(browser, owner);
    await scenarioF(browser);
  } catch (e) {
    check(false, `harness aborted: ${e.message}`);
    log(e.stack ?? "");
  } finally {
    const fails = results.filter((r) => !r.ok);
    writeFileSync(
      `${OUT}/reopen-f19-adjacent.json`,
      JSON.stringify({ at: new Date().toISOString(), stamp, results }, null, 2),
    );
    log(`\n${results.length - fails.length}/${results.length} checks passed`);
    if (fails.length) log(`FAILED: ${fails.map((f) => f.what).join(" | ")}`);
    await browser.close();
    process.exit(fails.length ? 1 : 0);
  }
})();
