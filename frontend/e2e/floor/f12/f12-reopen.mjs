/*
 * F12 — INDEPENDENT RE-OPEN ATTEMPT.
 *
 * Not a re-run of f12-prove.mjs. This drives the same finding from angles that harness did not
 * take, on the theory that a leak closed on ONE producer is not closed on the others:
 *
 *   1. the core claim, driven again from scratch (new hire, own browser context);
 *   2. RELOAD — the brief's "did it PERSIST?". The token now lives in React state, which a reload
 *      destroys. Does the user land somewhere recoverable, or in a dead end?
 *   3. the OTHER producer of a forced change: an admin resetting an EXISTING user's password from
 *      /app/users. Different button, same panel — does it leak?
 *   4. token abuse: replay a live change token against a DIFFERENT account's email;
 *   5. wrong persona: can a cashier reach the user-admin screen that mints these tokens?
 *   6. the interceptor fix, on the endpoint the widened exemption list now covers.
 */
import { PEOPLE, newBrowser, newPage, login, BASE, API, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F12/reopen");
mkdirSync(OUT, { recursive: true });

const STAMP = Date.now().toString().slice(-6);
const HIRE = {
  slug: "floating-terrace",
  email: `f12ro.hire.${STAMP}@terrace.local`,
  fullName: `F12RO Hire ${STAMP}`,
  newPassword: "F12ro#Hire!Pass1",
};
const VICTIM = {
  slug: "floating-terrace",
  email: `f12ro.reset.${STAMP}@terrace.local`,
  fullName: `F12RO Reset ${STAMP}`,
  newPassword: "F12ro#Reset!Pass1",
};

const fail = [];
const results = [];
function check(ok, what, detail) {
  log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  results.push({ ok, what, detail: detail ?? null });
  if (!ok) fail.push(what);
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

/** Redact a token so the evidence file does not itself become the leak. */
const redact = (s) => (s ? `${s.slice(0, 6)}…(${s.length} chars)` : String(s));

const LEAK_RE = /(^|[?&#])(token|email)=/i;

const browser = await newBrowser();
log("  hire:", HIRE.email, "| reset-victim:", VICTIM.email);

// ─────────────────────────────────────────────────────────────────────────────
// owner creates two accounts
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== owner hires two people ===");
const owner = await newPage(browser);
let signedIn = false;
for (let a = 1; a <= 5 && !signedIn; a++) {
  try {
    await login(owner, PEOPLE.owner);
    signedIn = true;
  } catch (e) {
    log(`  owner login attempt ${a} failed: ${e.message}`);
    await owner.waitForTimeout(4000);
  }
}
if (!signedIn) throw new Error("owner could not sign in after 5 attempts");

async function createUser(who) {
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(4000);
  await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
  await owner.waitForTimeout(1500);
  await owner.locator("input[type=email]").first().fill(who.email);
  const nameInput = owner.locator('input[placeholder="Optional"]');
  if (await nameInput.count()) await nameInput.first().fill(who.fullName);
  const branchSel = owner.locator("#create-user-branch");
  const branchOpts = await branchSel.locator("option").allTextContents();
  const mainIdx = branchOpts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
  await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
  await owner.waitForTimeout(500);
  const roleSel = owner.locator("[data-testid=role-select]");
  const roleOpts = await roleSel.locator("option").allTextContents();
  await roleSel.selectOption({ label: roleOpts.find((t) => /cashier/i.test(t)) });
  await owner.waitForTimeout(400);
  await owner.getByRole("button", { name: /^Create user$/i }).first().click();
  await owner.waitForTimeout(4500);
  const otp = await owner.evaluate(
    () =>
      document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
  );
  if (!otp) throw new Error(`no one-time password handed over for ${who.email}`);
  await owner.getByRole("button", { name: /^Done$/i }).first().click();
  await owner.waitForTimeout(1500);
  log(`  created ${who.email} — otp ${redact(otp)}`);
  return otp;
}

const hireOtp = await createUser(HIRE);
const victimOtp = await createUser(VICTIM);

// ─────────────────────────────────────────────────────────────────────────────
// instrumented page factory
// ─────────────────────────────────────────────────────────────────────────────
async function instrumented() {
  const page = await newPage(browser);
  const urls = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) urls.push(f.url());
  });
  let wireToken = null;
  page.on("response", async (r) => {
    if (!r.url().includes("/api/v1/auth/login") || r.status() !== 403) return;
    try {
      const b = await r.json();
      const d = b?.error?.details?.find?.((x) => x.field === "changeToken");
      if (d) wireToken = d.issue;
    } catch {
      /* not JSON */
    }
  });
  return { page, urls, token: () => wireToken };
}

async function snap(page, label) {
  const s = await page.evaluate(() => ({
    href: location.href,
    search: location.search,
    hash: location.hash,
    referrer: document.referrer,
  }));
  log(`  [${label}] ${s.href} search=${JSON.stringify(s.search)} ref=${JSON.stringify(s.referrer)}`);
  return { label, ...s };
}

async function signIn(page, slug, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const slugI = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugI.count()) await slugI.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. the core claim, driven from scratch
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 1. the new hire's first minute ===");
const { page: hire, urls: hireUrls, token: hireToken } = await instrumented();
await signIn(hire, HIRE.slug, HIRE.email, hireOtp);
const s1 = await snap(hire, "panel");
await shot(hire, "r01-panel");

const panelCount = await hire.locator("[data-testid=forced-password-change]").count();
check(panelCount === 1, "forced-change panel renders in place", `count=${panelCount}`);
check(s1.href === `${BASE}/login`, "address bar is exactly /login", s1.href);
check(s1.search === "", "location.search empty at the change step", JSON.stringify(s1.search));
check(!LEAK_RE.test(s1.referrer), "document.referrer carries no token/email", s1.referrer || "(empty)");

// ─────────────────────────────────────────────────────────────────────────────
// 2. RELOAD — the brief's persistence probe
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 2. reload while the panel is up ===");
await hire.reload({ waitUntil: "domcontentloaded" });
await hire.waitForTimeout(3000);
const s2 = await snap(hire, "after-reload");
await shot(hire, "r02-after-reload");
const panelAfterReload = await hire.locator("[data-testid=forced-password-change]").count();
const loginFormAfterReload = await hire.locator('input[name="email"], input#email').count();
log(`  after reload: panel=${panelAfterReload} loginForm=${loginFormAfterReload}`);
check(
  s2.search === "" && !LEAK_RE.test(s2.href),
  "reload does not resurrect a token/email in the URL",
  s2.href,
);
check(
  panelAfterReload === 1 || loginFormAfterReload >= 1,
  "reload lands on a usable screen (panel or sign-in), not a dead end",
  `panel=${panelAfterReload} loginForm=${loginFormAfterReload}`,
);
const reloadDropsPanel = panelAfterReload === 0;
log(`  NOTE: reload ${reloadDropsPanel ? "DROPS the panel (token is in memory)" : "keeps the panel"}`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. wrong current password → the interceptor fix
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 3. a wrong one-time password on the panel ===");
const { page: bad } = await instrumented();
await signIn(bad, HIRE.slug, HIRE.email, hireOtp);
if ((await bad.locator("[data-testid=forced-password-change]").count()) === 1) {
  await bad.locator('input[name="currentPassword"]').fill("Totally#Wrong9Pass");
  await bad.locator('input[name="newPassword"]').fill(HIRE.newPassword);
  await bad.locator('input[name="confirmPassword"]').fill(HIRE.newPassword);
  await bad.getByRole("button", { name: /change password/i }).first().click();
  await bad.waitForTimeout(4000);
  const s3 = await snap(bad, "wrong-current");
  await shot(bad, "r03-wrong-current-password");
  const alertText = await bad.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean)
      .join(" | "),
  );
  log(`  alert: ${alertText || "(none)"}`);
  check(
    !s3.href.includes("reason=session_expired"),
    "a wrong current password is NOT reported as an expired session",
    s3.href,
  );
  check(alertText.length > 0, "the panel renders its own refusal message", alertText || "(none)");
  check(s3.href === `${BASE}/login`, "address bar still /login after the refusal", s3.href);
} else {
  check(false, "could not reach the panel for the wrong-password probe");
}
await bad.close();

// ─────────────────────────────────────────────────────────────────────────────
// 4. complete the change and sign in
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 4. complete the change ===");
const { page: hire2, urls: hire2Urls, token: hire2Token } = await instrumented();
await signIn(hire2, HIRE.slug, HIRE.email, hireOtp);
check(
  (await hire2.locator("[data-testid=forced-password-change]").count()) === 1,
  "panel reachable again after a failed attempt",
);
await hire2.locator('input[name="newPassword"]').fill(HIRE.newPassword);
await hire2.locator('input[name="confirmPassword"]').fill(HIRE.newPassword);
await shot(hire2, "r04-filled");
await hire2.getByRole("button", { name: /change password/i }).first().click();
await hire2.waitForTimeout(4500);
const s4 = await snap(hire2, "changed");
await shot(hire2, "r05-changed");
const statusText = await hire2.evaluate(
  () =>
    Array.from(document.querySelectorAll('[role="status"],[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean)
      .join(" | ") || "(none)",
);
log(`  status: ${statusText}`);
check(/changed/i.test(statusText), "the change reports success", statusText);
check(s4.search === "", "search still empty after the change", JSON.stringify(s4.search));

const capturedToken = hire2Token();
log(`  token captured off the wire: ${redact(capturedToken)}`);

// sign in with the new password
await signIn(hire2, HIRE.slug, HIRE.email, HIRE.newPassword);
const s5 = await snap(hire2, "signed-in");
await shot(hire2, "r06-signed-in");
check(!s5.href.includes("/login"), "the new password signs in and leaves /login", s5.href);

const allHireUrls = [...hireUrls, ...hire2Urls];
const leaking = allHireUrls.filter((u) => LEAK_RE.test(u));
log(`  every URL the hire's tabs held (${allHireUrls.length}):`);
for (const u of [...new Set(allHireUrls)]) log(`    ${LEAK_RE.test(u) ? "LEAK " : "     "}${u}`);
check(leaking.length === 0, "no URL in the whole flow carried token= or email=", `leaks=${leaking.length}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. token replay: same user, and a DIFFERENT user
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 5. token replay ===");
if (capturedToken) {
  const replaySame = await hire2.evaluate(
    async ([api, email, token, pw]) => {
      const r = await fetch(`${api}/api/v1/auth/change-password/forced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, changeToken: token, currentPassword: pw, newPassword: "Replay#Attack1x" }),
      });
      return { status: r.status, body: (await r.text()).slice(0, 300) };
    },
    [API, HIRE.email, capturedToken, hireOtp],
  );
  log(`  replay (same user): ${replaySame.status} ${replaySame.body}`);
  check(replaySame.status >= 400, "the change token is single-use — replay refused", `HTTP ${replaySame.status}`);

  const replayOther = await hire2.evaluate(
    async ([api, email, token]) => {
      const r = await fetch(`${api}/api/v1/auth/change-password/forced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          changeToken: token,
          currentPassword: "irrelevant",
          newPassword: "Crossuser#Attack1",
        }),
      });
      return { status: r.status, body: (await r.text()).slice(0, 300) };
    },
    [API, VICTIM.email, capturedToken],
  );
  log(`  replay (DIFFERENT user): ${replayOther.status} ${replayOther.body}`);
  check(
    replayOther.status >= 400,
    "a change token cannot be redeemed against another account",
    `HTTP ${replayOther.status}`,
  );
} else {
  check(false, "no token captured off the wire — replay probes could not run");
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. the stale link
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 6. the stale link ===");
const stale = await newPage(browser);
const staleUrls = [];
stale.on("framenavigated", (f) => {
  if (f === stale.mainFrame()) staleUrls.push(f.url());
});
await stale.goto(`${BASE}/login/change-password?token=STALE-TOKEN-abc123&email=someone%40terrace.local`, {
  waitUntil: "domcontentloaded",
});
await stale.waitForTimeout(3000);
const s6 = await snap(stale, "stale-link");
await shot(stale, "r07-stale-link");
check(s6.href === `${BASE}/login`, "a stale link lands on a clean /login", s6.href);
check(s6.search === "", "the stale query string is NOT forwarded", JSON.stringify(s6.search));
await stale.close();

// ─────────────────────────────────────────────────────────────────────────────
// 7. ADJACENT PRODUCER — an admin resets an existing user's password
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 7. adjacent producer: admin resets an existing user's password ===");
// First take the victim through their own forced change so they are a NORMAL user.
const { page: victim } = await instrumented();
await signIn(victim, VICTIM.slug, VICTIM.email, victimOtp);
if ((await victim.locator("[data-testid=forced-password-change]").count()) === 1) {
  await victim.locator('input[name="newPassword"]').fill(VICTIM.newPassword);
  await victim.locator('input[name="confirmPassword"]').fill(VICTIM.newPassword);
  await victim.getByRole("button", { name: /change password/i }).first().click();
  await victim.waitForTimeout(4000);
  log("  victim completed their initial forced change");
}
await victim.close();

// Now the owner resets that user's password from the admin screen.
await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
await owner.waitForTimeout(4500);
let resetOtp = null;
const row = owner.locator(`tr:has-text("${VICTIM.email}")`);
if (await row.count()) {
  await shot(owner, "r08-users-list");
  const resetBtn = row.first().getByRole("button", { name: /reset password|reset/i });
  const menuBtn = row.first().getByRole("button");
  if (await resetBtn.count()) {
    await resetBtn.first().click();
  } else if (await menuBtn.count()) {
    await menuBtn.last().click();
    await owner.waitForTimeout(1200);
    const item = owner.getByRole("menuitem", { name: /reset password/i });
    if (await item.count()) await item.first().click();
  }
  await owner.waitForTimeout(1500);
  const confirm = owner.getByRole("button", { name: /^(reset password|reset|confirm)$/i });
  if (await confirm.count()) {
    await confirm.last().click();
    await owner.waitForTimeout(4000);
  }
  await shot(owner, "r09-reset-dialog");
  resetOtp = await owner.evaluate(
    () =>
      document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
  );
  log(`  admin reset handed over: ${redact(resetOtp)}`);
}
if (resetOtp) {
  const { page: victim2, urls: victim2Urls } = await instrumented();
  await signIn(victim2, VICTIM.slug, VICTIM.email, resetOtp);
  const s7 = await snap(victim2, "admin-reset-panel");
  await shot(victim2, "r10-admin-reset-panel");
  const p = await victim2.locator("[data-testid=forced-password-change]").count();
  check(p === 1, "admin-reset user also lands on the in-place panel", `count=${p}`);
  check(s7.search === "", "admin-reset path leaks nothing in location.search", JSON.stringify(s7.search));
  const v2leaks = victim2Urls.filter((u) => LEAK_RE.test(u));
  for (const u of [...new Set(victim2Urls)]) log(`    ${LEAK_RE.test(u) ? "LEAK " : "     "}${u}`);
  check(v2leaks.length === 0, "admin-reset path: no URL carried token= or email=", `leaks=${v2leaks.length}`);
  await victim2.close();
} else {
  log("  NOTE: could not drive the admin reset button — recording as not-probed, not as a pass");
  results.push({ ok: null, what: "admin reset adjacent path", detail: "reset control not reachable in UI" });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. wrong persona — a cashier on the screen that mints these tokens
// ─────────────────────────────────────────────────────────────────────────────
log("\n=== 8. wrong persona: cashier on /app/users ===");
const cash = await newPage(browser);
try {
  await login(cash, PEOPLE.cashier);
  await cash.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await cash.waitForTimeout(4000);
  await shot(cash, "r11-cashier-users");
  const body = await cash.evaluate(() => document.body.innerText.slice(0, 600));
  const denied = /access denied|do not have permission|not authorized|forbidden/i.test(body);
  const canAdd = await cash.getByRole("button", { name: /add (a )?user|new user/i }).count();
  log(`  cashier sees denied=${denied} addUserButtons=${canAdd}`);
  check(denied || canAdd === 0, "a cashier cannot mint one-time passwords", `denied=${denied} addBtns=${canAdd}`);
} catch (e) {
  log(`  cashier probe failed: ${e.message}`);
  results.push({ ok: null, what: "cashier persona probe", detail: e.message });
}
await cash.close();

// ─────────────────────────────────────────────────────────────────────────────
writeFileSync(
  `${OUT}/f12-reopen.json`,
  JSON.stringify(
    {
      when: new Date().toISOString(),
      hire: HIRE.email,
      victim: VICTIM.email,
      reloadDropsPanel,
      urlsSeen: [...new Set(allHireUrls)],
      results,
      failures: fail,
    },
    null,
    2,
  ),
);
log(`\n=== ${results.filter((r) => r.ok === true).length} passed, ${fail.length} failed ===`);
for (const f of fail) log(`  FAILED: ${f}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
