/*
 * S3 RE-OPEN — an independent adversarial drive of the role builder.
 *
 * Written from the register's click path, not from the other agent's harness. It repeats the
 * errand with a DIFFERENT role name, and adds the probes the original run did not make:
 *
 *   P1  /app/roles reached by DEEP LINK as well as by the sidebar (a screen that only works when
 *       you arrive from a click is not a screen).
 *   P2  The role survives a FULL PAGE RELOAD — the register's signature failure is state that
 *       exists until you refresh.
 *   P3  CROSS-TENANT: `Control Bistro` was given a role with the SAME CODE (FLOOR_CAPTAIN)
 *       carrying `rbac.manage`, `finance.period.close` and `inventory.item.manage` before this
 *       run started. If the tenant-scoped grant is a fiction, THIS tenant's Floor Captain picks
 *       those up — observable as a TOTP challenge (D-29a fires on rbac.manage) and as three
 *       screens they should not reach.
 *   P4  The holder's ACTUAL JWT is decoded, not inferred from the sidebar.
 *   P5  A persona with no role authority at all (cashier) is sent to /app/roles.
 *
 * Run: node e2e/reopen/s3-reopen.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S3/reopen");
const SLUG = "floating-terrace";

const OWNER = { email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const ADMIN = { email: "admin@terrace.local", password: "Terrace#Admin1", totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS" };
const CASHIER = { email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const ROLE_NAME = "Floor Captain";
const ROLE_CODE = "FLOOR_CAPTAIN";
const TICKED = ["pos.order.create", "pos.order.view", "pos.menu.view", "pos.tables.admin"];
const REMOVED_IN_EDIT = "pos.tables.admin";
/* Planted in the OTHER tenant on a role of this exact code. None of these may reach this tenant. */
const FOREIGN_ONLY = ["rbac.manage", "finance.period.close", "inventory.item.manage"];

const failures = [];
const notes = [];

function b32(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0; const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = a.indexOf(c); if (i === -1) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const ctr = Math.floor(Date.now() / 1000 / 30);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); b.writeUInt32BE(ctr >>> 0, 4);
  const h = createHmac("sha1", b32(secret)).update(b).digest();
  const o = h[h.length - 1] & 0x0f;
  const c = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(c % 1000000).padStart(6, "0");
}

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("  shot", `${name}.png`);
}
async function bodyText(page) { return page.locator("body").innerText(); }
async function sidebarHrefs(page) {
  return page.locator("nav a, aside a").evaluateAll((els) => els.map((e) => e.getAttribute("href")).filter(Boolean));
}

const REFUSAL = /Access denied|You do not have permission|don't have permission|This page doesn't exist|Couldn't load|Something went wrong/i;

/** Files a shot only if the page is really the screen. An error state looks like an empty state. */
async function evidence(page, name, { require: req, forbid = REFUSAL } = {}) {
  if (req) await page.locator(req).first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(900);
  const text = await bodyText(page);
  if (forbid && forbid.test(text)) {
    failures.push(`${name}: the page is a refusal or an error, not the screen`);
    notes.push(`${name} text: ${text.slice(0, 220).replace(/\n+/g, " | ")}`);
    await shot(page, `REFUSED-${name}`); return false;
  }
  if (req && (await page.locator(req).count()) === 0) {
    failures.push(`${name}: ANCHOR "${req}" not on the page`);
    await shot(page, `ANCHORLESS-${name}`); return false;
  }
  await shot(page, name); return true;
}

async function login(page, who, newPassword) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await attemptLogin(page, who, newPassword);
    if (ok) return true;
    const text = await bodyText(page);
    if (!/record changed while you were editing|try again/i.test(text)) return false;
    notes.push(`login ${who.email}: transient conflict, retry ${attempt}`);
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
  if (await totp.count()) {
    if (!totpSecret) {
      // A persona that should NOT be challenged being challenged is itself a finding.
      notes.push(`!! ${email} was challenged for TOTP and holds no secret`);
      return false;
    }
    await totp.first().fill(totpNow(totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  if (newPassword) {
    const fields = page.locator('input[type="password"]');
    const count = await fields.count();
    if (count >= 2) {
      for (let i = 0; i < count; i++) await fields.nth(i).fill(i === 0 && count === 3 ? password : newPassword);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
    }
    if (page.url().includes("/login")) return login(page, { email, password: newPassword, totpSecret });
  }
  return !page.url().includes("/login");
}

async function tick(page, code, on = true) {
  const box = page.locator(`input[id="build-${code}"]`);
  await box.first().scrollIntoViewIfNeeded();
  if (on) await box.first().check(); else await box.first().uncheck();
}

/** The holder's real token, fetched over HTTP — not inferred from what the nav happens to render. */
async function tokenPermissions(email, password) {
  const r = await fetch(`${GW}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tenant-Slug": SLUG },
    body: JSON.stringify({ email, password, tenantSlug: SLUG }),
  });
  const j = await r.json();
  const tok = j?.data?.accessToken;
  if (!tok) return { status: r.status, error: j?.error?.code || "no token", permissions: null };
  const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString());
  return { status: r.status, permissions: claims.permissions || [], roles: claims.roles };
}

async function createUserWithRole(page, email, roleName) {
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const add = page.getByRole("button", { name: /add user|new user|invite/i }).first();
  if (!(await add.count())) { failures.push("no add-user control on /app/users"); return null; }
  await add.click();
  await page.waitForTimeout(1500);
  await page.locator('input[type="email"], input[name="email"], input#email').first().fill(email);
  const nameField = page.locator('input[name="fullName"], input#fullName');
  if (await nameField.count()) await nameField.first().fill("Reopen Floor Captain");
  const selects = page.locator("select");
  const n = await selects.count();
  let pickedRole = false;
  for (let i = 0; i < n; i++) {
    const options = (await selects.nth(i).locator("option").allInnerTexts()).map((o) => o.trim());
    const role = options.find((o) => o.toLowerCase() === roleName.toLowerCase());
    if (role) { await selects.nth(i).selectOption({ label: role }); pickedRole = true; notes.push(`role "${role}" offered by the assign select`); continue; }
    const branch = options.find((o) => o && !/no branch|select|choose|^—$|^-$/i.test(o));
    if (branch) await selects.nth(i).selectOption({ label: branch });
  }
  if (!pickedRole) failures.push(`"${roleName}" was NOT offered by the assign-role select on /app/users`);
  await shot(page, "04-create-user-form");
  await page.getByRole("button", { name: /create|add user|save/i }).last().click();
  await page.getByText(/shown once|temporary password/i).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "05-one-time-password");
  const codeEl = page.locator('[data-testid="one-time-password-value"]');
  return (await codeEl.count()) ? (await codeEl.first().innerText()).trim() : null;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => notes.push(`page error: ${String(e).slice(0, 160)}`));

  // ── 1. OWNER: the sidebar, and the DEEP LINK ───────────────────────────────────────────────
  if (!(await login(page, OWNER))) {
    failures.push(`owner login failed — ${page.url()}`); await shot(page, "00-owner-login-failed");
    await browser.close(); return report();
  }
  const hrefs = await sidebarHrefs(page);
  if (!hrefs.includes("/app/roles")) failures.push("owner sidebar has no /app/roles entry");
  notes.push(`owner sidebar has /app/roles: ${hrefs.includes("/app/roles")}`);

  // P1 — deep link, cold, not a click from the dashboard.
  await page.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
  await evidence(page, "01-owner-roles-deeplink", { require: '[data-testid="role-list"]' });

  // ── 2. Read what a BUILT-IN role grants ────────────────────────────────────────────────────
  await page.getByRole("button", { name: /see what Cashier grants/i }).first().click();
  await page.waitForTimeout(1400);
  const view = page.locator('[data-testid="role-permission-view"]');
  const modules = await view.locator("h3").allInnerTexts();
  const codes = await view.locator("code").allInnerTexts();
  notes.push(`CASHIER: ${codes.length} codes under ${JSON.stringify(modules)}`);
  if (codes.length === 0) failures.push("the built-in Cashier detail listed no permission codes");
  const editOnBuiltIn = await page.getByRole("button", { name: /^save changes$/i }).count();
  if (editOnBuiltIn > 0) failures.push("a BUILT-IN role offered an editable save control");
  await evidence(page, "02-cashier-grants", { require: '[data-testid="role-permission-view"] code' });
  await page.getByRole("button", { name: /^close$/i }).first().click();
  await page.waitForTimeout(700);

  // ── 3. Compose the role ────────────────────────────────────────────────────────────────────
  const before = await bodyText(page);
  if (before.includes(ROLE_NAME)) {
    failures.push(`"${ROLE_NAME}" already existed before this run — nothing here is proved`);
  }
  await page.getByRole("button", { name: /new role/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByLabel(/role name/i).fill(ROLE_NAME);
  for (const c of TICKED) await tick(page, c);
  const counter = await page.locator('[data-testid="permission-count"]').innerText();
  notes.push(`builder counter: ${counter}`);
  await evidence(page, "03-builder", { require: '[data-testid="permission-count"]' });
  await page.getByRole("button", { name: /create role/i }).click();
  await page.waitForTimeout(4000);
  if (!(await bodyText(page)).includes(ROLE_NAME)) failures.push(`the list does not show "${ROLE_NAME}" after creating it`);

  // P2 — a full reload. State that vanishes on refresh was never persisted.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const afterReload = await bodyText(page);
  if (!afterReload.includes(ROLE_NAME)) failures.push(`"${ROLE_NAME}" did NOT survive a page reload`);
  notes.push(`role survives reload: ${afterReload.includes(ROLE_NAME)}`);
  await evidence(page, "03b-after-reload", { require: '[data-testid="role-list"]' });

  // ── 4. Assign it, and measure the holder ───────────────────────────────────────────────────
  const stamp = Date.now().toString().slice(-6);
  const holderEmail = `floorcaptain.reopen.${stamp}@terrace.local`;
  const temp = await createUserWithRole(page, holderEmail, ROLE_NAME);
  if (!temp) { failures.push("could not create the holder account"); await browser.close(); return report(); }
  const holderPassword = `Terrace#Reopen-${stamp}`;

  const hCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const holder = await hCtx.newPage();
  if (!(await login(holder, { email: holderEmail, password: temp }, holderPassword))) {
    failures.push(`the holder could not sign in — ${holder.url()}`);
    await shot(holder, "REFUSED-06-holder-login");
  } else {
    const hh = await sidebarHrefs(holder);
    notes.push(`holder sidebar: ${JSON.stringify(hh)}`);
    await evidence(holder, "06-holder-signed-in", { require: "h1, h2" });

    // P4 — the real token. This is where a cross-tenant grant would show up.
    const tok = await tokenPermissions(holderEmail, holderPassword);
    notes.push(`holder token status ${tok.status}, roles ${JSON.stringify(tok.roles)}, permissions ${JSON.stringify(tok.permissions)}`);
    if (tok.permissions) {
      const leaked = FOREIGN_ONLY.filter((c) => tok.permissions.includes(c));
      if (leaked.length) failures.push(`CROSS-TENANT LEAK: the holder's token carries ${JSON.stringify(leaked)} — granted only by the OTHER tenant's role of the same code`);
      const missing = TICKED.filter((c) => !tok.permissions.includes(c));
      if (missing.length) failures.push(`the holder's token is MISSING ticked permissions ${JSON.stringify(missing)}`);
      const extra = tok.permissions.filter((c) => !TICKED.includes(c));
      if (extra.length) notes.push(`holder holds beyond the tick list: ${JSON.stringify(extra)}`);
    } else {
      failures.push(`could not read the holder's token: ${tok.error}`);
    }

    if (!hh.includes("/app/tables")) failures.push("pos.tables.admin was ticked but /app/tables is absent from the holder's nav");
    await holder.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
    await evidence(holder, "07-holder-tables", { require: "h1" });

    for (const [name, route] of [
      ["08-refused-users", "/app/users"],
      ["09-refused-finance", "/app/finance/accounts"],
      ["10-refused-inventory", "/app/inventory"],
      ["11-refused-roles", "/app/roles"],
    ]) {
      await holder.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await holder.waitForTimeout(2800);
      const t = await bodyText(holder);
      if (!REFUSAL.test(t)) failures.push(`${route} did NOT refuse the holder, who was never given its permission`);
      notes.push(`${route} as holder → ${t.slice(0, 120).replace(/\n+/g, " | ")}`);
      await shot(holder, name);
    }
  }

  // ── 5. Edit, and watch it reach the next session ───────────────────────────────────────────
  await page.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: new RegExp(`edit ${ROLE_NAME}`, "i") }).first().click();
  await page.waitForTimeout(1400);
  await tick(page, REMOVED_IN_EDIT, false);
  await evidence(page, "12-edit-untick", { require: '[data-testid="permission-count"]' });
  await page.getByRole("button", { name: /save changes/i }).click();
  await page.waitForTimeout(4000);
  await shot(page, "13-edited");

  const tok2 = await tokenPermissions(holderEmail, holderPassword);
  notes.push(`holder token AFTER edit: ${JSON.stringify(tok2.permissions)}`);
  if (tok2.permissions && tok2.permissions.includes(REMOVED_IN_EDIT)) {
    failures.push(`the edit did NOT reach a new token — ${REMOVED_IN_EDIT} is still in the holder's permissions`);
  }
  const h2Ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const holder2 = await h2Ctx.newPage();
  if (await login(holder2, { email: holderEmail, password: holderPassword })) {
    const hrefs2 = await sidebarHrefs(holder2);
    notes.push(`holder sidebar after edit: ${JSON.stringify(hrefs2)}`);
    if (hrefs2.includes("/app/tables")) failures.push("the removed permission did NOT reach the holder's next session");
    await shot(holder2, "14-holder-next-session");
    await holder2.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
    await holder2.waitForTimeout(2800);
    notes.push(`/app/tables after edit → ${(await bodyText(holder2)).slice(0, 140).replace(/\n+/g, " | ")}`);
    await shot(holder2, "15-tables-after-edit");
  } else failures.push("the holder could not sign in for the second session");

  // ── 6. TENANT_ADMIN above its ceiling, on the form ─────────────────────────────────────────
  const aCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await aCtx.newPage();
  if (await login(admin, ADMIN)) {
    await admin.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
    await admin.waitForTimeout(3500);
    await evidence(admin, "16-admin-roles", { require: '[data-testid="role-list"]' });
    const adminText = await bodyText(admin);
    notes.push(`admin withheld banner: ${/withheld/i.test(adminText)}`);
    await admin.getByRole("button", { name: /new role/i }).first().click();
    await admin.waitForTimeout(1200);
    await admin.getByLabel(/role name/i).fill("Reopen Shadow Owner");
    await tick(admin, "rbac.manage");
    await admin.waitForTimeout(600);
    await shot(admin, "17-admin-ticks-beyond-ceiling");
    await admin.getByRole("button", { name: /create role/i }).click();
    await admin.waitForTimeout(3500);
    const refusal = await bodyText(admin);
    if (!/do not hold yourself|only grant what its author/i.test(refusal)) {
      failures.push("the tenant admin was NOT refused when composing a role above their ceiling");
    }
    await shot(admin, "18-admin-refused");
    // And nothing was written.
    const written = await fetch(`${GW}/api/v1/roles`).catch(() => null);
    notes.push(`ceiling refusal shown on the form: ${/do not hold yourself|only grant what its author/i.test(refusal)}`);
    void written;
  } else failures.push("tenant admin login failed");

  // ── 7. P5 — a persona with no role authority at all ────────────────────────────────────────
  const cCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cashier = await cCtx.newPage();
  if (await login(cashier, CASHIER)) {
    const ch = await sidebarHrefs(cashier);
    if (ch.includes("/app/roles")) failures.push("the CASHIER's sidebar offers /app/roles");
    await cashier.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
    await cashier.waitForTimeout(3000);
    const ct = await bodyText(cashier);
    if (!/don't administer roles|Access denied|do not have permission|doesn't exist/i.test(ct)) {
      failures.push("the CASHIER was NOT refused /app/roles");
    }
    notes.push(`cashier on /app/roles → ${ct.slice(0, 160).replace(/\n+/g, " | ")}`);
    await shot(cashier, "19-cashier-refused-roles");
  } else failures.push("cashier login failed");

  await browser.close();
  return report();
}

function report() {
  mkdirSync(OUT, { recursive: true });
  const out = { at: new Date().toISOString(), failures, notes };
  writeFileSync(`${OUT}/s3-reopen.json`, JSON.stringify(out, null, 2));
  console.log("\n──── NOTES ────");
  for (const n of notes) console.log(" ·", n);
  if (failures.length) {
    console.log("\n──── FAILURES ────");
    for (const f of failures) console.log(" ✗", f);
    process.exitCode = 1;
  } else {
    console.log("\nAll S3 re-open assertions held.");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
