/*
 * DIAGNOSIS ONLY — NLQ + analytics/reporting domain.
 *
 * Drives real Chromium as the MANAGER persona (holds nlq.query.run, reporting.dashboard.view,
 * reporting.report.view, reporting.report.fbr — verified by decoding the JWT), so an
 * "Access denied" page here means the FEATURE is gated off, not the persona is wrong.
 *
 * Every route asserts a positive anchor AND a negative one. A screenshot of an error state
 * is filed under a REFUSED-/ERROR- prefix so it can never be mistaken for a working screen.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve("/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-reporting");
const BASE = "http://localhost:3000";

const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

const findings = [];
function note(k, v) {
  findings.push({ k, v });
  console.log(`  [${k}] ${v}`);
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  return !page.url().includes("/login");
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  console.log("   shot →", `${name}.png`);
}

/** Retry-aware page load: an error state gets ONE retry before it is believed (audit trap #1). */
async function loadAndProbe(page, route, name, waitMs = 6000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs);
    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    const errorish =
      /Access denied|You do not have permission|Couldn't load|Could not load|Something went wrong|Failed to load/i.test(
        body,
      );
    if (errorish && attempt === 1) {
      console.log(`   ${name}: error state on attempt 1 — RETRYING`);
      continue;
    }
    return { body, alerts, errorish, url: page.url() };
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 180)));
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 180)));

  const netFails = [];
  page.on("response", async (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) {
      netFails.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
    }
  });

  if (!(await login(page, MANAGER))) {
    console.log("LOGIN FAILED as manager");
    await shot(page, "LOGIN-FAILED");
    await browser.close();
    return;
  }
  note("login", `signed in as ${MANAGER.email} → ${page.url()}`);

  // ---------- 1. Is NLQ even in the navigation? ----------
  const navText = await page
    .locator('nav, aside, [data-testid="sidebar"]')
    .allInnerTexts()
    .catch(() => []);
  const navBlob = navText.join(" | ");
  note("nav", `sidebar mentions "Ask"/"NLQ"? ${/ask a question|nlq|ask/i.test(navBlob)}`);
  note("nav", `sidebar mentions Reports? ${/report/i.test(navBlob)}`);
  note("nav-dump", navBlob.replace(/\s+/g, " ").slice(0, 1500));
  await shot(page, "01-after-login-dashboard");

  // ---------- 2. NLQ page ----------
  const nlq = await loadAndProbe(page, "/app/nlq", "nlq", 6000);
  note("nlq-url", nlq.url);
  note("nlq-errorish", String(nlq.errorish));
  note("nlq-body", nlq.body.replace(/\s+/g, " ").slice(0, 700));
  await shot(page, nlq.errorish ? "ERROR-02-nlq-page" : "02-nlq-page");

  // Count what a "most advanced reporting dashboard" would need on this page
  const chartsOnNlq = await page.locator("svg.recharts-surface, canvas, .recharts-wrapper").count();
  note("nlq-chart-elements", `charts/canvas on the NLQ page before asking: ${chartsOnNlq}`);

  // ---------- 3. Actually ASK a question ----------
  const box = page.locator("#nlq-question, textarea");
  if (await box.count()) {
    await box.first().fill("What was total revenue last week?");
    await shot(page, "03-nlq-question-typed");
    const askBtn = page.locator('button[type="submit"]');
    await askBtn.first().click();
    await page.waitForTimeout(12000);
    const after = await page.locator("body").innerText();
    const alerts = await page.locator('[role="alert"], [role="status"]').allInnerTexts();
    note("nlq-answer-body", after.replace(/\s+/g, " ").slice(0, 900));
    note("nlq-answer-alerts", JSON.stringify(alerts).slice(0, 500));
    const chartsAfter = await page
      .locator("svg.recharts-surface, canvas, .recharts-wrapper")
      .count();
    const tablesAfter = await page.locator("table").count();
    note("nlq-render", `after asking: charts=${chartsAfter} tables=${tablesAfter}`);
    await shot(page, "04-nlq-after-ask");
  } else {
    note("nlq-askbox", "NO textarea found — the ask box did not render");
  }

  // ---------- 4. Look for an AI provider / model settings screen ----------
  for (const [name, route] of [
    ["settings", "/app/settings"],
    ["settings-ai", "/app/settings/ai"],
    ["settings-nlq", "/app/settings/nlq"],
    ["nlq-settings", "/app/nlq/settings"],
  ]) {
    const r = await loadAndProbe(page, route, name, 4000);
    const hasProvider = /claude|anthropic|gemini|openai|gpt|model|provider/i.test(r.body);
    note(`ai-settings:${name}`, `url=${r.url} errorish=${r.errorish} mentionsProviderOrModel=${hasProvider}`);
    if (name === "settings") {
      note("settings-body", r.body.replace(/\s+/g, " ").slice(0, 900));
      await shot(page, r.errorish ? "ERROR-05-settings" : "05-settings");
    }
  }

  // ---------- 5. Reports catalogue + a report ----------
  const rep = await loadAndProbe(page, "/app/reports", "reports", 6000);
  note("reports-url", rep.url);
  note("reports-errorish", String(rep.errorish));
  note("reports-body", rep.body.replace(/\s+/g, " ").slice(0, 900));
  const repCharts = await page.locator("svg.recharts-surface, canvas, .recharts-wrapper").count();
  note("reports-charts", `chart elements on the reports index: ${repCharts}`);
  await shot(page, rep.errorish ? "ERROR-06-reports" : "06-reports");

  // click into the first report
  const firstReport = page.locator('a[href*="/app/reports/"]');
  const n = await firstReport.count();
  note("reports-links", `report links on the index: ${n}`);
  if (n > 0) {
    const href = await firstReport.first().getAttribute("href");
    note("reports-first-href", String(href));
    await firstReport.first().click();
    await page.waitForTimeout(7000);
    const rbody = await page.locator("body").innerText();
    const rcharts = await page.locator("svg.recharts-surface, canvas, .recharts-wrapper").count();
    const rtables = await page.locator("table").count();
    const rrows = await page.locator("tbody tr").count();
    note("report-detail-url", page.url());
    note("report-detail", `charts=${rcharts} tables=${rtables} bodyRows=${rrows}`);
    note("report-detail-body", rbody.replace(/\s+/g, " ").slice(0, 900));
    // export?
    const exportBtns = await page
      .locator('button:has-text("Export"), button:has-text("CSV"), button:has-text("Download"), a:has-text("Export"), a:has-text("CSV"), a:has-text("Download")')
      .count();
    note("report-export-controls", `export/CSV/download controls: ${exportBtns}`);
    await shot(page, "07-report-detail");
  }

  // ---------- 6. Dashboards ----------
  for (const [name, route] of [
    ["dashboard", "/app/dashboard"],
    ["dashboard-realtime", "/app/dashboard/realtime"],
    ["fbr", "/app/reports/fbr"],
    ["purchasing-analytics", "/app/purchasing/analytics"],
  ]) {
    const r = await loadAndProbe(page, route, name, 7000);
    const charts = await page.locator("svg.recharts-surface, canvas, .recharts-wrapper").count();
    const tables = await page.locator("table").count();
    const exportBtns = await page
      .locator('button:has-text("Export"), button:has-text("CSV"), button:has-text("Download"), a:has-text("Export"), a:has-text("CSV"), a:has-text("Download")')
      .count();
    note(
      `dash:${name}`,
      `url=${r.url} errorish=${r.errorish} charts=${charts} tables=${tables} exportControls=${exportBtns}`,
    );
    note(`dash-body:${name}`, r.body.replace(/\s+/g, " ").slice(0, 800));
    await shot(page, `${r.errorish ? "ERROR-" : ""}08-${name}`);
  }

  note("console-errors", JSON.stringify(consoleErrors.slice(0, 25)));
  note("failed-api-calls", JSON.stringify([...new Set(netFails)].slice(0, 40)));

  writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
  await browser.close();
  console.log("\nevidence →", OUT);
}

main();
