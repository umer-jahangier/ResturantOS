/**
 * Phase 35 browser verification — HR settings and the employee form, driven as a user.
 *
 * NOT a gate; an evidence collector. It signs the owner in through the real login form
 * (including the TOTP step-up, generated from scripts/generate_totp.py), then FILLS THE FORMS
 * BADLY ON PURPOSE and records the message that comes back against each field. A form-validation
 * phase verified by reading its own zod schema is not verified.
 *
 * Run:  node e2e/verify-35-hr.mjs
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/phases/35-hr-usability/evidence");
const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
};

mkdirSync(OUT, { recursive: true });
const findings = [];
const note = (id, detail) => {
  findings.push({ id, detail });
  console.log(`${id}: ${detail}`);
};

function totpFor(email) {
  const out = execFileSync("python3", ["../scripts/generate_totp.py", email], {
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);

  // The owner holds rbac.manage, so login is step-up gated. The code is generated here rather
  // than earlier because it expires in 30 seconds.
  const totp = page.locator('input[name="totpCode"], input#totpCode, input[autocomplete="one-time-code"]');
  if (await totp.count()) {
    await totp.first().fill(totpFor(OWNER.email));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  return !page.url().includes("/login");
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

if (!(await login(page))) {
  await shot(page, "00-login-failed");
  console.error("LOGIN FAILED — url:", page.url());
  await browser.close();
  process.exit(1);
}
note("login", "signed in as owner@terrace.local through the real form, TOTP included");

// ── 1. The settings area exists and is reachable from the HR tabs ────────────
await page.goto(`${BASE}/app/hr/settings/departments`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await shot(page, "01-departments-list");
note(
  "departments-list",
  `heading=${JSON.stringify(await page.locator("h1").first().textContent())} rows=${await page.locator("tbody tr").count()}`,
);

// ── 2. Fill the department form badly: a case-variant of one that exists ─────
await page.getByRole("button", { name: /new department/i }).click();
await page.waitForTimeout(800);
const nameInput = page.getByLabel("Name", { exact: true });
await nameInput.fill("K");
await page.getByLabel("Short code").click(); // blur
await page.waitForTimeout(600);
await shot(page, "02-department-too-short");
note(
  "client-rule-on-blur",
  `after typing "K" and blurring: ${JSON.stringify(await page.locator("[data-slot=form-message]").first().textContent())}`,
);

await nameInput.fill("  kitchen  ");
await page.waitForTimeout(600);
const submitBtn = page.getByRole("button", { name: /^Add$/ });
await submitBtn.click();
await page.waitForTimeout(3000);
await shot(page, "03-department-duplicate-server-error");
note(
  "server-error-on-field",
  `after saving "  kitchen  " when "Kitchen" exists: ${JSON.stringify(
    await page.locator("[data-slot=form-message]").first().textContent(),
  )}`,
);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// ── 3. The tax table: the blocker screen ─────────────────────────────────────
await page.goto(`${BASE}/app/hr/settings/tax`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await shot(page, "04-tax-config");
note(
  "tax-screen",
  `banner=${JSON.stringify((await page.locator("body").innerText()).match(/Payroll cannot run yet[^\n]*/)?.[0] ?? null)}`,
);
note(
  "tax-fiscal-year",
  `year select value=${await page.locator("#fiscal-year").inputValue().catch(() => "n/a")}`,
);

// Fill a slab table with a deliberate gap and no open top, and read what comes back per row.
const rows = page.locator("tbody tr");
await page.getByRole("button", { name: /add band/i }).click();
await page.waitForTimeout(500);
await page.getByLabel("Band 1 starts at").fill("0");
await page.getByLabel("Band 1 ends at").fill("600000");
await page.getByLabel("Band 1 fixed tax").fill("0");
await page.getByLabel("Band 1 rate").fill("0");
await page.getByLabel("Band 2 starts at").fill("700000");
await page.getByLabel("Band 2 ends at").fill("1200000");
await page.getByLabel("Band 2 fixed tax").fill("0");
await page.getByLabel("Band 2 rate").fill("1");
for (const [label, value] of [
  ["Surcharge starts above", "10000000"],
  ["Surcharge rate %", "9"],
  ["EOBI employer %", "5"],
  ["EOBI employee %", "1"],
  ["EOBI wage base", "37000"],
]) {
  await page.getByLabel(label).fill(value);
}
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Save FY/ }).click();
await page.waitForTimeout(3500);
await shot(page, "05-tax-bad-slabs");
note(
  "slab-errors-per-row",
  JSON.stringify(await page.locator("[data-slot=form-message]").allTextContents()),
);

// ── 4. The employee form ─────────────────────────────────────────────────────
await page.goto(`${BASE}/app/hr/employees`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await shot(page, "06-employees-list");

await page.getByRole("button", { name: /new employee/i }).click();
await page.waitForTimeout(1200);
await shot(page, "07-employee-form");

note(
  "department-is-a-select",
  `tag=${await page.getByLabel("Department", { exact: true }).evaluate((el) => el.tagName)} options=${JSON.stringify(
    await page.getByLabel("Department", { exact: true }).locator("option").allTextContents(),
  )}`,
);
note(
  "designation-is-a-select",
  `tag=${await page.getByLabel("Job title").evaluate((el) => el.tagName)} options=${JSON.stringify(
    await page.getByLabel("Job title").locator("option").allTextContents(),
  )}`,
);

// Bad on purpose: a two-character employee number, a future join date, a comma'd salary.
await page.getByLabel("Employee number").fill("EM");
await page.getByLabel("Full name").click();
await page.waitForTimeout(500);
await page.getByLabel("Join date").fill("2099-01-01");
await page.getByLabel("Basic salary").fill("50,000");
await page.getByLabel("Full name").click();
await page.waitForTimeout(900);
await shot(page, "08-employee-form-bad-input");
note(
  "employee-form-messages",
  JSON.stringify(await page.locator("[data-slot=form-message]").allTextContents()),
);
const submit = page.getByRole("button", { name: /add employee/i });
note(
  "submit-disabled-with-reason",
  `disabled=${await submit.isDisabled()} reason=${JSON.stringify(
    await page.locator("[data-slot=form-submit-reason]").first().textContent().catch(() => null),
  )}`,
);

// A duplicate employee number, which the server refuses on the employeeNo field.
await page.getByLabel("Employee number").fill("1");
await page.getByLabel("Join date").fill("2026-01-01");
await page.getByLabel("Basic salary").fill("50000");
await page.getByLabel("Full name").fill("Duplicate Test");
await page.waitForTimeout(900);
await submit.click();
await page.waitForTimeout(3500);
await shot(page, "09-employee-duplicate-number");
note(
  "duplicate-employee-no",
  JSON.stringify(await page.locator("[data-slot=form-message]").allTextContents()),
);

writeFileSync(`${OUT}/verify-35-hr.json`, JSON.stringify(findings, null, 2));
console.log(`\nScreenshots and findings in ${OUT}`);
await browser.close();
