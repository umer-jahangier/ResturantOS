/*
 * F19 — the states of the step this fix adds, driven live.
 *
 * The happy path is proved in `f19-prove.mjs`. This script exists for the two states that are
 * normally too fast or too rare to photograph, and for the responsive/theme sweep:
 *
 *   A. LOADING — the interval between "password saved" and "you are in the app". Held open by
 *      delaying the automatic sign-in at the network layer, then photographed at 390 / 768 / 1440
 *      in light and dark. The assertion that matters at every size is `passwordPrompts === 0`:
 *      the finding is a password box appearing here, so its absence is the fix.
 *
 *   B. ERROR — the sign-in refused after the change succeeded. The user cannot go back (their
 *      one-time password is dead), so the screen must say the change stuck, keep the password they
 *      chose, and offer a retry. Forced by failing the second login with a 503.
 *
 * Every combination needs its own account, because `must_change_password` is cleared by the change
 * and there is no second first-login.
 */
import {
  BASE,
  API,
  newBrowser,
  ownerSignedIn,
  hireCashier,
  measure,
  reporter,
  log,
  OUT,
} from "./lib.mjs";
import { writeFileSync } from "node:fs";

const STAMP = Date.now().toString().slice(-6);
const SLUG = "floating-terrace";
const CHOSEN = "F19#States!Pass1";

const { check, fails } = reporter();
const browser = await newBrowser();
const owner = await ownerSignedIn(browser);
const journal = { at: new Date().toISOString(), loading: [], error: null };

/**
 * Take one account all the way to the moment "Change password" is pressed, with `hook` installed on
 * the login route so the automatic sign-in can be delayed or failed.
 */
async function toTheMoment(page, tag, hook) {
  const email = `f19.${tag}.${STAMP}@terrace.local`;
  // Every login answer, as auth-service sent it. When a run fails, the reason has to be readable
  // rather than guessable — this harness shares a machine with nine other agents.
  page.__logins = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/api/v1/auth/login")) return;
    let code = null;
    try {
      code = (await r.json())?.error?.code ?? null;
    } catch {
      /* a 200 body is not an error body */
    }
    page.__logins.push({ status: r.status(), code });
  });
  const otp = await hireCashier(owner, { email, fullName: `F19 ${tag} ${STAMP}` });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(SLUG);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(otp);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);

  await page.locator('input[name="newPassword"]').fill(CHOSEN);
  await page.locator('input[name="confirmPassword"]').fill(CHOSEN);

  // Installed only now, so the FIRST login (the one that produced the 403) went through untouched.
  await page.route(`${API}/api/v1/auth/login`, hook);
  await page.getByRole("button", { name: /^Change password$/i }).click();
  await page.waitForTimeout(2500);

  // The CHANGE itself can be refused by a stack that ten agents are restarting under us — observed
  // once as `503 The service is temporarily unavailable` from auth-service. That is the panel's
  // error state working, not this fix failing, and scoring it as a finding is precisely the trap
  // the walkthrough names: an error state photographed as a feature. Report it as a retry.
  const changeError = await page.evaluate(
    () =>
      document.querySelector("[data-testid=forced-password-change] [role=alert]")?.textContent ??
      null,
  );
  return { email, changeError };
}

/** Run `body` once, and once more if the change step was refused by an unrelated outage. */
async function withRetryOnOutage(label, body) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const outage = await body(attempt);
    if (!outage) return;
    log(`  ! ${label}: the CHANGE was refused (${outage}) — retrying on a fresh account`);
  }
  check(false, `${label}: the change step kept being refused by the stack`);
}

// ── A. the loading state, at every size and in both themes ───────────────────
log("=== A. the interval between 'password saved' and 'you are in the app' ===");
for (const theme of ["light", "dark"]) {
  for (const [w, h] of [
    [390, 844],
    [768, 1024],
    [1440, 950],
  ]) {
    await withRetryOnOutage(`${w}px ${theme}`, async (attempt) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.emulateMedia({ colorScheme: theme });

      const { changeError } = await toTheMoment(
        page,
        `load${w}${theme}x${attempt}`,
        async (route) => {
          // Eight seconds of held response — long enough to photograph, and a fair imitation of a
          // gateway under load. The request is then let through, so the account really does get in.
          await new Promise((r) => setTimeout(r, 8000));
          await route.continue();
        },
      );
      if (changeError) {
        await ctx.close();
        return changeError.trim();
      }

      const m = await measure(page);
      const panel = await page.locator("[data-testid=finishing-sign-in]").count();
      const seen = await page.evaluate(
        () =>
          document.querySelector("[data-testid=finishing-sign-in]")?.textContent?.trim() ?? null,
      );
      await page.screenshot({ path: `${OUT}/s01-signing-in-${w}-${theme}.png` });
      log(`    shot: s01-signing-in-${w}-${theme}.png`);
      log(`    heading=${JSON.stringify(m.heading)} panel=${panel} text=${JSON.stringify(seen)}`);
      journal.loading.push({
        w,
        theme,
        heading: m.heading,
        panel,
        seen,
        prompts: m.passwordPrompts,
      });

      check(panel === 1, `the signing-in state renders at ${w}px ${theme}`, `n=${panel}`);
      check(
        m.passwordPrompts === 0,
        `no password box while signing in at ${w}px ${theme}`,
        `n=${m.passwordPrompts}`,
      );
      check(
        m.heading === "Signing you in",
        `the heading follows the step at ${w}px ${theme}`,
        String(m.heading),
      );

      // Let the held login through and confirm the account really lands in the app. Waited on rather
      // than slept through, so a slow machine does not read as a broken flow.
      await page
        .waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 45_000 })
        .catch(() => {});
      const landed = await measure(page);
      check(
        landed.href.startsWith(`${BASE}/app`),
        `the delayed sign-in still completes at ${w}px ${theme}`,
        landed.href,
      );
      if (!landed.href.startsWith(`${BASE}/app`)) {
        log(`    ! logins: ${JSON.stringify(page.__logins)}`);
        log(`    ! alert=${JSON.stringify(landed.alert)} status=${JSON.stringify(landed.status)}`);
        await page.screenshot({ path: `${OUT}/s90-stuck-${w}-${theme}.png` });
      }
      await ctx.close();
      return null;
    });
  }
}

// ── B. the error state ───────────────────────────────────────────────────────
log("\n=== B. the sign-in refused AFTER the change succeeded ===");
await withRetryOnOutage("the error state", async (attempt) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const { changeError } = await toTheMoment(page, `errx${attempt}`, async (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "SERVICE_UNAVAILABLE", message: "upstream", details: [], traceId: "t" },
      }),
    }),
  );
  if (changeError) {
    await ctx.close();
    return changeError.trim();
  }
  await page.waitForTimeout(2500);
  const m = await measure(page);
  const passwordKept = await page.evaluate(
    () => document.querySelector('input[name="password"]')?.value?.length ?? -1,
  );
  await page.screenshot({ path: `${OUT}/s02-signin-failed-after-change.png` });
  log(`    shot: s02-signin-failed-after-change.png`);
  log(`    status=${JSON.stringify(m.status)}`);
  log(`    alert=${JSON.stringify(m.alert)}`);
  journal.error = { status: m.status, alert: m.alert, passwordKept };

  check(
    /your new password is saved/i.test(m.status ?? ""),
    "the user is told the change itself succeeded",
    m.status ?? "(none)",
  );
  check(
    /could not sign you in/i.test(m.alert ?? ""),
    "the failure is named in words, with a retry",
    m.alert ?? "(none)",
  );
  check(
    !/status code|SERVICE_UNAVAILABLE|axios/i.test(m.alert ?? ""),
    "no raw transport error is shown (DESIGN-BRIEF §27)",
    m.alert ?? "(none)",
  );
  check(
    passwordKept === CHOSEN.length,
    "the password they chose is still in the box — the retry is one click",
    `len=${passwordKept}`,
  );

  // And the retry actually works, once the route is let go.
  await page.unroute(`${API}/api/v1/auth/login`);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForTimeout(6000);
  const recovered = await measure(page);
  await page.screenshot({ path: `${OUT}/s03-recovered.png` });
  log(`    shot: s03-recovered.png  href=${recovered.href}`);
  journal.recovered = recovered.href;
  check(recovered.href.startsWith(`${BASE}/app`), "the retry signs them in", recovered.href);
  await ctx.close();
  return null;
});

journal.fails = fails;
writeFileSync(`${OUT}/f19-states.json`, JSON.stringify(journal, null, 2));
log(`\n${fails.length === 0 ? "ALL CHECKS PASSED" : `${fails.length} FAILING CHECK(S)`}`);
for (const f of fails) log("   ✗", f);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
