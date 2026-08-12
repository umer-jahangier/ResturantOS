/*
 * F12 — REPRODUCTION: does the forced-password-change link really carry the reset token and the
 * user's email in the URL query string?
 *
 * Drives the exact path a new hire meets on their first minute:
 *   owner@terrace.local → /app/users → Add a user (role Cashier) → one-time password
 *   → the new hire signs in in a SEPARATE browser context → forced change screen → sets a password
 *
 * Records `window.location.href` / `.search` at EVERY navigation (framenavigated), plus the
 * document.referrer that the next request would carry, plus the full session history length.
 * Nothing here is asserted from the source — every claim is read out of the live browser.
 *
 * <b>This is the BEFORE harness and it is kept deliberately.</b> Run against the build at
 * 8362f61 it printed `leakedUrls = 1`, with
 * `/login/change-password?token=<uuid>.<44 chars>&email=…` in the tab's history — the screenshots
 * are `.planning/audits/floor/F12/before-*.png`. Run against the fix it prints `leakedUrls = 0`,
 * which is the point: the same probe, unchanged, answers differently. `f12-prove.mjs` is the one
 * that asserts; this one only reports what it saw.
 */
import { PEOPLE, newBrowser, newPage, login, BASE, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F12");
mkdirSync(OUT, { recursive: true });

/**
 * `node e2e/floor/f12/f12-repro.mjs before|after` — the label prefixes every artefact.
 *
 * Without it a second run silently overwrites the first, which for a before/after probe destroys
 * exactly the half that is hardest to reproduce. Learned by doing it.
 */
const LABEL = process.argv[2] ?? "after";

async function shot(page, name) {
  const p = `${OUT}/${LABEL}-${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  log(`    shot: ${LABEL}-${name}.png`);
  return p;
}

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `f12.hire.${STAMP}@terrace.local`,
  fullName: `F12 Hire ${STAMP}`,
  newPassword: "F12#Hire!Pass1",
};

const browser = await newBrowser();
log("  new hire will be:", NEW.email);

// ── owner creates the account ────────────────────────────────────────────────
log("\n=== owner hires a cashier ===");
const owner = await newPage(browser);
// Ten agents share this machine and login occasionally answers CONCURRENT_MODIFICATION
// (an optimistic-lock clash on the user row). That is not this finding; retry through it
// rather than scoring a transient 409 as a broken login.
let signedIn = false;
for (let attempt = 1; attempt <= 4 && !signedIn; attempt++) {
  try {
    await login(owner, PEOPLE.owner);
    signedIn = true;
  } catch (e) {
    const onScreen = await owner.evaluate(
      () => document.querySelector('[role="alert"]')?.innerText?.trim() ?? "(no alert)",
    );
    log(`  owner login attempt ${attempt} failed: ${e.message} | alert: ${onScreen}`);
    await owner.waitForTimeout(4000);
  }
}
if (!signedIn) throw new Error("owner could not sign in after 4 attempts");
await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
await owner.waitForTimeout(5000);
await shot(owner, "01-owner-users");

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
await shot(owner, "02-account-created");

const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
log("  one-time password:", otp);
if (!otp) throw new Error("no one-time password panel — cannot continue");

// ── the new hire signs in, in their own context ──────────────────────────────
log("\n=== the new hire signs in for the first time ===");
const hire = await newPage(browser);

/** Every URL the tab ever pointed at, as the browser saw it. */
const urls = [];
hire.on("framenavigated", (f) => {
  if (f === hire.mainFrame()) urls.push({ how: "framenavigated", url: f.url() });
});

async function snapshot(label) {
  const s = await hire.evaluate(() => ({
    href: location.href,
    search: location.search,
    referrer: document.referrer,
    historyLength: history.length,
  }));
  log(`  [${label}] href=${s.href}`);
  log(`  [${label}] search=${JSON.stringify(s.search)} referrer=${JSON.stringify(s.referrer)}`);
  return { label, ...s };
}

const steps = [];
await hire.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await hire.waitForTimeout(1800);
steps.push(await snapshot("login"));

const slug = hire.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await hire.locator('input[name="email"], input#email').first().fill(NEW.email);
await hire.locator('input[name="password"], input#password').first().fill(otp);
await hire.locator('button[type="submit"]').first().click();
await hire.waitForTimeout(5000);
steps.push(await snapshot("after-first-signin"));
await shot(hire, "03-forced-change-screen");

// Fill the forced-change form.
const pw = hire.locator("input[type=password]");
const n = await pw.count();
log("  password fields on this screen:", n);
if (n >= 3) {
  await pw.nth(0).fill(otp);
  await pw.nth(1).fill(NEW.newPassword);
  await pw.nth(2).fill(NEW.newPassword);
  await shot(hire, "04-change-filled");
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
  steps.push(await snapshot("after-change"));
  await shot(hire, "05-after-change");
}

// ── what a proxy / history / Referer would have seen ─────────────────────────
log("\n=== every URL this tab ever held ===");
for (const u of urls) log("   ", u.url);

const leaked = urls.filter((u) => /[?&](token|email)=/.test(u.url));
log("\n  URLs carrying token= or email= :", leaked.length);
for (const u of leaked) log("    LEAK:", u.url);

/*
 * The record is written REDACTED. The whole point of this harness is that the token was in a URL,
 * and a file that reproduces the leak into the repository has not proved the finding, it has
 * repeated it. The shape — which parameter, on which path, at which step — is what the evidence
 * needs; the 60 characters of secret are not.
 */
const redact = (s) =>
  String(s).replace(/([?&](?:token|email)=)[^&]*/gi, (_m, k) => `${k}<REDACTED>`);
writeFileSync(
  `${OUT}/f12-repro-${LABEL}.json`,
  JSON.stringify(
    {
      newHire: NEW.email,
      urls: urls.map((u) => ({ ...u, url: redact(u.url) })),
      steps: steps.map((s) => ({ ...s, href: redact(s.href), search: redact(s.search) })),
      leaked: leaked.map((u) => redact(u.url)),
      leakedCount: leaked.length,
    },
    null,
    2,
  ),
);

await browser.close();
log("\nF12 repro done. leakedUrls =", leaked.length);
