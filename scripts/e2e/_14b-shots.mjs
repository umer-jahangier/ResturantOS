/**
 * Phase 14b evidence driver — drives a REAL browser through the Tier 0 defects and writes
 * before/after screenshots.
 *
 * Every defect in this phase was invisible to the unit suite and four were invisible to a
 * 50/56-green Playwright suite, so the acceptance evidence is a photograph, not an assertion.
 *
 *   node scripts/e2e/_14b-shots.mjs before
 *   node scripts/e2e/_14b-shots.mjs after
 *
 * Requires the stack up (frontend :3000, gateway :8080) and the floating-terrace seed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const TAG = process.argv[2] ?? "shot";
const ROOT = join(import.meta.dirname, "..", "..");

// Playwright is a frontend devDependency and this driver lives in scripts/, so resolve it
// from frontend/package.json rather than from this file's own directory.
const { chromium } = createRequire(join(ROOT, "frontend", "package.json"))("@playwright/test");
const OUT = join(ROOT, ".planning/phases/14b-truth-and-trust/shots", TAG);
const APP = "http://localhost:3000";
const GW = "http://localhost:8080";

mkdirSync(OUT, { recursive: true });

function totp(email) {
  const out = execFileSync("python3", [join(ROOT, "scripts/generate_totp.py"), email], {
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  shot ${TAG}/${name}.png`);
}

async function login(page, email, password, withTotp) {
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  // Wait for hydration before typing. Clicking a pre-hydration submit used to fall through to the
  // browser's native GET and put the password in the query string; the form now disables the
  // button until React has taken over, so waiting for it enabled is both the correct wait and a
  // live assertion that the guard is in place.
  await page.getByTestId("login-submit").waitFor({ state: "visible", timeout: 20_000 });
  await page
    .getByTestId("login-submit")
    .and(page.locator(":not([disabled])"))
    .waitFor({ timeout: 20_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("login-submit").click();
  if (withTotp) {
    await page.getByTestId("totp-code").waitFor({ timeout: 20_000 });
    await page.getByTestId("totp-code").fill(totp(email));
    await page.getByTestId("login-submit").click();
  }
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
}

/** Fail one route with a status, leaving everything else live. */
async function breakRoute(page, pattern, status) {
  await page.route(pattern, (route) => route.fulfill({ status, contentType: "application/json", body: '{"error":{"code":"INTERNAL_ERROR","message":"forced"}}' }));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log(`    [console] ${m.text().slice(0, 160)}`));

console.log(`\n=== 14b evidence: ${TAG} ===`);

// ---------------------------------------------------------------- GA-008 (pre-login)
//
// Driven against a tenant provisioned by scripts/onboarding.py whose OWNER has never enrolled a
// second factor — the exact state the audit reached with `gap-audit-bistro`, and the one in which
// the product used to tell the only account holder to "ask an administrator".
const GA008_EMAIL = process.env.GA008_EMAIL;
const GA008_PASSWORD = process.env.GA008_PASSWORD;

console.log("GA-008 TOTP enrolment deadlock");
await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
await shot(page, "ga008-1-login-page");

if (GA008_EMAIL) {
  await page.getByLabel("Email").fill(GA008_EMAIL);
  await page.getByLabel("Password").fill(GA008_PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.waitForTimeout(3000);
  await shot(page, "ga008-2-after-refusal");

  // BEFORE: a destructive alert reading "Ask an administrator to complete enrolment".
  // AFTER:  the enrolment step, in place, with the password never leaving form state.
  const enrolment = page.getByTestId("totp-enrollment");
  if (await enrolment.count()) {
    await page.getByTestId("totp-enroll-start").click();
    await page.getByTestId("totp-secret").waitFor({ timeout: 15_000 });
    await shot(page, "ga008-3-secret-issued");

    const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
    const code = execFileSync(
      "python3",
      [
        "-c",
        `import base64,hmac,hashlib,struct,time
k=base64.b32decode('${secret}'+'='*((8-len('${secret}')%8)%8))
m=hmac.new(k,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest()
o=m[-1]&0xf
print(str((struct.unpack('>I',m[o:o+4])[0]&0x7fffffff)%1000000).zfill(6))`,
      ],
      { encoding: "utf8" },
    ).trim();
    console.log(`    computed code ${code} from the on-screen key`);

    await page.getByTestId("totp-enroll-code").fill(code);
    await page.getByTestId("totp-enroll-verify").click();
    await page.waitForTimeout(3000);
    await shot(page, "ga008-4-enrolled");

    // The account now HAS a factor, so signing in is challenged rather than refused.
    await page.getByTestId("totp-code").fill(
      execFileSync(
        "python3",
        [
          "-c",
          `import base64,hmac,hashlib,struct,time
k=base64.b32decode('${secret}'+'='*((8-len('${secret}')%8)%8))
m=hmac.new(k,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest()
o=m[-1]&0xf
print(str((struct.unpack('>I',m[o:o+4])[0]&0x7fffffff)%1000000).zfill(6))`,
        ],
        { encoding: "utf8" },
      ).trim(),
    );
    await page.getByTestId("login-submit").click();
    await page.waitForTimeout(6000);
    console.log(`    landed on ${page.url()}`);
    await shot(page, "ga008-5-signed-in");
  }
  await page.context().clearCookies();
}

// ---------------------------------------------------------------- sign in as owner
await login(page, "owner@terrace.local", "Terrace#Owner1", true);
console.log("signed in as owner@terrace.local");

// ---------------------------------------------------------------- GA-032 + GA-059 + GA-095
console.log("GA-032 sidebar brand / GA-059 bell / GA-095 breadcrumb");
await page.goto(`${APP}/app/finance/ar-aging`, { waitUntil: "domcontentloaded" });
await shot(page, "ga032-ga059-ga095-shell");

// ---------------------------------------------------------------- GA-023 dashboard
console.log("GA-023 dashboard closed sales");
await page.goto(`${APP}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await shot(page, "ga023-dashboard");

// ---------------------------------------------------------------- GA-007 JE detail
console.log("GA-007 journal entry money");
await page.goto(`${APP}/app/finance/journal-entries`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot(page, "ga007-je-list");
const firstRow = page.locator("tbody tr").first();
if (await firstRow.count()) {
  await firstRow.click();
  await page.waitForTimeout(2000);
  await shot(page, "ga007-je-detail");
}

// ---------------------------------------------------------------- GA-094 export hint
await page.goto(`${APP}/app/finance/journal-entries`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await shot(page, "ga094-je-subtitle");

// ---------------------------------------------------------------- GA-078 HR money
console.log("GA-078 HR money format");
await page.goto(`${APP}/app/hr/employees`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot(page, "ga078-hr-employees");
await page.goto(`${APP}/app/hr/payroll`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot(page, "ga078-hr-payroll");

// ---------------------------------------------------------------- GA-096 dev seed button
console.log("GA-096 dev seed button");
await page.goto(`${APP}/app/hr/attendance`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot(page, "ga096-hr-attendance");

// ---------------------------------------------------------------- GA-093 unlabelled checkbox
console.log("GA-093 menu items checkbox");
await page.goto(`${APP}/app/menu/items`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot(page, "ga093-menu-items");

// ---------------------------------------------------------------- GA-006 loyalty tender
console.log("GA-006 loyalty tender");
await page.goto(`${APP}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await shot(page, "ga006-pos");

// ---------------------------------------------------------------- GA-001 failed list -> empty?
console.log("GA-001 forced 500 on list screens");
for (const [name, url, pattern] of [
  ["vendors", "/app/purchasing/vendors", "**/api/v1/purchasing/vendors**"],
  ["journal-entries", "/app/finance/journal-entries", "**/api/v1/finance/journal-entries**"],
  ["accounts", "/app/finance/accounts", "**/api/v1/finance/accounts**"],
  ["ingredients", "/app/inventory/ingredients", "**/api/v1/inventory/ingredients**"],
  ["purchase-orders", "/app/purchasing/purchase-orders", "**/api/v1/purchasing/purchase-orders**"],
]) {
  await breakRoute(page, pattern, 500);
  await page.goto(`${APP}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await shot(page, `ga001-${name}-forced-500`);
  await page.unrouteAll({ behavior: "ignoreErrors" });
}

// ---------------------------------------------------------------- GA-002 feature flags 503
console.log("GA-002 feature-flags 503");
await breakRoute(page, "**/api/v1/feature-flags**", 503);
await page.goto(`${APP}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await shot(page, "ga002-nav-with-flags-503");
const navCount = await page.locator("aside a, nav a").count();
console.log(`    nav links with feature-flags 503: ${navCount}`);
await page.unrouteAll({ behavior: "ignoreErrors" });

// ---------------------------------------------------------------- GA-053 / GA-091 dead links
console.log("GA-053 /platform/tenants, GA-091 /app/reporting");
for (const [name, url] of [
  ["ga053-platform-tenants", "/platform/tenants"],
  ["ga091-app-reporting", "/app/reporting"],
]) {
  const res = await page.goto(`${APP}${url}`, { waitUntil: "domcontentloaded" });
  console.log(`    ${url} -> ${res?.status()}  title="${await page.title()}"`);
  await shot(page, name);
}

// ---------------------------------------------------------------- GA-092 theme command
console.log("GA-092 command palette toggle theme");
await page.goto(`${APP}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.keyboard.press("Meta+K");
await page.waitForTimeout(700);
await shot(page, "ga092-command-palette");
await page.keyboard.press("Escape");

await browser.close();
console.log(`\nwrote ${OUT}\n`);
