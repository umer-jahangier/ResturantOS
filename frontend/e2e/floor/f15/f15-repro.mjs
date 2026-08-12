/*
 * F15 — REPRODUCTION: does /app/reports/<a code that does not exist> render a working-looking
 * report shell instead of saying the report is not there?
 *
 * Walkthrough §3 #20 recorded `/app/reports/audit` rendering "← All reports / audit / From To".
 * This drives it as the OWNER — the persona who reads reports — and measures, out of the live
 * DOM rather than the source:
 *   - the <h1> the page chose (a title from the catalog, or the raw URL segment);
 *   - how many date inputs are on screen (a form the user can operate is the "working-looking"
 *     part of the claim);
 *   - every [role="alert"], so an error state is never mistaken for an empty one;
 *   - the reporting API calls the page made and their statuses;
 *   - and, as the control, that a REAL code still renders its columns and rows.
 */
import { PEOPLE, newBrowser, newPage, login, BASE, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F15");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["/app/reports", "00-report-list"],
  ["/app/reports/definitely-not-a-report", "01-bogus-code"],
  ["/app/reports/audit", "02-audit-code"],
  ["/app/reports/purchases-by-po", "03-real-purchases-by-po"],
  ["/app/reports/sales-by-day", "04-real-sales-by-day"],
];

export async function probe(page, route, shotName, outDir = OUT) {
  const api = [];
  const onResp = (r) => {
    const u = r.url();
    if (u.includes("/api/v1/reporting/")) api.push(`${r.request().method()} ${r.status()} ${u}`);
  };
  page.on("response", onResp);
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const info = await page.evaluate(() => {
    const text = (document.body.innerText || "").trim();
    return {
      url: location.href,
      h1: Array.from(document.querySelectorAll("h1")).map((n) => n.textContent.trim()),
      dateInputs: document.querySelectorAll('input[type="date"]').length,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        n.textContent.trim().slice(0, 260),
      ),
      backLinks: Array.from(document.querySelectorAll("a"))
        .map((a) => `${a.textContent.trim().slice(0, 40)} -> ${a.getAttribute("href")}`)
        .filter((s) => s.includes("/app/reports")),
      tableHeaders: Array.from(document.querySelectorAll("table thead th")).map((n) =>
        n.textContent.trim(),
      ),
      tableRows: document.querySelectorAll("table tbody tr").length,
      text: text.slice(0, 800),
    };
  });
  if (shotName) await page.screenshot({ path: `${outDir}/${shotName}.png`, fullPage: false });
  page.off("response", onResp);
  return { route, ...info, api };
}

async function main() {
  const browser = await newBrowser();
  const page = await newPage(browser);
  const results = [];
  try {
    await login(page, PEOPLE.owner);
    for (const [route, name] of ROUTES) {
      const r = await probe(page, route, name);
      results.push(r);
      log(`\n=== ${route} ===`);
      log(JSON.stringify(r, null, 2));
    }
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/f15-repro.json`, JSON.stringify(results, null, 2));

  const bogus = results.find((r) => r.route.endsWith("definitely-not-a-report"));
  log("\n--- VERDICT ---");
  log(`bogus code h1            : ${JSON.stringify(bogus.h1)}`);
  log(`bogus code date inputs   : ${bogus.dateInputs}`);
  log(`bogus code alerts        : ${JSON.stringify(bogus.alerts)}`);
  log(`bogus code reporting API : ${JSON.stringify(bogus.api)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
