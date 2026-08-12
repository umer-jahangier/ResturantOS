/*
 * F15 — PROOF, driven as owner@terrace.local in real Chromium.
 *
 * The click path the item specifies, in order:
 *   1. /app/reports/definitely-not-a-report — the page must SAY the code does not exist, must
 *      not draw a date-range form, must not title itself from the URL, and must not ask
 *      reporting-service to run something it knows is not there;
 *   2. CLICK "Back to all reports" — the link must actually land on the catalog;
 *   3. /app/reports/audit — the exact URL the walkthrough photographed (§3 #20);
 *   4. /app/reports/purchases-by-po and /app/reports/sales-by-day — the control. A real report
 *      still renders the same columns and the same number of rows as before the change.
 *
 * Everything asserted is read out of the live DOM or off the wire. The date-form check counts
 * `input[type=date]` elements that are actually in the document; the "no doomed request" check
 * counts POSTs to `/reports/<code>/run` seen by the page's own network listener.
 *
 * Also captures the not-found state at 390 / 768 / 1440 in light and dark.
 */
import { PEOPLE, newBrowser, newPage, login, BASE, log } from "../../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F15");
mkdirSync(OUT, { recursive: true });

const BOGUS = "definitely-not-a-report";

async function visit(page, route, shot) {
  const runPosts = [];
  const onResp = (r) => {
    if (r.request().method() === "POST" && r.url().includes("/reporting/reports/"))
      runPosts.push(`${r.status()} ${r.url()}`);
  };
  page.on("response", onResp);
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const seen = await page.evaluate(() => ({
    url: location.href,
    h1: Array.from(document.querySelectorAll("h1")).map((n) => n.textContent.trim()),
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    notFoundPanel: !!document.querySelector('[data-testid="report-not-found"]'),
    notFoundText: (
      document.querySelector('[data-testid="report-not-found"]')?.innerText || ""
    ).trim(),
    backLink: (() => {
      const a = Array.from(document.querySelectorAll("a")).find((n) =>
        /back to all reports/i.test(n.textContent || ""),
      );
      return a ? a.getAttribute("href") : null;
    })(),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
      n.textContent.trim().slice(0, 200),
    ),
    tableHeaders: Array.from(document.querySelectorAll("table thead th")).map((n) =>
      n.textContent.trim(),
    ),
    tableRows: document.querySelectorAll("table tbody tr").length,
  }));
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: false });
  page.off("response", onResp);
  return { route, ...seen, runPosts };
}

function check(label, ok, detail) {
  log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const browser = await newBrowser();
const page = await newPage(browser);
const results = {};
let allOk = true;
try {
  await login(page, PEOPLE.owner);

  // ── 1. the unknown code ────────────────────────────────────────────────────
  const bogus = await visit(page, `/app/reports/${BOGUS}`, "10-not-found-1440-light");
  results.bogus = bogus;
  log(`\n/app/reports/${BOGUS}`);
  allOk &= check("says the report does not exist", /doesn't exist/i.test(bogus.notFoundText));
  allOk &= check(
    "names the code that was asked for",
    bogus.notFoundText.includes(BOGUS),
    JSON.stringify(bogus.notFoundText.slice(0, 160)),
  );
  allOk &= check(
    "heading is NOT made from the URL",
    bogus.h1.length === 1 && bogus.h1[0] === "Report not found",
    JSON.stringify(bogus.h1),
  );
  allOk &= check("no date-range form", bogus.dateInputs === 0, `dateInputs=${bogus.dateInputs}`);
  allOk &= check("links back to the report list", bogus.backLink === "/app/reports");
  allOk &= check(
    "no doomed run request",
    bogus.runPosts.length === 0,
    JSON.stringify(bogus.runPosts),
  );

  // ── 2. the link works, by clicking it ──────────────────────────────────────
  await page.getByRole("link", { name: /back to all reports/i }).click();
  await page.waitForTimeout(2500);
  const landed = await page.evaluate(() => ({
    url: location.href,
    reports: Array.from(document.querySelectorAll('a[href^="/app/reports/"]')).length,
  }));
  results.landed = landed;
  await page.screenshot({ path: `${OUT}/11-back-to-list.png` });
  log("\nclick “Back to all reports”");
  allOk &= check("lands on the catalog", landed.url.endsWith("/app/reports"), landed.url);
  allOk &= check("catalog is populated", landed.reports >= 7, `${landed.reports} report links`);

  // ── 3. the URL the walkthrough photographed ────────────────────────────────
  const audit = await visit(page, "/app/reports/audit", "12-audit-code");
  results.audit = audit;
  log("\n/app/reports/audit (walkthrough §3 #20)");
  allOk &= check("says the report does not exist", audit.notFoundPanel);
  allOk &= check("no date-range form", audit.dateInputs === 0);
  allOk &= check("no run request", audit.runPosts.length === 0);

  // ── 4. the control: real reports unchanged ─────────────────────────────────
  for (const [code, shot, expectHeaders] of [
    [
      "purchases-by-po",
      "13-purchases-by-po",
      ["Purchase Order Id", "Business Date", "Invoice Count", "Spend Paisa", "Input Tax Paisa"],
    ],
    [
      "sales-by-day",
      "14-sales-by-day",
      [
        "Business Date",
        "Order Count",
        "Subtotal Paisa",
        "Discount Paisa",
        "Tax Paisa",
        "Total Paisa",
      ],
    ],
  ]) {
    const real = await visit(page, `/app/reports/${code}`, shot);
    results[code] = real;
    log(`\n/app/reports/${code}`);
    allOk &= check("titled from the catalog, not the URL", real.h1[0] !== code, real.h1[0]);
    allOk &= check("date-range form present", real.dateInputs === 2);
    allOk &= check(
      "columns unchanged",
      JSON.stringify(real.tableHeaders) === JSON.stringify(expectHeaders),
      JSON.stringify(real.tableHeaders),
    );
    allOk &= check("rows rendered", real.tableRows > 0, `${real.tableRows} rows`);
    allOk &= check("ran exactly once, successfully", real.runPosts.length >= 1 && real.runPosts.every((p) => p.startsWith("200")), JSON.stringify(real.runPosts));
    allOk &= check("no error alert", real.alerts.length === 0, JSON.stringify(real.alerts));
    allOk &= check("not-found panel absent", !real.notFoundPanel);
  }

  // ── 5. responsive + dark ───────────────────────────────────────────────────
  // The theme is set the way a person sets it: by pressing the header's theme button until the
  // document is in the wanted mode. Writing localStorage directly does NOT work here — the app
  // starts on `system` with nothing stored, so a hand-written key is ignored and every "dark"
  // screenshot silently comes out light. (Observed: three dark screenshots that were not dark.)
  log("\nresponsive / theme");
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${BASE}/app/reports/${BOGUS}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 4; i++) {
      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      if (isDark === (theme === "dark")) break;
      await page.locator('button[aria-label^="Switch to"]').first().click();
      await page.waitForTimeout(600);
    }

    for (const [w, h, name] of [
      [390, 844, "390"],
      [768, 1024, "768"],
      [1440, 950, "1440"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/app/reports/${BOGUS}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const m = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="report-not-found"]');
        if (!el) return { present: false };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const body = getComputedStyle(document.body);
        return {
          present: true,
          dark: document.documentElement.classList.contains("dark"),
          overflowsX: document.documentElement.scrollWidth > window.innerWidth + 1,
          width: Math.round(r.width),
          color: cs.color,
          bodyBg: body.backgroundColor,
        };
      });
      await page.screenshot({ path: `${OUT}/20-not-found-${name}-${theme}.png` });
      log(`  ${name} ${theme}: ${JSON.stringify(m)}`);
      allOk &= check(
        `not-found renders at ${name} (${theme})`,
        m.present && !m.overflowsX && m.dark === (theme === "dark"),
      );
      results[`viewport-${name}-${theme}`] = m;
    }
  }
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/f15-prove.json`, JSON.stringify(results, null, 2));
log(`\n=== ${allOk ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} ===`);
process.exit(allOk ? 0 : 1);
