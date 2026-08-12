/*
 * F19 — PROOF, driven in real Chromium against the running stack.
 *
 * DONE MEANS, verbatim: "Create a user as owner@terrace.local, sign in as them with the one-time
 * password, set a new password, and land on the application already signed in — no second
 * credential prompt. Reload once and confirm the session survives."
 *
 * Every check below is on something a person sees, or on the session the browser actually holds:
 *   - no `input[type=password]` and no "Sign in" button after the change;
 *   - the URL is inside `/app`;
 *   - the HttpOnly refresh cookie mints an access token (a URL alone proves nothing);
 *   - a real authenticated read succeeds on the hire's own bearer;
 *   - a full reload lands back in the app, still signed in.
 *
 * And two things that must NOT have regressed, because the fix rides on top of F12 and D-17:
 *   - no URL the tab ever held carried `token=` or `email=`;
 *   - the one-time password no longer works, and the chosen one does.
 */
import {
  BASE,
  API,
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
  email: `f19.prove.${STAMP}@terrace.local`,
  fullName: `F19 Prove ${STAMP}`,
  newPassword: "F19#Proven!Pass1",
};

const { check, fails } = reporter();
const browser = await newBrowser();
const journal = { email: NEW.email, at: new Date().toISOString(), steps: [] };

log("=== owner@terrace.local hires a cashier ===");
const owner = await ownerSignedIn(browser);
const otp = await hireCashier(owner, NEW);
log(`  one-time password handed over: ${otp.length} chars`);
await shot(owner, "p01-owner-created-user");

log("\n=== the new hire's first minute ===");
const hire = await newPage(browser);
const urls = [];
hire.on("framenavigated", (f) => {
  if (f === hire.mainFrame()) urls.push(f.url());
});

await hire.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await hire.waitForTimeout(1800);
await shot(hire, "p02-login");

const slug = hire.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await hire.locator('input[name="email"]').first().fill(NEW.email);
await hire.locator('input[name="password"]').first().fill(otp);
await hire.locator('button[type="submit"]').first().click();
await hire.waitForTimeout(5000);

const atChange = await measure(hire);
journal.steps.push({ label: "forced-change-panel", ...atChange });
log(`  [change step] heading=${JSON.stringify(atChange.heading)} href=${atChange.href}`);
await shot(hire, "p03-forced-change-panel");
check(atChange.changePanel === 1, "the forced-change panel is on screen", `n=${atChange.changePanel}`);

await hire.locator('input[name="newPassword"]').fill(NEW.newPassword);
await hire.locator('input[name="confirmPassword"]').fill(NEW.newPassword);
await shot(hire, "p04-change-filled");

log("\n=== they press Change password, and nothing else ===");
await hire.getByRole("button", { name: /^Change password$/i }).click();
// Long enough to catch a credentials form that came back, short of any user patience.
await hire.waitForTimeout(7000);

const after = await measure(hire);
journal.steps.push({ label: "after-change", ...after });
log(`  [after change] href=${after.href}`);
log(`  [after change] heading=${JSON.stringify(after.heading)}`);
log(`  [after change] passwordPrompts=${after.passwordPrompts} signInButton=${after.hasSignInButton}`);
log(`  [after change] refresh=${after.refreshStatus} hasAccessToken=${after.hasAccessToken}`);
log(`  [after change] alert=${JSON.stringify(after.alert)}`);
log(`  [after change] snippet=${JSON.stringify(after.snippet)}`);
await shot(hire, "p05-signed-in-after-change");

check(after.alert === null, "no error alert on the way in", after.alert ?? "none");
check(
  after.passwordPrompts === 0,
  "NO second credential prompt — no password box anywhere",
  `passwordPrompts=${after.passwordPrompts}`,
);
check(!after.hasSignInButton, "no second Sign in button", `present=${after.hasSignInButton}`);
check(after.href.startsWith(`${BASE}/app`), "landed on the application", after.href);
check(after.hasAccessToken, "the browser holds a real session", `refresh=${after.refreshStatus}`);

// A session that cannot read anything is not a session. This is the hire's OWN bearer, minted from
// the cookie their tab holds — never an injected token.
const me = await hire.evaluate(async (api) => {
  const r = await fetch(`${api}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json().catch(() => null);
  const token = j?.accessToken ?? j?.data?.accessToken ?? null;
  if (!token) return { status: 0, body: null };
  const m = await fetch(`${api}/api/v1/auth/my-branches`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mb = await m.json().catch(() => null);
  return { status: m.status, count: mb?.data?.length ?? null };
}, API);
log(`  [authenticated read] /auth/my-branches → ${me.status}, branches=${me.count}`);
journal.myBranches = me;
check(me.status === 200, "the session can actually read on its own rights", `status=${me.status}`);

log("\n=== reload once ===");
await hire.reload({ waitUntil: "domcontentloaded" });
await hire.waitForTimeout(6000);
const reloaded = await measure(hire);
journal.steps.push({ label: "after-reload", ...reloaded });
log(`  [after reload] href=${reloaded.href}`);
log(`  [after reload] passwordPrompts=${reloaded.passwordPrompts} refresh=${reloaded.refreshStatus}`);
log(`  [after reload] snippet=${JSON.stringify(reloaded.snippet)}`);
await shot(hire, "p06-after-reload");
check(reloaded.href.startsWith(`${BASE}/app`), "the reload stayed in the app", reloaded.href);
check(reloaded.passwordPrompts === 0, "the reload asked for no credential", `n=${reloaded.passwordPrompts}`);
check(reloaded.hasAccessToken, "the session survived the reload", `refresh=${reloaded.refreshStatus}`);

log("\n=== the one-time password is dead, the chosen one is live ===");
const creds = await hire.evaluate(
  async ({ api, email, slug, otp, chosen }) => {
    async function tryLogin(password) {
      const r = await fetch(`${api}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, tenantSlug: slug }),
      });
      const j = await r.json().catch(() => null);
      return { status: r.status, code: j?.error?.code ?? null };
    }
    return { withOtp: await tryLogin(otp), withChosen: await tryLogin(chosen) };
  },
  { api: API, email: NEW.email, slug: NEW.slug, otp, chosen: NEW.newPassword },
);
log(`  one-time password → ${JSON.stringify(creds.withOtp)}`);
log(`  chosen password   → ${JSON.stringify(creds.withChosen)}`);
journal.credentials = creds;
check(creds.withOtp.status === 401, "the one-time password no longer works", `${creds.withOtp.status}`);
check(creds.withChosen.status === 200, "the chosen password is the account's password", `${creds.withChosen.status}`);

log("\n=== every URL this tab held (F12 must not have regressed) ===");
for (const u of urls) log("   ", u);
journal.urls = urls;
const leaked = urls.filter((u) => /[?&](token|email)=/i.test(u));
check(leaked.length === 0, "no URL ever carried token= or email=", `leaked=${leaked.length}`);

journal.fails = fails;
writeFileSync(`${OUT}/f19-prove.json`, JSON.stringify(journal, null, 2));
log(`\n${fails.length === 0 ? "ALL CHECKS PASSED" : `${fails.length} FAILING CHECK(S)`}`);
for (const f of fails) log("   ✗", f);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
