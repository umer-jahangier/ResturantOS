/*
 * RECHECK E3 — FEATURE_HR is now OFF for this tenant (override recorded, survives reload).
 * The confirm dialog promised: "Every user loses access to this module immediately — its screens
 * stop loading and its API calls are refused on the next request."
 * Measure that promise.
 * argv: <ownerEmail> <ownerPassword> <ownerTotp>
 */
import { launch, loginAs, OUT, BASE, api, tokenForRecord } from "./rc-lib.mjs";

const OWNER = { slug: "", email: process.argv[2], password: process.argv[3], totp: process.argv[4] };

const { browser, page } = await launch();
try {
  const t = await tokenForRecord(OWNER);
  for (const [k, p] of Object.entries({
    hr_employees: "/api/v1/hr/employees?page=0&size=1",
    hr_payroll: "/api/v1/hr/payroll/runs?page=0&size=1",
    hr_departments: "/api/v1/hr/departments",
    crm_control: "/api/v1/crm/customers?page=0&size=1",
  })) {
    const r = await api("GET", p, t);
    console.log(`API ${k.padEnd(16)} -> ${r.status}  ${r.text.slice(0, 120)}`);
  }

  await loginAs(page, OWNER, "owner");
  await page.waitForTimeout(5000);
  const hrefs = await page.locator("nav a, aside a").evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute("href")).filter(Boolean))],
  );
  console.log("NAV WITH HR DISABLED:", JSON.stringify(hrefs));
  console.log("HR STILL IN THE SIDEBAR?", hrefs.some((h) => h.includes("/hr")));
  await page.screenshot({ path: `${OUT}/G1-nav-hr-off.png`, fullPage: true });

  for (const r of ["/app/hr", "/app/hr/employees", "/app/hr/payroll"]) {
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const t2 = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: `${OUT}/G2${r.replace(/\//g, "_")}.png`, fullPage: true });
    console.log(`\nPAGE ${r}:`);
    console.log("   ", t2.slice(t2.indexOf("Collapse") + 8, t2.indexOf("Collapse") + 700));
  }

  // And can a real HR write still go through while the module is "off"?
  const w = await api("POST", "/api/v1/hr/departments", t, { code: `RCK${Date.now() % 10000}`, name: "Recheck Dept" });
  console.log("\nWRITE WHILE MODULE OFF: POST /hr/departments ->", w.status, w.text.slice(0, 200));
} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  await browser.close();
}
