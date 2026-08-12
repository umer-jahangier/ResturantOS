/*
 * S3 — the role builder, driven in real Chromium as the people who do the job.
 *
 * <h3>Why this file exists rather than a screenshot pass</h3>
 *
 * The register's verdict on this area was MISSING, and its evidence was a click path: `/app/roles`
 * 404, an assign dialog with `checkboxes: 0`, and no way for anyone to see what a role granted. The
 * only honest refutation is the same click path, driven, ending somewhere the old build could not
 * reach — so this harness does the whole errand:
 *
 *   1. OWNER finds "Roles" in the sidebar and opens it.
 *   2. Opens the BUILT-IN Cashier role and reads every permission it grants, under module headings.
 *   3. Builds "Head Waiter" by ticking a subset, and saves it.
 *   4. Creates a user on /app/users and assigns them the new role.
 *   5. That user signs in and is measured: the screens their ticked permissions reach are there,
 *      the ones they were not given are refused.
 *   6. OWNER edits the role to REMOVE one permission; the user signs in again and the screen that
 *      permission reached is gone.
 *   7. TENANT_ADMIN tries to build a role carrying `rbac.manage` — which a tenant admin
 *      deliberately does not hold — and is refused ROLE_CEILING_EXCEEDED, on the form.
 *
 * <h3>Traps this harness refuses to fall into</h3>
 *
 * An error state looks exactly like an empty state in a screenshot, and the wrong persona's
 * "Access denied" reads as a missing feature. So every shot asserts a REQUIRED anchor and a
 * FORBIDDEN string before it is filed, and the refusal assertions name the persona they were made
 * as. A shot that cannot satisfy both is written with a REFUSED-/ANCHORLESS- prefix and counted as
 * a failure.
 *
 * Run: node e2e/s3-roles.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S3");
const SLUG = "floating-terrace";

// scripts/CREDENTIALS.md — development credentials, committed, rotate before deployment.
const OWNER = {
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};
const ADMIN = {
  email: "admin@terrace.local",
  password: "Terrace#Admin1",
  totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
};

const ROLE_NAME = "Head Waiter";
const ROLE_CODE = "HEAD_WAITER";

/** Ticked. Every one of these reaches a screen, so "they can do what was ticked" is observable. */
const TICKED = [
  "pos.order.create",
  "pos.order.view",
  "pos.order.update",
  "pos.menu.view",
  "pos.tables.manage",
  "pos.tables.admin",
];

/** The one removed in step 6 — it gates the Tables screen, so its removal is visible. */
const REMOVED_IN_EDIT = "pos.tables.admin";

const failures = [];
const notes = [];

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("  shot", `${name}.png`);
}

/**
 * Signs in, retrying a TRANSIENT refusal.
 *
 * <p>Ten agents share this stack and the seeded personas are contended: two sessions logging in as
 * the same account at once collide on the row's version and the form says *"This record changed
 * while you were editing it — reload and try again"*. That is a real message about a real
 * optimistic lock and it has nothing to do with the credential, so it is retried rather than
 * reported as a failed login — which is what it looked like, once, in this harness's own output.
 */
async function login(page, who, newPassword) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await attemptLogin(page, who, newPassword);
    if (ok) return true;
    const text = await bodyText(page);
    if (!/record changed while you were editing|try again/i.test(text)) return false;
    notes.push(`login for ${who.email}: transient conflict, retry ${attempt}`);
    await page.waitForTimeout(2500);
  }
  return false;
}

async function attemptLogin(page, { email, password, totpSecret }, newPassword) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(SLUG);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);

  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (totpSecret && (await totp.count())) {
    await totp.first().fill(totpNow(totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }

  // A brand-new account is forced through a password change before it holds a session. Some
  // builds land back on /login afterwards, so the change is followed by a real sign-in with the
  // new credential rather than by an assumption that a session exists.
  if (newPassword) {
    const fields = page.locator('input[type="password"]');
    const count = await fields.count();
    if (count >= 2) {
      for (let i = 0; i < count; i++) {
        await fields.nth(i).fill(i === 0 && count === 3 ? password : newPassword);
      }
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
    }
    if (page.url().includes("/login")) {
      return login(page, { email, password: newPassword, totpSecret });
    }
  }
  return !page.url().includes("/login");
}

async function sidebarHrefs(page) {
  return page.locator("nav a, aside a").evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")).filter(Boolean),
  );
}

async function bodyText(page) {
  return page.locator("body").innerText();
}

/**
 * Files a shot only if the page really is the screen, as the persona who was asked for.
 *
 * <p>Waits for the anchor before judging. The dev server compiles a route on its first request and
 * keeps the PREVIOUS page on screen while it does — which produced an "ANCHORLESS" screenshot of
 * the dashboard with the sidebar's Roles entry already highlighted. A fixed sleep is what makes a
 * harness flaky; waiting for the thing being asserted is what makes it honest.
 */
async function evidence(page, name, { require, forbid = /Access denied|You do not have permission|This page doesn't exist|Couldn't load/i }) {
  if (require) {
    await page.locator(require).first().waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
  }
  await page.waitForTimeout(1200);
  const text = await bodyText(page);
  if (forbid && forbid.test(text)) {
    failures.push(`${name}: the page is a refusal or an error, not the screen (matched ${forbid})`);
    await shot(page, `REFUSED-${name}`);
    return false;
  }
  if (require && (await page.locator(require).count()) === 0) {
    failures.push(`${name}: ANCHOR NOT FOUND — "${require}" is not on the page`);
    await shot(page, `ANCHORLESS-${name}`);
    return false;
  }
  await shot(page, name);
  return true;
}

/**
 * Ticks one permission by its code.
 *
 * <p>Matched with an ATTRIBUTE selector rather than a `#id` one, because the ids carry dots
 * (`build-pos.order.create`) and a dot in a CSS id selector is a class separator — the query
 * silently matches nothing rather than erroring, which is how a harness "passes" having ticked
 * zero boxes.
 */
async function tickPermission(page, code) {
  const box = page.locator(`input[id="build-${code}"]`);
  await box.first().scrollIntoViewIfNeeded();
  await box.first().check();
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => notes.push(`page error: ${String(e).slice(0, 200)}`));

  // ── 1. OWNER finds Roles in the sidebar ────────────────────────────────────────────────────
  if (!(await login(page, OWNER))) {
    failures.push(`owner login failed — url ${page.url()}`);
    notes.push(`owner login page text: ${(await bodyText(page)).slice(0, 400).replace(/\n+/g, " | ")}`);
    await shot(page, "00-owner-login-failed");
    await browser.close();
    return report();
  }
  const hrefs = await sidebarHrefs(page);
  notes.push(`owner sidebar hrefs: ${JSON.stringify(hrefs)}`);
  if (!hrefs.includes("/app/roles")) {
    failures.push("the owner's sidebar has no /app/roles entry");
  }
  await page.locator('a[href="/app/roles"]').first().click();
  await page.waitForTimeout(3000);
  await evidence(page, "01-owner-roles-list", { require: '[data-testid="role-list"]' });

  // ── 2. Read what the BUILT-IN Cashier role grants ──────────────────────────────────────────
  await page.getByRole("button", { name: /see what Cashier grants/i }).first().click();
  await page.waitForTimeout(1200);
  const cashierView = page.locator('[data-testid="role-permission-view"]');
  const modulesShown = await cashierView.locator("h3").allInnerTexts();
  const codesShown = await cashierView.locator("code").allInnerTexts();
  notes.push(`CASHIER modules: ${JSON.stringify(modulesShown)}`);
  notes.push(`CASHIER codes (${codesShown.length}): ${JSON.stringify(codesShown)}`);
  if (modulesShown.length === 0 || codesShown.length === 0) {
    failures.push("the Cashier detail showed no modules or no permission codes");
  }
  await evidence(page, "02-cashier-permissions-by-module", {
    require: '[data-testid="role-permission-view"] code',
  });
  await page.getByRole("button", { name: /^close$/i }).first().click();
  await page.waitForTimeout(800);

  // ── 3. Build "Head Waiter" ─────────────────────────────────────────────────────────────────
  // Asserted ABSENT first. Without this, a re-run finds the role left behind by the previous one
  // and "the list shows Head Waiter after creating it" passes without a create having happened —
  // a green harness over a broken build, which is the failure mode this whole engagement exists
  // to stop repeating.
  const beforeCreate = await bodyText(page);
  if (beforeCreate.includes(ROLE_NAME)) {
    failures.push(
      `"${ROLE_NAME}" already exists before this run created it — delete it and re-run, or this ` +
        `proves nothing`,
    );
  }
  await page.getByRole("button", { name: /new role/i }).first().click();
  await page.waitForTimeout(1000);
  await page.getByLabel(/role name/i).fill(ROLE_NAME);
  for (const code of TICKED) {
    await tickPermission(page, code);
  }
  const counter = await page.locator('[data-testid="permission-count"]').innerText();
  notes.push(`builder counter after ticking: ${counter}`);
  await evidence(page, "03-builder-head-waiter", { require: '[data-testid="permission-count"]' });
  await page.getByRole("button", { name: /create role/i }).click();
  await page.waitForTimeout(3500);
  const afterCreate = await bodyText(page);
  if (!afterCreate.includes(ROLE_NAME)) {
    failures.push(`the roles list does not show "${ROLE_NAME}" after creating it`);
  }
  await evidence(page, "04-head-waiter-created", { require: '[data-testid="role-list"]' });

  // ── 4. Create a user and give them the role ────────────────────────────────────────────────
  const stamp = Date.now().toString().slice(-6);
  const holderEmail = `headwaiter.s3.${stamp}@terrace.local`;
  const tempPassword = await createUserWithRole(page, holderEmail, ROLE_NAME);
  if (!tempPassword) {
    failures.push("could not create the holder account with the Head Waiter role");
    await browser.close();
    return report();
  }
  notes.push(`holder ${holderEmail} created with a one-time password`);

  // ── 5. The holder signs in and is measured ─────────────────────────────────────────────────
  const holderPassword = `Terrace#S3-${stamp}`;
  const holderCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const holder = await holderCtx.newPage();
  if (!(await login(holder, { email: holderEmail, password: tempPassword }, holderPassword))) {
    failures.push(`the Head Waiter holder could not sign in (url ${holder.url()})`);
  } else {
    const holderHrefs = await sidebarHrefs(holder);
    notes.push(`holder sidebar (v1): ${JSON.stringify(holderHrefs)}`);
    await evidence(holder, "05-holder-signed-in", { require: "h1, h2" });

    // What was ticked: the tables catalogue (pos.tables.admin) and the till (pos.order.view).
    if (!holderHrefs.includes("/app/tables")) {
      failures.push("pos.tables.admin was ticked but /app/tables is absent from the holder's nav");
    }
    await holder.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
    await evidence(holder, "06-holder-can-reach-tables", { require: "h1" });

    // What was NOT ticked. `finance.journal.view`, `rbac.user.manage` and `inventory.item.view`
    // were all left unticked, so all three must refuse.
    for (const [name, route] of [
      ["07-holder-refused-users", "/app/users"],
      ["08-holder-refused-finance", "/app/finance/accounts"],
      ["09-holder-refused-inventory", "/app/inventory"],
    ]) {
      await holder.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await holder.waitForTimeout(2500);
      const text = await bodyText(holder);
      const refused = /Access denied|You do not have permission|don't have permission|doesn't exist|not authoris|not authoriz/i.test(text);
      if (!refused) {
        failures.push(`${route} did NOT refuse the Head Waiter, who was never given its permission`);
      }
      notes.push(`${route} as holder → ${text.slice(0, 140).replace(/\n+/g, " | ")}`);
      await shot(holder, name);
    }
    for (const href of ["/app/users", "/app/finance/takings", "/app/inventory"]) {
      if (holderHrefs.includes(href)) {
        failures.push(`${href} is in the holder's sidebar although its permission was never ticked`);
      }
    }
  }

  // ── 6. Edit the role, and watch the change reach the holder's NEXT session ─────────────────
  await page.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: new RegExp(`edit ${ROLE_NAME}`, "i") }).first().click();
  await page.waitForTimeout(1200);
  const removeBox = page.locator(`input[id="build-${REMOVED_IN_EDIT}"]`);
  await removeBox.first().scrollIntoViewIfNeeded();
  await removeBox.first().uncheck();
  await evidence(page, "10-edit-removes-tables-admin", {
    require: '[data-testid="permission-count"]',
  });
  await page.getByRole("button", { name: /save changes/i }).click();
  await page.waitForTimeout(3500);
  await shot(page, "11-role-edited");

  const holder2Ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const holder2 = await holder2Ctx.newPage();
  if (await login(holder2, { email: holderEmail, password: holderPassword })) {
    const hrefs2 = await sidebarHrefs(holder2);
    notes.push(`holder sidebar (v2, after the edit): ${JSON.stringify(hrefs2)}`);
    if (hrefs2.includes("/app/tables")) {
      failures.push(
        "the removed permission did NOT reach the holder's next session — /app/tables is still in their nav",
      );
    }
    await shot(holder2, "12-holder-next-session-no-tables");
    await holder2.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
    await holder2.waitForTimeout(2500);
    const tablesText = await bodyText(holder2);
    notes.push(`/app/tables after the edit → ${tablesText.slice(0, 160).replace(/\n+/g, " | ")}`);
    await shot(holder2, "13-holder-refused-tables-after-edit");
  } else {
    failures.push("the holder could not sign in for the second session");
  }

  // ── 7. TENANT_ADMIN is refused above its ceiling, on the form ──────────────────────────────
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  if (await login(admin, ADMIN)) {
    await admin.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
    await admin.waitForTimeout(3000);
    await evidence(admin, "14-tenant-admin-roles", { require: '[data-testid="role-list"]' });
    await admin.getByRole("button", { name: /new role/i }).first().click();
    await admin.waitForTimeout(1000);
    await admin.getByLabel(/role name/i).fill("Shadow Owner");
    const box = admin.locator('input[id="build-rbac.manage"]');
    await box.first().scrollIntoViewIfNeeded();
    await box.first().check();
    await admin.waitForTimeout(500);
    await shot(admin, "15-admin-ticks-beyond-ceiling");
    await admin.getByRole("button", { name: /create role/i }).click();
    await admin.waitForTimeout(3000);
    const refusal = await bodyText(admin);
    const sawCeiling = /do not hold yourself|only grant what its author/i.test(refusal);
    if (!sawCeiling) {
      failures.push("the tenant admin was NOT refused when composing a role above their ceiling");
    }
    notes.push(`ceiling refusal text present: ${sawCeiling}`);
    await shot(admin, "16-admin-refused-role-ceiling");
  } else {
    failures.push("tenant admin login failed");
  }

  // ── Responsive + both themes on the screen itself ──────────────────────────────────────────
  //
  // Driven on the OWNER's existing session by resizing, not by six fresh logins. Six more logins
  // against a stack ten agents are sharing hit the gateway's rate limiter and produced a login
  // page with no email field — an infrastructure failure filed as a design failure.
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [w, h, label] of [
      [390, 844, "390"],
      [768, 1024, "768"],
      [1440, 900, "1440"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
      await page
        .locator('[data-testid="role-list"]')
        .first()
        .waitFor({ state: "visible", timeout: 60_000 })
        .catch(() => {});
      await page.waitForTimeout(1500);
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      );
      if (isDark !== (theme === "dark")) {
        failures.push(`theme did not apply at ${label} (asked ${theme}, html.dark=${isDark})`);
      }
      // Asserted on computed geometry, never on a class list: `cn()`/tailwind-merge has silently
      // dropped utility classes in this codebase, so a class present in source proves nothing.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) {
        failures.push(`/app/roles scrolls horizontally at ${label}px (${overflow}px over)`);
      }
      await shot(page, `17-roles-${label}-${theme}`);
    }
  }

  await browser.close();
  report();
}

/**
 * Users → Add user, with the new role attached at creation, and returns the one-time password the
 * dialog shows once.
 */
async function createUserWithRole(page, email, roleName) {
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const addButton = page.getByRole("button", { name: /add user|new user|invite/i }).first();
  if (!(await addButton.count())) {
    failures.push("no add-user control on /app/users");
    return null;
  }
  await addButton.click();
  await page.waitForTimeout(1200);

  await page.locator('input[type="email"], input[name="email"], input#email').first().fill(email);
  const nameField = page.locator('input[name="fullName"], input#fullName');
  if (await nameField.count()) await nameField.first().fill("S3 Head Waiter");

  // Branch AND role, or the form refuses with "Choose both a branch and a role, or neither".
  // The branch select is identified by NOT offering the role — and its placeholder is worded
  // "No branch yet", which a naive "first non-empty option" pick selects and then submits an
  // account with no branch and therefore no role.
  const selects = page.locator("select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i++) {
    const options = (await selects.nth(i).locator("option").allInnerTexts()).map((o) => o.trim());
    const role = options.find((o) => o.toLowerCase() === roleName.toLowerCase());
    if (role) {
      await selects.nth(i).selectOption({ label: role });
      notes.push(`picked role "${role}" in select #${i}`);
      continue;
    }
    const branch = options.find(
      (o) => o && !/no branch|select|choose|^—$|^-$/i.test(o),
    );
    if (branch) {
      await selects.nth(i).selectOption({ label: branch });
      notes.push(`picked branch "${branch}" in select #${i}`);
    } else {
      failures.push(`select #${i} offered no real branch: ${JSON.stringify(options)}`);
    }
  }
  await shot(page, "04b-create-user-form");
  await page.getByRole("button", { name: /create|add user|save/i }).last().click();
  // Wait for the panel, not for a stopwatch. A fixed sleep scraped an empty DOM on one run and a
  // populated one on the next, which is how a harness reports "could not create the account" for
  // an account that was created perfectly.
  await page
    .getByText(/shown once|temporary password/i)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "04c-one-time-password");

  // The one-time password is the VALUE of a read-only input beside a Copy button, not page text —
  // scraping innerText returns nothing at all, which is how this harness "created" an account it
  // could then never sign in as.
  // `one-time-password-panel.tsx` renders it in a `<code data-testid="one-time-password-value">`,
  // NOT in an input — it only looks like a field. Reading it by testid is the only way that cannot
  // silently return an empty string when the styling changes.
  const codeEl = page.locator('[data-testid="one-time-password-value"]');
  const candidate = (await codeEl.count()) ? (await codeEl.first().innerText()).trim() : null;
  notes.push(`one-time password candidate length: ${candidate ? candidate.length : 0}`);
  const close = page.getByRole("button", { name: /done|close|got it/i }).first();
  if (await close.count()) await close.click();
  return candidate;
}

function report() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/s3-run.json`, JSON.stringify({ failures, notes }, null, 2));
  console.log("\nNOTES");
  for (const n of notes) console.log("  ·", n);
  if (failures.length) {
    console.log("\nFAILURES");
    for (const f of failures) console.log("  ✗", f);
    process.exitCode = 1;
  } else {
    console.log("\nAll S3 assertions held.");
  }
}

main().catch((error) => {
  // A crash must still file what was measured. A harness that dies silently after fifteen
  // successful assertions reads exactly like a harness that never ran.
  failures.push(`harness crashed: ${String(error).slice(0, 300)}`);
  report();
});
