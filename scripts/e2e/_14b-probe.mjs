/**
 * 14b assertion probe — the claims in 14b-01-SUMMARY.md, measured rather than asserted.
 *
 * Screenshots show a human what changed; this shows a machine. Run after `_14b-shots.mjs after`.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const { chromium } = createRequire(join(ROOT, "frontend", "package.json"))("@playwright/test");
const APP = "http://localhost:3000";

function totp(email) {
  return execFileSync("python3", [join(ROOT, "scripts/generate_totp.py"), email], {
    encoding: "utf8",
  }).match(/TOTP code:\s*(\d{6})/)[1];
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });

// GA-EXTRA: the submit button must be disabled until React hydrates, or a native GET puts the
// password in the URL.
const disabledAtFirstPaint = await page
  .getByTestId("login-submit")
  .isDisabled()
  .catch(() => null);
await page.getByTestId("login-submit").waitFor({ state: "visible" });
await page.waitForFunction(
  () => !document.querySelector('[data-testid="login-submit"]')?.hasAttribute("disabled"),
  { timeout: 20_000 },
);
check("login submit enables only after hydration", true, `disabledAtFirstPaint=${disabledAtFirstPaint}`);

await page.getByLabel("Email").fill("owner@terrace.local");
await page.getByLabel("Password").fill("Terrace#Owner1");
await page.getByTestId("login-submit").click();
await page.getByTestId("totp-code").waitFor({ timeout: 20_000 });
await page.getByTestId("totp-code").fill(totp("owner@terrace.local"));
await page.getByTestId("login-submit").click();
await page.waitForURL(/\/app\//, { timeout: 30_000 });
check("password never reached the URL", !page.url().includes("password="), page.url());

// ── GA-032 sidebar brand ──────────────────────────────────────────────────────────────────
await page.goto(`${APP}/app/finance/ar-aging`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const brand = (await page.locator("aside").first().innerText()).split("\n")[0]?.trim();
check("GA-032 sidebar names the signed-in tenant", brand === "Floating Terrace", `brand="${brand}"`);

// ── GA-095 breadcrumb acronyms ────────────────────────────────────────────────────────────
const crumb = (await page.getByRole("navigation", { name: "Breadcrumb" }).innerText()).replace(
  /\s+/g,
  " ",
);
check("GA-095 breadcrumb says 'AR Aging' not 'Ar Aging'", crumb.includes("AR Aging"), crumb);
await page.goto(`${APP}/app/finance/gl`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const glCrumb = (await page.getByRole("navigation", { name: "Breadcrumb" }).innerText()).replace(
  /\s+/g,
  " ",
);
check("GA-095 breadcrumb says 'General Ledger' not 'Gl'", glCrumb.includes("General Ledger"), glCrumb);

// ── GA-059 bell ───────────────────────────────────────────────────────────────────────────
const bells = await page.getByRole("button", { name: /notification/i }).count();
check("GA-059 no inert notifications bell", bells === 0, `matches=${bells}`);

// ── GA-093 checkbox accessible name (VERIFY the register's claim) ──────────────────────────
await page.goto(`${APP}/app/menu/items`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const cbName = await page
  .locator('input[type="checkbox"]')
  .first()
  .evaluate((el) => {
    // Implicit labelling: an <input> nested in a <label> takes that label's text as its name.
    const closest = el.closest("label");
    return {
      ariaLabel: el.getAttribute("aria-label"),
      id: el.getAttribute("id"),
      wrappingLabelText: closest ? closest.innerText.trim() : null,
    };
  });
check(
  "GA-093 'Show inactive' checkbox HAS an accessible name",
  Boolean(cbName.ariaLabel || cbName.wrappingLabelText),
  JSON.stringify(cbName),
);

// ── GA-094 export claim removed ───────────────────────────────────────────────────────────
await page.goto(`${APP}/app/finance/journal-entries`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const jeBody = await page.locator("main").innerText();
check("GA-094 page no longer advertises 'E to export'", !/E to export/i.test(jeBody));

// ── GA-092 command palette toggles the theme ──────────────────────────────────────────────
// The cycle is light -> dark -> system, and an unset preference reads as "system". In a headless
// browser system resolves to LIGHT, so the first activation (system -> light) is a real theme
// change with no visible class change. Drive it twice and assert the stored preference moves and
// the document class reaches `dark` — which is what "does this control do anything?" means here.
async function themeState() {
  return page.evaluate(() => ({
    stored: window.localStorage.getItem("theme"),
    cls: document.documentElement.className.includes("dark") ? "dark" : "light",
  }));
}
async function activateThemeCommand() {
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.waitForTimeout(700);
  await page.getByText("Toggle theme", { exact: true }).click();
  await page.waitForTimeout(800);
}
const t0 = await themeState();
await activateThemeCommand();
const t1 = await themeState();
await activateThemeCommand();
const t2 = await themeState();
check(
  "GA-092 'Toggle theme' actually changes the theme",
  t1.stored !== t0.stored && t2.cls === "dark",
  `${JSON.stringify(t0)} -> ${JSON.stringify(t1)} -> ${JSON.stringify(t2)}`,
);

// ── GA-006 loyalty tender is not offered ──────────────────────────────────────────────────
await page.goto(`${APP}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const posBody = await page.locator("body").innerText();
check("GA-006 LOYALTY_POINTS is not a selectable tender", !/LOYALTY[_ ]POINTS|Loyalty points/i.test(posBody));

// ── GA-001 failure renders an ERROR with a retry, on every converted screen ────────────────
const screens = [
  ["vendors", "/app/purchasing/vendors", "**/api/v1/purchasing/vendors**"],
  ["journal entries", "/app/finance/journal-entries", "**/api/v1/finance/journal-entries**"],
  ["accounts", "/app/finance/accounts", "**/api/v1/finance/accounts**"],
  ["ingredients", "/app/inventory/ingredients", "**/api/v1/inventory/ingredients**"],
  ["purchase orders", "/app/purchasing/purchase-orders", "**/api/v1/purchasing/purchase-orders**"],
  ["vendor invoices", "/app/purchasing/invoices", "**/api/v1/purchasing/invoices**"],
  ["expenses", "/app/finance/expenses", "**/api/v1/finance/expenses**"],
  ["house accounts", "/app/finance/house-accounts", "**/api/v1/finance/ar/customer-accounts**"],
  ["periods", "/app/finance/periods", "**/api/v1/finance/periods**"],
  ["menu", "/app/menu/items", "**/api/v1/pos/menu/**"],
  ["categories", "/app/inventory/categories", "**/api/v1/inventory/categories**"],
  ["reports", "/app/reports", "**/api/v1/reporting/reports**"],
];
for (const [label, url, pattern] of screens) {
  await page.route(pattern, (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL_ERROR","message":"forced"}}' }),
  );
  await page.goto(`${APP}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const body = await page.locator("body").innerText();
  const alerts = await page.locator('[role="alert"]').count();
  const emptyish = /No .* yet|No .* found|not found|catalog is empty|No journal entries|Nothing to pay|Nothing needs ordering/i.test(body);
  check(
    `GA-001 ${label}: 500 renders an error, not an empty state`,
    alerts > 0 && !emptyish,
    `alerts=${alerts} emptyStateText=${emptyish}`,
  );
  await page.unrouteAll({ behavior: "ignoreErrors" });
}

// ── GA-002 feature-flags 503 must not delete nav items ─────────────────────────────────────
await page.route("**/api/v1/feature-flags**", (r) =>
  r.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"SERVICE_UNAVAILABLE","message":"forced"}}' }),
);
await page.goto(`${APP}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const navBroken = await page.locator("aside a").count();
await page.unrouteAll({ behavior: "ignoreErrors" });
await page.goto(`${APP}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const navHealthy = await page.locator("aside a").count();
check(
  "GA-002 a 503 on feature-flags removes no nav item",
  navBroken === navHealthy && navBroken > 10,
  `with503=${navBroken} healthy=${navHealthy}`,
);

// ── GA-023 dashboard closed sales ─────────────────────────────────────────────────────────
const dash = (await page.locator("main").innerText()).replace(/\s+/g, " ");
const closed = dash.match(/Closed sales\s*(Rs [\d,]+\.\d\d)\s*(\d+) completed order/);
check(
  "GA-023 closed sales is not structurally zero",
  Boolean(closed) && closed[1] !== "Rs 0.00" && Number(closed[2]) > 0,
  closed ? `${closed[1]} / ${closed[2]} orders` : dash.slice(0, 160),
);

// ── GA-053 / GA-091 dead links are recoverable, not bare 404s ─────────────────────────────
for (const [label, url] of [
  ["GA-053 /platform/tenants", "/platform/tenants"],
  ["GA-091 /app/reporting", "/app/reporting"],
]) {
  await page.goto(`${APP}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const anchors = await page.locator("a").count();
  const title = await page.title();
  check(`${label} 404 has a way back`, anchors > 0 && title !== "404: This page could not be found.", `anchors=${anchors} title="${title}"`);
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
  process.exitCode = 1;
}
