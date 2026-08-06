// Standalone role/module access audit — logs in as each seeded role, captures the
// visible sidebar modules, screenshots, and probes a restricted route per role.
// Run from frontend/: node e2e/role-access-demo.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const TENANT = "test";
const PW = "Test@123!";
const OUT =
  process.env.SHOT_DIR ??
  "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/60d88bf0-c840-474e-b08a-41882bdc7219/scratchpad/shots";
mkdirSync(OUT, { recursive: true });

const ROLES = [
  {
    key: "admin",
    email: "admin@test.com",
    expectModules: ["POS", "Kitchen Display", "Finance", "Purchasing"],
    restricted: null,
  },
  {
    key: "cashier",
    email: "cashier@test.com",
    expectModules: ["POS"],
    restricted: "/app/finance/accounts",
  },
  {
    key: "kitchen",
    email: "kitchen1@test.com",
    expectModules: ["Kitchen Display"],
    restricted: "/app/finance/accounts",
  },
];

async function login(page, email) {
  await page.goto(`${BASE}/login?tenant=${TENANT}`, { waitUntil: "networkidle", timeout: 45000 });
  const tenantField = page.locator('input[name="tenantSlug"]');
  if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false))
    await tenantField.fill(TENANT);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 20000 });
}

async function visibleModules(page) {
  // Sidebar nav links under /app/*; collect their visible trimmed text labels.
  const links = page.locator('a[href^="/app/"]');
  const n = await links.count();
  const set = new Set();
  for (let i = 0; i < n; i++) {
    const el = links.nth(i);
    if (await el.isVisible().catch(() => false)) {
      const t = (await el.innerText().catch(() => "")).trim();
      if (t) set.add(t.split("\n")[0]);
    }
  }
  return [...set];
}

const results = [];
const browser = await chromium.launch();
for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const r = {
    role: role.key,
    email: role.email,
    ok: false,
    modules: [],
    missingExpected: [],
    restrictedProbe: null,
    error: null,
  };
  try {
    await login(page, role.email);
    await page.waitForTimeout(2500);
    r.modules = await visibleModules(page);
    r.missingExpected = role.expectModules.filter((m) => !r.modules.some((x) => x.includes(m)));
    await page.screenshot({ path: `${OUT}/${role.key}-dashboard.png`, fullPage: true });
    // Probe a restricted route
    if (role.restricted) {
      await page
        .goto(`${BASE}${role.restricted}`, { waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(1500);
      const url = page.url();
      const bodyTxt = (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).toLowerCase();
      const blocked =
        !url.includes(role.restricted) ||
        /denied|not authorized|forbidden|no access|permission|403|404|not found/.test(bodyTxt);
      r.restrictedProbe = { route: role.restricted, finalUrl: url.replace(BASE, ""), blocked };
      await page.screenshot({ path: `${OUT}/${role.key}-restricted.png`, fullPage: true });
    }
    r.ok = r.missingExpected.length === 0;
  } catch (e) {
    r.error = String(e).split("\n")[0];
  }
  results.push(r);
  await ctx.close();
  console.log(
    `[${role.key}] ok=${r.ok} modules=[${r.modules.join(", ")}] missing=[${r.missingExpected.join(",")}] restricted=${JSON.stringify(r.restrictedProbe)} err=${r.error ?? ""}`,
  );
}
await browser.close();
console.log("\n=== JSON ===");
console.log(JSON.stringify(results, null, 2));
