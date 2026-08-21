/*
 * F15 — INDEPENDENT RE-OPEN ATTEMPT.
 *
 * Not a re-run of the author's harness. Drives the paths the author's proof did NOT cover:
 *   A. the claimed path, plus a RELOAD (does it persist?)
 *   B. warm-catalog-cache ordering — real report first, then bogus via CLIENT-SIDE nav, and the
 *      reverse. A `enabled`-gated query behaves differently when the catalog is already cached.
 *   C. adjacent unknown-code shapes: case variants, near-misses, an existing code with a suffix,
 *      the FBR static segment.
 *   D. the states the author explicitly listed as NOT driven live: catalog 503 outage, and a run
 *      that fails for a REAL code. Produced by route interception in the real browser against the
 *      real bundle — no service is stopped, no other agent is disturbed.
 *   E. wrong persona (cashier, waiter) and a second tenant (Control Bistro) — was anything widened?
 *   F. controls: two real reports still render their rows.
 */
import { PEOPLE, newBrowser, newPage, totpNow, BASE, API } from "../../shift/lib.mjs";

/** The shift lib's own login waits 3s for the TOTP step and loses the race on this machine. */
async function loginOnce(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  // Wait for the app OR the TOTP field, rather than racing a fixed sleep.
  await page
    .waitForFunction(
      () =>
        !location.pathname.startsWith("/login") ||
        !!document.querySelector('input[name="totpCode"], input#totpCode'),
      { timeout: 20000 },
    )
    .catch(() => {});
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP and has no secret`);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page
      .waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 25000 })
      .catch(() => {});
  }
  await page.waitForTimeout(2500);
  return !page.url().includes("/login");
}

async function login(page, who) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await loginOnce(page, who)) {
      console.log(`  ✓ signed in as ${who.email}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      return page;
    }
    await page.waitForTimeout(4000);
  }
  const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 300);
  throw new Error(`login failed for ${who.email} — still at ${page.url()} :: ${body}`);
}
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F15/reopen-indep");
mkdirSync(OUT, { recursive: true });

const CONTROL = {
  slug: "control-bistro",
  email: "owner@control.local",
  password: "Control#Owner1",
  totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
};
const WAITER = {
  slug: "floating-terrace",
  email: "waiter@terrace.local",
  password: "Terrace#Waiter1",
};

const results = [];
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) pass++;
  else fail++;
  const line = `  ${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? ` — ${detail}` : ""}`;
  console.log(line);
  results.push({ label, ok, detail: String(detail ?? "") });
  return ok;
}

function scrape() {
  return {
    url: location.href,
    h1: Array.from(document.querySelectorAll("h1")).map((n) => n.textContent.trim()),
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    notFound: !!document.querySelector('[data-testid="report-not-found"]'),
    notFoundText: (
      document.querySelector('[data-testid="report-not-found"]')?.innerText || ""
    ).trim(),
    outage: !!document.querySelector('[data-testid="query-service-outage"]'),
    queryError: !!document.querySelector('[data-testid="query-error"]'),
    refusal: !!document.querySelector('[data-testid="query-access-refusal"]'),
    accessDenied: /access denied|don't have permission|do not have permission/i.test(
      document.body.innerText,
    ),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
      n.textContent.trim().slice(0, 240),
    ),
    headers: Array.from(document.querySelectorAll("table thead th")).map((n) =>
      n.textContent.trim(),
    ),
    rows: document.querySelectorAll("table tbody tr").length,
    bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  };
}

async function watchRuns(page, fn) {
  const runs = [];
  const on = (r) => {
    if (r.request().method() === "POST" && /\/reporting\/reports\/[^/]+\/run/.test(r.url()))
      runs.push(`${r.status()} ${r.url().split("/reports/")[1]}`);
  };
  page.on("response", on);
  try {
    return { out: await fn(), runs };
  } finally {
    page.off("response", on);
  }
}

async function goto(page, route, wait = 4500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  return page.evaluate(scrape);
}

const browser = await newBrowser();
let page = await newPage(browser);
const record = {};

try {
  // ══ A. the claimed path, as the owner, plus a reload ═══════════════════════
  console.log("\n══ A. owner — unknown code, and does it PERSIST across a reload?");
  await login(page, PEOPLE.owner);

  let r = await watchRuns(page, () => goto(page, "/app/reports/definitely-not-a-report"));
  record.bogus = { ...r.out, runs: r.runs };
  await page.screenshot({ path: `${OUT}/a1-bogus.png` });
  check("h1 is 'Report not found', not the URL slug", r.out.h1.join("|") === "Report not found", r.out.h1.join("|"));
  check("not-found panel present and says it doesn't exist", r.out.notFound && /doesn't exist/i.test(r.out.notFoundText));
  check("panel names the code asked for", r.out.notFoundText.includes("definitely-not-a-report"));
  check("zero date inputs", r.out.dateInputs === 0, r.out.dateInputs);
  check("zero run POSTs fired", r.runs.length === 0, JSON.stringify(r.runs));
  check("no unexplained [role=alert]", r.out.alerts.length === 0, JSON.stringify(r.out.alerts));

  const reload = await watchRuns(page, async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    return page.evaluate(scrape);
  });
  record.bogusReload = { ...reload.out, runs: reload.runs };
  check("PERSISTS after reload — still 'Report not found'", reload.out.h1.join("|") === "Report not found", reload.out.h1.join("|"));
  check("PERSISTS after reload — still 0 date inputs", reload.out.dateInputs === 0, reload.out.dateInputs);
  check("PERSISTS after reload — still 0 run POSTs", reload.runs.length === 0, JSON.stringify(reload.runs));

  // back link, CLICKED
  await page.locator('a:has-text("Back to all reports")').first().click();
  await page.waitForTimeout(3000);
  const cat = await page.evaluate(() => ({
    url: location.href,
    links: Array.from(document.querySelectorAll('a[href^="/app/reports/"]')).map((a) =>
      a.getAttribute("href"),
    ),
  }));
  record.catalog = cat;
  check("clicking 'Back to all reports' lands on /app/reports", cat.url.endsWith("/app/reports"), cat.url);
  check("catalog shows report links", cat.links.length >= 7, cat.links.length);

  // ══ B. warm-cache ordering — client-side navigation ════════════════════════
  console.log("\n══ B. warm catalog cache + CLIENT-SIDE navigation (never a fresh page load)");
  // From the catalog, click into a real report (client-side), then push to a bogus code
  // client-side. The catalog query is now cached, so `isPending` is false immediately — a
  // different code path from the cold load the author drove.
  await page.locator('a[href="/app/reports/sales-by-day"]').first().click();
  await page.waitForTimeout(4000);
  const real1 = await page.evaluate(scrape);
  check("client-side into sales-by-day renders its title", real1.h1.join("|") === "Sales by Day", real1.h1.join("|"));
  check("client-side into sales-by-day renders rows", real1.rows > 0, real1.rows);

  const warm = await watchRuns(page, async () => {
    await page.evaluate(() => {
      window.history.pushState({}, "", "/app/reports/warm-cache-bogus");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.waitForTimeout(1500);
    // pushState alone does not drive the Next router; do a real client-side nav via a link
    return null;
  });
  // Reliable client-side nav: go back to catalog, then inject a Link-driven navigation
  await goto(page, "/app/reports", 3500);
  const warmNav = await watchRuns(page, async () => {
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "/app/reports/warm-cache-bogus";
      a.id = "__f15_probe";
      a.textContent = "probe";
      document.body.appendChild(a);
    });
    await page.locator("#__f15_probe").click();
    await page.waitForTimeout(3500);
    return page.evaluate(scrape);
  });
  record.warmBogus = { ...warmNav.out, runs: warmNav.runs };
  await page.screenshot({ path: `${OUT}/b1-warm-bogus.png` });
  check("warm-cache client-side nav to bogus → 'Report not found'", warmNav.out.h1.join("|") === "Report not found", warmNav.out.h1.join("|"));
  check("warm-cache bogus → 0 date inputs", warmNav.out.dateInputs === 0, warmNav.out.dateInputs);
  check("warm-cache bogus → 0 run POSTs", warmNav.runs.length === 0, JSON.stringify(warmNav.runs));

  // reverse order: bogus first (cold-ish), then client-side to a REAL report — does it recover?
  const backToReal = await watchRuns(page, async () => {
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "/app/reports/purchases-by-po";
      a.id = "__f15_probe2";
      a.textContent = "probe2";
      document.body.appendChild(a);
    });
    await page.locator("#__f15_probe2").click();
    await page.waitForTimeout(4500);
    return page.evaluate(scrape);
  });
  record.bogusThenReal = { ...backToReal.out, runs: backToReal.runs };
  check("from the not-found page, client-side to a REAL report recovers", backToReal.out.h1.join("|") === "Purchases by Purchase Order", backToReal.out.h1.join("|"));
  check("...and actually runs it (>=1 run POST, 200)", backToReal.runs.some((x) => x.startsWith("200")), JSON.stringify(backToReal.runs));
  check("...and renders rows", backToReal.out.rows > 0, backToReal.out.rows);

  // ══ C. adjacent unknown-code shapes ════════════════════════════════════════
  console.log("\n══ C. adjacent unknown-code shapes");
  const shapes = [
    ["/app/reports/audit", "the walkthrough's own URL"],
    ["/app/reports/Sales-By-Day", "case variant of a REAL code"],
    ["/app/reports/sales-by-day-x", "real code with a suffix"],
    ["/app/reports/sales", "prefix of a real code"],
    ["/app/reports/..%2Fetc", "path-traversal-ish segment"],
    ["/app/reports/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", "html in the code"],
  ];
  record.shapes = [];
  for (const [route, why] of shapes) {
    const s = await watchRuns(page, () => goto(page, route, 4000));
    record.shapes.push({ route, why, ...s.out, runs: s.runs });
    check(`${why} → not-found, no form, no run`, s.out.notFound && s.out.dateInputs === 0 && s.runs.length === 0, `${route} h1=${s.out.h1.join("|")} dates=${s.out.dateInputs} runs=${s.runs.length}`);
  }
  // XSS: the code is interpolated into the description — assert it is TEXT not markup
  const xss = await page.evaluate(() => ({
    imgs: document.querySelectorAll('[data-testid="report-not-found"] img').length,
    text: document.querySelector('[data-testid="report-not-found"]')?.innerText || "",
  }));
  check("interpolated code is escaped (no injected <img>)", xss.imgs === 0, xss.imgs);

  // the FBR static segment must still win over [code]
  const fbr = await goto(page, "/app/reports/fbr", 4500);
  record.fbr = fbr;
  await page.screenshot({ path: `${OUT}/c1-fbr.png` });
  check("/app/reports/fbr is NOT swallowed by the not-found branch", !fbr.notFound, fbr.h1.join("|"));

  // ══ D. the states the author said were NOT driven live ═════════════════════
  console.log("\n══ D. catalog outage + failed run for a REAL code, in the real browser");
  // D1 — catalog GET 503. Reporting-service is left alone; the response is faulted in-browser.
  const p2 = await newPage(browser);
  await login(p2, PEOPLE.owner);
  await p2.route(`${API}/api/v1/reporting/reports`, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "reporting-service is not answering" } }) }),
  );
  const outage = await watchRuns(p2, async () => {
    await p2.goto(`${BASE}/app/reports/definitely-not-a-report`, { waitUntil: "domcontentloaded" });
    await p2.waitForTimeout(6000);
    return p2.evaluate(scrape);
  });
  record.catalogOutage = { ...outage.out, runs: outage.runs };
  await p2.screenshot({ path: `${OUT}/d1-catalog-503.png` });
  check("catalog 503 is NOT reported as 'report not found'", !outage.out.notFound, outage.out.notFound);
  check("catalog 503 announces an outage via [role=alert]", outage.out.alerts.length > 0, JSON.stringify(outage.out.alerts).slice(0, 200));
  check("catalog 503 does not draw a date form", outage.out.dateInputs === 0, outage.out.dateInputs);
  await p2.unroute(`${API}/api/v1/reporting/reports`);

  // D2 — a REAL code whose RUN fails 503. Must not read as "no data".
  await p2.route(`${API}/api/v1/reporting/reports/sales-by-day/run`, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "reporting-service is not answering" } }) }),
  );
  await p2.goto(`${BASE}/app/reports/sales-by-day`, { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(7000);
  const runFail = await p2.evaluate(scrape);
  record.runFailure = runFail;
  await p2.screenshot({ path: `${OUT}/d2-run-503.png` });
  check("a REAL report whose run fails announces it", runFail.alerts.length > 0, JSON.stringify(runFail.alerts).slice(0, 220));
  check("a failed run is NOT a silent blank", runFail.outage || runFail.queryError, `outage=${runFail.outage} err=${runFail.queryError}`);
  check("a failed run still shows the report's real title", runFail.h1.join("|") === "Sales by Day", runFail.h1.join("|"));
  await p2.unroute(`${API}/api/v1/reporting/reports/sales-by-day/run`);
  await p2.context().close();

  // ══ E. wrong persona and second tenant ═════════════════════════════════════
  console.log("\n══ E. wrong persona / second tenant — was anything widened?");
  for (const who of [PEOPLE.cashier, WAITER]) {
    const p3 = await newPage(browser);
    await login(p3, who);
    const bogus = await watchRuns(p3, () => {
      return (async () => {
        await p3.goto(`${BASE}/app/reports/definitely-not-a-report`, { waitUntil: "domcontentloaded" });
        await p3.waitForTimeout(4500);
        return p3.evaluate(scrape);
      })();
    });
    const real = await watchRuns(p3, () => {
      return (async () => {
        await p3.goto(`${BASE}/app/reports/sales-by-day`, { waitUntil: "domcontentloaded" });
        await p3.waitForTimeout(4500);
        return p3.evaluate(scrape);
      })();
    });
    record[`persona_${who.email}`] = { bogus: { ...bogus.out, runs: bogus.runs }, real: { ...real.out, runs: real.runs } };
    await p3.screenshot({ path: `${OUT}/e-${who.email.split("@")[0]}-real.png` });
    const denied = real.out.accessDenied || real.out.refusal;
    check(`${who.email} is REFUSED a real report (permission not widened)`, denied, `denied=${denied} rows=${real.out.rows} h1=${real.out.h1.join("|")}`);
    check(`${who.email} sees no report rows`, real.out.rows === 0, real.out.rows);
    check(`${who.email} on a bogus code is refused, not shown a product page`, bogus.out.accessDenied || bogus.out.refusal, `denied=${bogus.out.accessDenied} notFound=${bogus.out.notFound}`);
    await p3.context().close();
  }

  // second tenant
  const p4 = await newPage(browser);
  await login(p4, CONTROL);
  const ctrlBogus = await watchRuns(p4, () => {
    return (async () => {
      await p4.goto(`${BASE}/app/reports/definitely-not-a-report`, { waitUntil: "domcontentloaded" });
      await p4.waitForTimeout(4500);
      return p4.evaluate(scrape);
    })();
  });
  const ctrlReal = await watchRuns(p4, () => {
    return (async () => {
      await p4.goto(`${BASE}/app/reports/sales-by-day`, { waitUntil: "domcontentloaded" });
      await p4.waitForTimeout(5000);
      return p4.evaluate(scrape);
    })();
  });
  record.controlTenant = { bogus: { ...ctrlBogus.out, runs: ctrlBogus.runs }, real: { ...ctrlReal.out, runs: ctrlReal.runs } };
  await p4.screenshot({ path: `${OUT}/e-control-real.png` });
  check("tenant B: bogus code → 'Report not found'", ctrlBogus.out.h1.join("|") === "Report not found", ctrlBogus.out.h1.join("|"));
  check("tenant B: real report renders its own title", ctrlReal.out.h1.join("|") === "Sales by Day", ctrlReal.out.h1.join("|"));
  check("tenant B: sees NO Floating Terrace figures", !/9,603|43,849|32,397/.test(ctrlReal.bodySnippet + JSON.stringify(ctrlReal.headers)), ctrlReal.rows);
  await p4.context().close();

  // ══ F. controls — the real reports, unchanged ══════════════════════════════
  console.log("\n══ F. controls — real reports still render");
  for (const [code, title, minRows] of [
    ["purchases-by-po", "Purchases by Purchase Order", 1],
    ["sales-by-day", "Sales by Day", 1],
    ["sales-by-item", "Sales by Item", 0],
    ["sales-by-hour", "Sales by Hour", 0],
    ["sales-by-order-type", "Sales by Order Type", 0],
    ["discount-summary", "Discount Summary", 0],
    ["till-sessions", "Till Sessions", 0],
  ]) {
    const c = await watchRuns(page, () => goto(page, `/app/reports/${code}`, 5000));
    record[`control_${code}`] = { ...c.out, runs: c.runs };
    check(`${code} → real title, a date form, a 200 run, no alert`,
      c.out.h1.join("|") === title && c.out.dateInputs === 2 && c.runs.some((x) => x.startsWith("200")) && c.out.alerts.length === 0,
      `h1=${c.out.h1.join("|")} dates=${c.out.dateInputs} runs=${JSON.stringify(c.runs)} alerts=${c.out.alerts.length} rows=${c.out.rows}`);
    if (minRows > 0) check(`${code} has ${minRows}+ rows`, c.out.rows >= minRows, c.out.rows);
  }
  await page.screenshot({ path: `${OUT}/f1-sales-by-day.png` });

  // no horizontal overflow on the not-found state at mobile
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // reuse the logged-in storage state
  const state = await page.context().storageState();
  await ctxM.close();
  const ctxM2 = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: state });
  const pm = await ctxM2.newPage();
  await pm.goto(`${BASE}/app/reports/definitely-not-a-report`, { waitUntil: "domcontentloaded" });
  await pm.waitForTimeout(4500);
  const mob = await pm.evaluate(scrape);
  record.mobile = mob;
  await pm.screenshot({ path: `${OUT}/f2-not-found-390.png` });
  check("390px: not-found renders, no horizontal overflow", mob.notFound && mob.scrollW <= mob.innerW, `notFound=${mob.notFound} scrollW=${mob.scrollW} innerW=${mob.innerW}`);
  await ctxM2.close();
} catch (e) {
  console.error("HARNESS ERROR", e);
  check("harness ran to completion", false, String(e).slice(0, 300));
} finally {
  writeFileSync(`${OUT}/reopen-indep.json`, JSON.stringify({ pass, fail, results, record }, null, 2));
  console.log(`\n──────── ${pass} PASS / ${fail} FAIL ────────`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}
