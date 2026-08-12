/*
 * F12 — PROOF: a new hire completes the forced password change and no URL ever carries the
 * single-use change token or their email address.
 *
 * The click path, exactly as the brief specifies it:
 *   owner@terrace.local → /app/users → Add a user (Cashier, main branch) → one-time password
 *   → the new hire signs in in their own browser context
 *   → the forced-change panel appears WITHOUT a navigation
 *   → they set a password and sign in with it
 *
 * What is measured, all of it read out of the live browser rather than the source:
 *   - `window.location.search` and `.href` at every step;
 *   - every URL the tab ever held, via `framenavigated`, so a URL that existed for 40 ms and was
 *     replaced still counts as having been in history and in the proxy log;
 *   - `document.referrer` at each step — the header the NEXT request would carry;
 *   - the full `?token=`/`?email=` scan across all of the above;
 *   - that the change actually completed (the new password signs in and lands in the app);
 *   - that the change token is still single-use: replaying the exact token captured off the wire
 *     from the 403 is refused by auth-service.
 */
import { PEOPLE, newBrowser, newPage, login, BASE, API, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F12");
mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  log(`    shot: ${name}.png`);
  return p;
}

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `f12.hire.${STAMP}@terrace.local`,
  fullName: `F12 Hire ${STAMP}`,
  newPassword: "F12#Hire!Pass1",
};

const fail = [];
function check(ok, what, detail) {
  log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(what);
}

const browser = await newBrowser();
log("  new hire will be:", NEW.email);

// ── owner creates the account ────────────────────────────────────────────────
log("\n=== owner hires a cashier ===");
const owner = await newPage(browser);
let signedIn = false;
for (let attempt = 1; attempt <= 4 && !signedIn; attempt++) {
  try {
    await login(owner, PEOPLE.owner);
    signedIn = true;
  } catch (e) {
    // Ten agents share this machine; login occasionally answers CONCURRENT_MODIFICATION (an
    // optimistic-lock clash on the user row). Retry through it rather than scoring it as a defect.
    log(`  owner login attempt ${attempt} failed: ${e.message}`);
    await owner.waitForTimeout(4000);
  }
}
if (!signedIn) throw new Error("owner could not sign in after 4 attempts");

await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
await owner.waitForTimeout(5000);
await shot(owner, "p01-owner-users");

await owner
  .getByRole("button", { name: /add (a )?user|new user/i })
  .first()
  .click();
await owner.waitForTimeout(1200);
await owner.locator("input[type=email]").first().fill(NEW.email);
const nameInput = owner.locator('input[placeholder="Optional"]');
if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);
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
await shot(owner, "p02-account-created");

const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
log("  one-time password handed over:", otp ? `${otp.length} chars` : "(none)");
if (!otp) throw new Error("no one-time password panel — cannot continue");
// Dismiss the hand-over dialog; it is modal and blocks the second creation below.
await owner
  .getByRole("button", { name: /^Done$/i })
  .first()
  .click();
await owner.waitForTimeout(1500);

// ── the new hire's first minute ──────────────────────────────────────────────
log("\n=== the new hire's first minute ===");
const hire = await newPage(browser);

/** Every URL the tab ever pointed at, as the browser saw it. */
const urls = [];
hire.on("framenavigated", (f) => {
  if (f === hire.mainFrame()) urls.push(f.url());
});

/**
 * The change token as auth-service put it on the wire. Read from the 403 body, which is the ONLY
 * place it legitimately travels — a response body is not written to history, not sent as a Referer
 * and not recorded in a URL access log.
 */
let wireToken = null;
hire.on("response", async (r) => {
  if (!r.url().includes("/api/v1/auth/login") || r.status() !== 403) return;
  try {
    const body = await r.json();
    const d = body?.error?.details?.find?.((x) => x.field === "changeToken");
    if (d) wireToken = d.issue;
  } catch {
    /* not JSON — nothing to read */
  }
});

const steps = [];
async function snapshot(label) {
  const s = await hire.evaluate(() => ({
    href: location.href,
    search: location.search,
    hash: location.hash,
    referrer: document.referrer,
    historyLength: history.length,
  }));
  log(`  [${label}] href=${s.href}`);
  log(`  [${label}] search=${JSON.stringify(s.search)} referrer=${JSON.stringify(s.referrer)}`);
  steps.push({ label, ...s });
  return s;
}

await hire.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await hire.waitForTimeout(1800);
await snapshot("1-login");

const slug = hire.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await hire.locator('input[name="email"], input#email').first().fill(NEW.email);
await hire.locator('input[name="password"], input#password').first().fill(otp);
await hire.locator('button[type="submit"]').first().click();
await hire.waitForTimeout(5000);
const afterSignin = await snapshot("2-forced-change-panel");
await shot(hire, "p03-forced-change-panel");

const panel = await hire.locator("[data-testid=forced-password-change]").count();
check(panel === 1, "the forced-change panel is on screen", `count=${panel}`);
check(
  afterSignin.href === `${BASE}/login`,
  "the address bar is still exactly /login",
  afterSignin.href,
);
check(afterSignin.search === "", "location.search is empty at the change step");

// The current password is carried in memory from the sign-in the user just made.
const prefilled = await hire.evaluate(() => {
  const el = document.querySelector('input[name="currentPassword"]');
  return el ? el.value.length : -1;
});
check(prefilled === otp.length, "the one-time password is carried over, not retyped", `len=${prefilled}`);

await hire.locator('input[name="newPassword"]').fill(NEW.newPassword);
await hire.locator('input[name="confirmPassword"]').fill(NEW.newPassword);
await shot(hire, "p04-change-filled");
await hire.getByRole("button", { name: /^Change password$/i }).click();
await hire.waitForTimeout(5000);
const afterChange = await snapshot("3-after-change");
await shot(hire, "p05-after-change");

const noticeText = await hire.evaluate(
  () => document.querySelector('[role="status"]')?.textContent?.trim() ?? "(none)",
);
check(/sign in with your new password/i.test(noticeText), "the change is confirmed on screen", noticeText);
check(afterChange.search === "", "location.search is empty after the change");

const emailKept = await hire.evaluate(
  () => document.querySelector('input[name="email"]')?.value ?? "",
);
check(emailKept === NEW.email, "the email survived without ever being in the URL", emailKept);

// ── the new password actually works ──────────────────────────────────────────
log("\n=== the new hire signs in with the password they chose ===");
await hire.locator('input[name="password"]').fill(NEW.newPassword);
await hire.getByRole("button", { name: /^Sign in$/i }).click();
await hire.waitForTimeout(6000);
const landed = await snapshot("4-signed-in");
await shot(hire, "p06-signed-in");
check(!landed.href.includes("/login"), "the new password signs in", landed.href);

// ── the token is still single-use ────────────────────────────────────────────
log("\n=== replaying the captured change token ===");
check(Boolean(wireToken), "the change token was observed on the wire (403 body)");
let replay = null;
if (wireToken) {
  replay = await hire.evaluate(
    async ({ api, token, cur, next }) => {
      const r = await fetch(`${api}/api/v1/auth/change-password/forced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeToken: token,
          currentPassword: cur,
          newPassword: next,
        }),
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, code: body?.error?.code ?? null, message: body?.error?.message ?? null };
    },
    { api: API, token: wireToken, cur: NEW.newPassword, next: "F12#Replayed!Pass2" },
  );
  log("  replay answered:", JSON.stringify(replay));
  check(replay.status >= 400, "a second use of the same token is refused", `${replay.status} ${replay.code}`);
}

// ── the whole URL history ────────────────────────────────────────────────────
log("\n=== every URL this tab ever held ===");
for (const u of urls) log("   ", u);
const leaked = urls.filter((u) => /[?&](token|email)=/i.test(u));
check(leaked.length === 0, "no URL ever carried token= or email=", `leaked=${leaked.length}`);
const referrerLeak = steps.filter((s) => /[?&](token|email)=/i.test(s.referrer || ""));
check(referrerLeak.length === 0, "no step would send a token/email in a Referer header");
const searchLeak = steps.filter((s) => /token|email/i.test(s.search || ""));
check(searchLeak.length === 0, "no step had token/email in location.search");

// ── the stale link still lands somewhere useful ──────────────────────────────
log("\n=== a stale /login/change-password link ===");
await hire.goto(`${BASE}/login/change-password?token=stale-token&email=someone%40terrace.local`, {
  waitUntil: "domcontentloaded",
});
await hire.waitForTimeout(2500);
const stale = await snapshot("5-stale-link");
await shot(hire, "p07-stale-link");
check(
  stale.href === `${BASE}/login` || stale.href.startsWith(`${BASE}/app`),
  "the old route redirects and drops the query",
  stale.href,
);
check(!/token|email/i.test(stale.search), "the redirect forwards no token/email", stale.search);

// ── responsive / theme sweep of the changed panel ────────────────────────────
log("\n=== the change panel at 390 / 768 / 1440, light and dark ===");
const sweep = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const sp = await sweep.newPage();
const SWEEP = {
  slug: "floating-terrace",
  email: `f12.sweep.${STAMP}@terrace.local`,
  fullName: `F12 Sweep ${STAMP}`,
};
await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
await owner.waitForTimeout(5000);
await owner
  .getByRole("button", { name: /add (a )?user|new user/i })
  .first()
  .click();
await owner.waitForTimeout(1200);
await owner.locator("input[type=email]").first().fill(SWEEP.email);
const bs2 = owner.locator("#create-user-branch");
const bo2 = await bs2.locator("option").allTextContents();
const mi2 = bo2.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
await bs2.selectOption({ index: mi2 > 0 ? mi2 : 1 });
await owner.waitForTimeout(500);
const rs2 = owner.locator("[data-testid=role-select]");
const ro2 = await rs2.locator("option").allTextContents();
await rs2.selectOption({ label: ro2.find((t) => /cashier/i.test(t)) });
await owner.waitForTimeout(400);
await owner
  .getByRole("button", { name: /^Create user$/i })
  .first()
  .click();
await owner.waitForTimeout(4000);
const otp2 = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);

if (otp2) {
  for (const theme of ["light", "dark"]) {
    for (const [w, h] of [
      [390, 844],
      [768, 1024],
      [1440, 950],
    ]) {
      await sp.setViewportSize({ width: w, height: h });
      await sp.emulateMedia({ colorScheme: theme });
      await sp.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await sp.waitForTimeout(1600);
      const sl = sp.locator('input[name="tenantSlug"], input#tenantSlug');
      if (await sl.count()) await sl.first().fill(SWEEP.slug);
      await sp.locator('input[name="email"]').fill(SWEEP.email);
      await sp.locator('input[name="password"]').fill(otp2);
      await sp.locator('button[type="submit"]').first().click();
      await sp.waitForTimeout(4500);
      const visible = await sp.locator("[data-testid=forced-password-change]").count();
      const url = sp.url();
      check(
        visible === 1 && url === `${BASE}/login`,
        `change panel renders at ${w}px ${theme}`,
        `panel=${visible} url=${url}`,
      );
      await sp.screenshot({ path: `${OUT}/p08-panel-${w}-${theme}.png`, fullPage: false });
      log(`    shot: p08-panel-${w}-${theme}.png`);
      await sp.waitForTimeout(1200); // the login route is rate-limited at 2/s
    }
  }
}

writeFileSync(
  `${OUT}/f12-prove.json`,
  JSON.stringify(
    { newHire: NEW.email, urls, steps, leaked, replay, failures: fail },
    null,
    2,
  ),
);

await browser.close();
log(`\nF12 proof done. failures = ${fail.length}${fail.length ? `: ${fail.join(" | ")}` : ""}`);
process.exit(fail.length ? 1 : 0);
