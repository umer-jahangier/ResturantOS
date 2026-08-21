/*
 * RECHECK D — business-model adaptivity, driven for real.
 *
 * (a) Route probes AS THE TENANT OWNER, not as SuperAdmin. The first audit probed /app/onboarding
 *     and /app/setup with a SuperAdmin session; a tenant route 404ing for a tenant-less principal
 *     proves nothing. Redone with the persona who would actually use it.
 * (b) The ONE adaptivity control the platform ships: per-tenant module toggles. Does turning a
 *     module OFF in the platform console actually change what the tenant sees and can do?
 * (c) The POS terminal "service model" (COUNTER / TABLE_SERVICE / SELF_SERVE) — is it a behaviour
 *     or a label?
 *
 * argv: <ownerEmail> <ownerPassword> <ownerTotpSecret> <tenantBrandName>
 */
import { launch, login, loginAs, visit, OUT, BASE, totpNow, api, tokenForRecord } from "./rc-lib.mjs";

const OWNER = { slug: "", email: process.argv[2], password: process.argv[3], totp: process.argv[4] };
const BRAND = process.argv[5];

const { browser, page } = await launch();
try {
  // ── (a) route probes as the OWNER ──────────────────────────────────────────────────
  await loginAs(page, OWNER, "owner");
  console.log("\n=== (a) ONBOARDING ROUTE PROBES AS THE TENANT OWNER ===");
  for (const r of [
    "/app/onboarding", "/app/setup", "/app/getting-started", "/app/welcome", "/app/settings/tax",
    "/app/settings/business", "/app/settings/general", "/onboarding", "/setup", "/welcome",
    "/app/settings/branches", "/app/branches", "/app/settings/company",
  ]) {
    const res = await visit(page, r, `D-probe${r.replace(/\//g, "_")}`, { wait: 2500, chars: 120 });
    console.log(`   PROBE ${r} -> ${res.is404 ? "404" : res.denied ? "DENIED" : "EXISTS"}`);
  }

  // Everything the owner's own nav actually offers, so nothing is missed by guessing URLs.
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const navHrefs = await page.locator("nav a, aside a").evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
  );
  console.log("\nEVERY NAV DESTINATION THE OWNER HAS:", JSON.stringify(navHrefs));

  // ── (b) module toggle: does it bite? ───────────────────────────────────────────────
  console.log("\n=== (b) MODULE TOGGLE END TO END ===");
  const tok = await tokenForRecord(OWNER);
  const before = {
    hr: (await api("GET", "/api/v1/hr/employees?page=0&size=1", tok)).status,
    crm: (await api("GET", "/api/v1/crm/customers?page=0&size=1", tok)).status,
    inv: (await api("GET", "/api/v1/inventory/uom", tok)).status,
  };
  console.log("BEFORE toggle — API status:", JSON.stringify(before));
  const navBefore = navHrefs.filter((h) => /hr|crm|customer/i.test(h));
  console.log("BEFORE toggle — HR/CRM nav entries:", JSON.stringify(navBefore));

  // SuperAdmin turns FEATURE_HR off for this tenant, in the browser.
  const sa = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const sp = await sa.newPage();
  await login(sp, "superadmin");
  await sp.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await sp.waitForTimeout(4000);
  await sp.getByText(BRAND).first().click();
  await sp.waitForTimeout(4000);
  console.log("tenant detail:", sp.url());
  const hrRow = sp.locator("tr", { hasText: "FEATURE_HR" }).first();
  console.log("FEATURE_HR row:", (await hrRow.innerText()).replace(/\s+/g, " "));
  await hrRow.getByRole("button", { name: /disable/i }).click();
  await sp.waitForTimeout(5000);
  await sp.screenshot({ path: `${OUT}/D1-hr-disabled.png`, fullPage: true });
  console.log("FEATURE_HR row after:", (await sp.locator("tr", { hasText: "FEATURE_HR" }).first().innerText()).replace(/\s+/g, " "));

  await page.waitForTimeout(3000);
  const tok2 = await tokenForRecord(OWNER);
  const after = {
    hr: (await api("GET", "/api/v1/hr/employees?page=0&size=1", tok2)).status,
    crm: (await api("GET", "/api/v1/crm/customers?page=0&size=1", tok2)).status,
    inv: (await api("GET", "/api/v1/inventory/uom", tok2)).status,
  };
  console.log("AFTER toggle — API status:", JSON.stringify(after));

  // Fresh browser session for the owner — does the nav lose HR?
  const oc = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const op = await oc.newPage();
  await loginAs(op, OWNER, "owner-after-toggle");
  await op.waitForTimeout(4000);
  const navAfter = await op.locator("nav a, aside a").evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
  );
  console.log("AFTER toggle — nav destinations:", JSON.stringify(navAfter));
  console.log("HR STILL IN NAV?", navAfter.some((h) => /\/hr/.test(h)));
  await op.goto(`${BASE}/app/hr/employees`, { waitUntil: "domcontentloaded" });
  await op.waitForTimeout(5000);
  await op.screenshot({ path: `${OUT}/D2-hr-page-after-disable.png`, fullPage: true });
  const hrTxt = (await op.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("HR PAGE AFTER DISABLE:", hrTxt.slice(0, 600));

  // put it back
  await sp.locator("tr", { hasText: "FEATURE_HR" }).first().getByRole("button", { name: /enable/i }).click().catch(() => {});
  await sp.waitForTimeout(4000);

  // ── (c) POS terminal service model ─────────────────────────────────────────────────
  console.log("\n=== (c) TERMINAL SERVICE MODEL ===");
  await visit(op, "/app/terminals", "D3-terminals", { chars: 1200 });
  const addBtn = op.getByRole("button", { name: /new terminal|add terminal|create/i });
  console.log("create-terminal affordance:", await addBtn.count());
  if (await addBtn.count()) {
    await addBtn.first().click();
    await op.waitForTimeout(2000);
    const d = op.locator('[role="dialog"]').last();
    console.log("terminal dialog box:", JSON.stringify(await d.boundingBox()));
    console.log("terminal dialog text:", (await d.innerText()).replace(/\s+/g, " ").slice(0, 900));
    const opts = await d.locator("select option").allInnerTexts();
    console.log("SELECT OPTIONS:", JSON.stringify(opts));
    await op.screenshot({ path: `${OUT}/D4-terminal-dialog.png`, fullPage: true });
  }
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/D-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
