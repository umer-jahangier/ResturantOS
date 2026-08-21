/*
 * RECHECK E — the ONE business-model adaptivity control the platform ships: per-tenant module
 * toggles on the SuperAdmin tenant page. Does turning a module off change what the tenant can
 * see and do, or is it a label in a console?
 *
 * Measured three ways: the tenant's own API, the tenant's sidebar, and the tenant's page.
 * argv: <ownerEmail> <ownerPassword> <ownerTotp> <brandName>
 */
import { launch, login, loginAs, OUT, BASE, api, tokenForRecord } from "./rc-lib.mjs";

const OWNER = { slug: "", email: process.argv[2], password: process.argv[3], totp: process.argv[4] };
const BRAND = process.argv[5];
const PROBES = {
  hr: "/api/v1/hr/employees?page=0&size=1",
  crm: "/api/v1/crm/customers?page=0&size=1",
  inventory: "/api/v1/inventory/uom",
};

async function probeApi(token) {
  const out = {};
  for (const [k, p] of Object.entries(PROBES)) out[k] = (await api("GET", p, token)).status;
  return out;
}

async function ownerNav(browser, label) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await c.newPage();
  await loginAs(p, OWNER, label);
  await p.waitForTimeout(5000);
  const hrefs = await p.locator("nav a, aside a").evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
  );
  await p.screenshot({ path: `${OUT}/E-nav-${label}.png`, fullPage: true });
  return { ctx: c, page: p, hrefs };
}

const { browser, page } = await launch();
try {
  const t1 = await tokenForRecord(OWNER);
  console.log("BEFORE — tenant API:", JSON.stringify(await probeApi(t1)));
  const navBefore = await ownerNav(browser, "before");
  console.log("BEFORE — nav:", JSON.stringify(navBefore.hrefs));
  console.log("BEFORE — HR in nav?", navBefore.hrefs.some((h) => h.includes("/hr")));
  await navBefore.ctx.close();

  // ── SuperAdmin flips FEATURE_HR off, in the browser ────────────────────────────────
  await login(page, "superadmin");
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await page.getByText(BRAND, { exact: false }).first().click();
  await page.waitForTimeout(5000);
  console.log("TENANT DETAIL:", page.url());
  const row = () => page.locator("tr", { hasText: "FEATURE_HR" }).first();
  console.log("FEATURE_HR before:", (await row().innerText()).replace(/\s+/g, " "));
  await page.screenshot({ path: `${OUT}/E1-modules-before.png`, fullPage: true });
  await row().getByRole("button", { name: /^disable$/i }).click();
  await page.waitForTimeout(6000);
  console.log("FEATURE_HR after :", (await row().innerText()).replace(/\s+/g, " "));
  await page.screenshot({ path: `${OUT}/E2-modules-after.png`, fullPage: true });

  await new Promise((r) => setTimeout(r, 8000));

  // ── does it bite? ──────────────────────────────────────────────────────────────────
  const t2 = await tokenForRecord(OWNER);
  console.log("AFTER  — tenant API:", JSON.stringify(await probeApi(t2)));
  const navAfter = await ownerNav(browser, "after");
  console.log("AFTER  — nav:", JSON.stringify(navAfter.hrefs));
  console.log("AFTER  — HR in nav?", navAfter.hrefs.some((h) => h.includes("/hr")));
  await navAfter.page.goto(`${BASE}/app/hr/employees`, { waitUntil: "domcontentloaded" });
  await navAfter.page.waitForTimeout(6000);
  await navAfter.page.screenshot({ path: `${OUT}/E3-hr-page-while-disabled.png`, fullPage: true });
  console.log("HR PAGE WHILE MODULE IS OFF:", (await navAfter.page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700));
  await navAfter.ctx.close();

  // ── restore ────────────────────────────────────────────────────────────────────────
  await row().getByRole("button", { name: /^enable$/i }).click().catch((e) => console.log("restore failed:", e.message));
  await page.waitForTimeout(5000);
  console.log("FEATURE_HR restored:", (await row().innerText()).replace(/\s+/g, " "));
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/E-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
