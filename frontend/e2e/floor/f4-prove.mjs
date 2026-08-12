/*
 * F4 — PROOF. Can a person in the building read the audit log?
 *
 * Every step below is a click, in real Chromium, as the persona whose job it is. No token is
 * injected and no URL is typed where the DONE MEANS says a person must find the screen.
 *
 *   1. OWNER signs in (TOTP) and finds "Audit log" IN THE SIDEBAR, and clicks it.
 *   2. In a second browser context, the MANAGER rings a takeaway check and VOIDS it with a reason.
 *   3. Back in the owner's tab, that ORDER_VOIDED appears with the actor's NAME, the reason, and a
 *      timestamp in Asia/Karachi (checked against the same instant rendered in UTC).
 *   4. Filter by action, and by resource type — every returned row is checked against the filter.
 *   5. Page past the first page; the total is read off the screen.
 *   6. A backwards date range is refused at the UI, naming both fields.
 *   7. The CASHIER is refused by name, and has no such nav entry.
 *   8. 390 / 768 / 1440, light and dark.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PEOPLE, totpNow, log } from "../shift/lib.mjs";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F4");
mkdirSync(OUT, { recursive: true });

const findings = {};
const record = (k, v) => {
  findings[k] = v;
  log(`  · ${k}:`, typeof v === "string" ? v : JSON.stringify(v));
};

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

async function newCtx({ width = 1440, height = 950, colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme });
  const page = await ctx.newPage();
  // The dev server compiles a route on first request; ten agents share this machine and a cold
  // compile of a brand-new route routinely exceeds Playwright's 30s default.
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(60_000);
  page.__errors = [];
  page.on("console", (m) => m.type() === "error" && page.__errors.push(m.text().slice(0, 200)));
  return page;
}

async function signIn(page, who, attempt = 0) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.password ? who.email : who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3200);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  // Poll rather than assume a fixed delay: auth-service is one of sixteen JVMs on this machine and
  // a 3-second wait is a test that fails when the box is busy, which is not information.
  for (let i = 0; i < 20 && page.url().includes("/login"); i++) await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    const why = await page.evaluate(() => ({
      url: location.href,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
      body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
    }));
    // Ten agents share this stack. A login writes lastLoginAt, and two concurrent logins for the
    // same account collide on the optimistic lock; the gateway also restarts under us. Both are
    // transient and neither is this item, so retry twice before calling it a failure.
    if (attempt < 3) {
      log(`  login for ${who.email} refused (${why.alerts.join(" ")}) — retrying`);
      await page.waitForTimeout(8000);
      return signIn(page, who, attempt + 1);
    }
    throw new Error(`login failed for ${who.email}: ${JSON.stringify(why)}`);
  }
  log(`  ✓ signed in as ${who.email}`);
}

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
};

/** Never score a screen while it is failing. */
async function trouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const bad = [];
    if (/Couldn.t load|Something went wrong|is unavailable right now/i.test(t)) bad.push("load-failure");
    if (/Access denied|You cannot read/i.test(t)) bad.push("access-denied");
    if (/This page doesn.t exist/i.test(t)) bad.push("404");
    return { bad, alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)) };
  });
}

// ═══ 1. OWNER: find it in the sidebar and click it ══════════════════════════
log("\n=== 1. the OWNER finds Audit log in the sidebar ===");
const owner = await newCtx();
await signIn(owner, PEOPLE.owner);
await owner.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await owner.waitForTimeout(5000);

const navMatches = await owner.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a"))
    .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
    .filter((n) => /audit|log|activity|history|security/i.test(`${n.t} ${n.h}`)),
);
record("sidebarEntriesMatchingAudit", navMatches);
await shot(owner, "01-owner-sidebar");

const auditLink = owner.getByRole("link", { name: /audit log/i });
if ((await auditLink.count()) === 0) throw new Error("no Audit log entry in the sidebar — nothing to click");
await auditLink.first().scrollIntoViewIfNeeded();
await Promise.all([
  owner.waitForURL(/\/app\/settings\/audit/, { timeout: 120_000 }),
  auditLink.first().click(),
]);
await owner.waitForTimeout(9000);
record("urlAfterClickingTheNavEntry", owner.url());
let t = await trouble(owner);
if (t.bad.length) {
  log("  ! screen showed", t.bad.join(","), "— retrying once");
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(6000);
  t = await trouble(owner);
}
record("auditScreenTrouble", t);
await shot(owner, "02-owner-audit-log");

const head = await owner.evaluate(() => ({
  h1: document.querySelector("h1")?.textContent?.trim() ?? null,
  zoneNote: document.querySelector("[data-testid=audit-zone-note]")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
  summary: document.querySelector("[data-testid=audit-page-summary]")?.textContent?.trim() ?? null,
  rows: document.querySelectorAll('table[aria-label="Audit log"] tbody tr').length,
  headers: Array.from(document.querySelectorAll('table[aria-label="Audit log"] thead th')).map((n) => n.textContent.trim()),
}));
record("auditScreenHeader", head);

// ═══ 2. MANAGER: ring a check and void it, in another tab ═══════════════════
//
// pos-service is rebuilt and restarted by other agents on this machine several times an hour, and
// a half-started service makes this step fail for reasons that have nothing to do with the audit
// log. The whole ring-and-void is therefore retried as a unit, and the attempt count is recorded
// so a reader can tell "it worked" from "it worked eventually".
log("\n=== 2. the MANAGER rings a takeaway check and voids it ===");
const mgr = await newCtx();
await signIn(mgr, PEOPLE.manager);
// The manager holds no audit.log.view, so this sidebar must NOT offer the screen.
await mgr.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await mgr.waitForTimeout(5000);
record("managerSidebarAuditEntries", await mgr.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a"))
    .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
    .filter((n) => /audit/i.test(`${n.t} ${n.h}`))));

const VOID_REASON = `F4 proof — audit log readability check ${new Date().toISOString().slice(11, 19)}`;

async function ringAndVoid() {
  await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(9000);
  if (await mgr.locator("[data-testid=query-service-outage]").count()) throw new Error("pos-service outage on the terminal");
  await mgr.locator("[data-testid=order-type-takeaway]").click({ timeout: 20000 });
  await mgr.waitForTimeout(800);
  const tiles = mgr.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(2).click();
  await mgr.waitForTimeout(900);
  await mgr.locator("[data-testid=send-to-kitchen-button]").click({ timeout: 20000 });
  await mgr.waitForTimeout(8000);
  const fired = await mgr.evaluate(() =>
    Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))));
  if (!fired.length) throw new Error("no order number after Send to Kitchen");
  const no = fired[0];
  await shot(mgr, "03-manager-order-fired");

  await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(7000);
  await mgr.getByText("Order Management", { exact: true }).click();
  await mgr.waitForTimeout(4500);
  if (await mgr.locator("[data-testid=query-service-outage]").count()) throw new Error("pos-service outage on Order Management");
  await mgr.locator("[data-testid=order-management-search]").first().fill(no);
  await mgr.waitForTimeout(6000);
  await mgr.locator('[data-testid^="open-order-"]').first().click({ timeout: 25000 });
  await mgr.waitForTimeout(3500);
  await mgr.getByLabel("Void order").first().click({ timeout: 20000 });
  await mgr.waitForTimeout(1800);
  const ta = mgr.locator("[data-testid=void-refund-panel] textarea");
  if (await ta.count()) await ta.first().fill(VOID_REASON);
  else await mgr.locator("[data-testid=void-refund-panel] input").first().fill(VOID_REASON);
  await mgr.waitForTimeout(400);
  await shot(mgr, "04-manager-void-reason");
  await mgr.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void|Void Order|Void/i }).last().click();
  await mgr.waitForTimeout(6500);
  const outcome = await mgr.evaluate(() => ({
    err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
  }));
  if (outcome.err) throw new Error(`void refused: ${outcome.err}`);
  await shot(mgr, "05-manager-after-void");
  return { no, outcome };
}

let voided = null;
let voidAttempts = 0;
for (; voidAttempts < 6 && !voided; voidAttempts++) {
  try {
    voided = await ringAndVoid();
  } catch (e) {
    log(`  ring-and-void attempt ${voidAttempts + 1} failed: ${e.message} — waiting for the service`);
    await mgr.waitForTimeout(30000);
  }
}
if (!voided) throw new Error("could not ring and void an order in six attempts");
record("orderRungAndVoidedByTheManager", { ...voided, attempts: voidAttempts, reason: VOID_REASON });

// The audit row is written from a queued event — give the outbox relay and the consumer a moment.
log("  waiting for the audit consumer to ingest the void…");
await owner.waitForTimeout(6000);

// ═══ 3. OWNER: the void is on the screen, with a name, a reason and a local time ═══
log("\n=== 3. the void, on the audit screen ===");
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(6000);
await owner.selectOption("[data-testid=audit-filter-action]", "ORDER_VOIDED");
await owner.waitForTimeout(4500);
await shot(owner, "06-owner-filtered-order-voided");

const voidRow = await owner.evaluate((reason) => {
  const rows = Array.from(document.querySelectorAll('table[aria-label="Audit log"] tbody tr'));
  const row = rows.find((r) => r.innerText.includes(reason));
  if (!row) {
    return { found: false, sample: rows.slice(0, 3).map((r) => r.innerText.replace(/\s+/g, " ").slice(0, 200)) };
  }
  const when = row.querySelector('[data-testid^="audit-when-"]');
  return {
    found: true,
    cells: Array.from(row.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()),
    when: when?.textContent?.trim() ?? null,
    detailTestId: row.querySelector('[data-testid^="audit-detail-"]')?.getAttribute("data-testid") ?? null,
  };
}, VOID_REASON);
record("theVoidOnScreen", voidRow);

// Open its detail and read the recorded payload back.
if (voidRow.detailTestId) {
  await owner.locator(`[data-testid="${voidRow.detailTestId}"]`).click();
  await owner.waitForTimeout(1500);
  await shot(owner, "07-owner-void-detail");
  const panel = await owner.evaluate(() => {
    const p = document.querySelector("[data-testid=audit-detail-panel]");
    return p ? p.innerText.replace(/\s+/g, " ").trim().slice(0, 600) : null;
  });
  record("voidDetailPanel", panel);
  await owner.locator(`[data-testid="${voidRow.detailTestId}"]`).click();
  await owner.waitForTimeout(800);
}

// Is the timestamp the BRANCH's? Compare the rendered string against the same instant in UTC,
// read from the API on the owner's own bearer.
const zoneCheck = await owner.evaluate(async (reason) => {
  const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const j = await r.json();
  const tok = j?.accessToken ?? j?.data?.accessToken;
  const res = await fetch("http://localhost:8080/api/v1/audit/events?action=ORDER_VOIDED&size=5", {
    headers: { Authorization: `Bearer ${tok}` },
  });
  const body = await res.json();
  const row = (body.data ?? []).find((e) => (e.afterState ?? "").includes(reason)) ?? body.data?.[0];
  const rendered = Array.from(document.querySelectorAll('table[aria-label="Audit log"] tbody tr'))
    .find((tr) => tr.innerText.includes(reason))
    ?.querySelector('[data-testid^="audit-when-"]')?.textContent?.trim() ?? null;
  // The branch's OWN stored zone, read at this moment — another agent edits branch settings on
  // this machine, and hardcoding "Asia/Karachi" would make this assertion measure the fixture
  // rather than the behaviour. The invariant is "the rendered time is the BRANCH's local time,
  // and not the browser's" — which holds whatever the branch is set to.
  const branchRes = await fetch("http://localhost:8080/api/v1/branches", { headers: { Authorization: `Bearer ${tok}` } });
  const branches = (await branchRes.json())?.data ?? [];
  const claims = JSON.parse(atob(tok.split(".")[1]));
  const branch = branches.find((b) => b.id === claims.branch_id) ?? branches[0];
  const at = row ? new Date(row.occurredAt) : null;
  const hhmmIn = (tz) => at ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(at) : null;
  return {
    storedUtc: row?.occurredAt ?? null,
    branchName: branch?.name ?? null,
    branchZone: branch?.timezone ?? null,
    browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcHhmmss: hhmmIn("UTC"),
    branchHhmmss: branch?.timezone ? hhmmIn(branch.timezone) : null,
    browserHhmmss: hhmmIn(Intl.DateTimeFormat().resolvedOptions().timeZone),
    rendered,
    actorNameFromApi: row?.userName ?? null,
  };
}, VOID_REASON);
record("timestampZoneCheck", zoneCheck);

// ── 3b. the same instant, in a browser that is NOT in the branch's zone ──────
//
// The check above is only decisive when the browser and the branch disagree, and on this machine
// they usually agree — which is exactly how a screen that quietly renders the VIEWER's zone passes
// a screenshot review. So one context is given a different clock (Playwright sets the browser's
// IANA zone) and the same row is read again. If the screen used the browser, this would move.
{
  const ny = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    timezoneId: "America/New_York",
  });
  const nyPage = await ny.newPage();
  nyPage.setDefaultNavigationTimeout(120_000);
  nyPage.setDefaultTimeout(60_000);
  await signIn(nyPage, PEOPLE.owner);
  await nyPage.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
  await nyPage.waitForTimeout(9000);
  await nyPage.selectOption("[data-testid=audit-filter-action]", "ORDER_VOIDED");
  await nyPage.waitForTimeout(4500);
  const nyRead = await nyPage.evaluate((reason) => {
    const row = Array.from(document.querySelectorAll('table[aria-label="Audit log"] tbody tr'))
      .find((tr) => tr.innerText.includes(reason));
    return {
      browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      zoneNote: document.querySelector("[data-testid=audit-zone-note]")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      rendered: row?.querySelector('[data-testid^="audit-when-"]')?.textContent?.trim() ?? null,
    };
  }, VOID_REASON);
  record("sameRowReadFromANewYorkBrowser", nyRead);
  await nyPage.screenshot({ path: `${OUT}/07b-newyork-browser-same-row.png` });
  await ny.close();
}

// ═══ 4. the filters actually filter ═════════════════════════════════════════
log("\n=== 4. filter by action, and by resource type ===");
const actionFilterRows = await owner.evaluate(() =>
  Array.from(document.querySelectorAll('table[aria-label="Audit log"] tbody tr')).map((r) => ({
    event: r.querySelectorAll("td")[1]?.innerText.replace(/\s+/g, " ").trim(),
    what: r.querySelectorAll("td")[3]?.innerText.replace(/\s+/g, " ").trim(),
  })),
);
record("rowsUnderActionFilterORDER_VOIDED", {
  count: actionFilterRows.length,
  allOrderVoided: actionFilterRows.every((r) => (r.event ?? "").includes("ORDER_VOIDED")),
  distinctEvents: [...new Set(actionFilterRows.map((r) => (r.event ?? "").split("\n")[0]))],
});

await owner.selectOption("[data-testid=audit-filter-action]", "");
await owner.waitForTimeout(3000);
await owner.selectOption("[data-testid=audit-filter-resource]", "ORDER");
await owner.waitForTimeout(4500);
await shot(owner, "08-owner-filtered-resource-order");
const resourceRows = await owner.evaluate(() =>
  Array.from(document.querySelectorAll('table[aria-label="Audit log"] tbody tr')).map((r) => ({
    event: r.querySelectorAll("td")[1]?.innerText.split("\n").pop().trim(),
    what: r.querySelectorAll("td")[3]?.innerText.split("\n")[0].trim(),
  })),
);
record("rowsUnderResourceTypeORDER", {
  count: resourceRows.length,
  allORDER: resourceRows.every((r) => r.what === "ORDER"),
  anyUserLogin: resourceRows.some((r) => (r.event ?? "").startsWith("USER_LOGIN")),
  distinctWhat: [...new Set(resourceRows.map((r) => r.what))],
  distinctEvents: [...new Set(resourceRows.map((r) => r.event))],
});
record("summaryUnderResourceTypeORDER", await owner.evaluate(() => document.querySelector("[data-testid=audit-page-summary]")?.textContent?.trim()));

// ═══ 5. page past the first page, with the total stated ═════════════════════
log("\n=== 5. page 2, and the total ===");
await owner.selectOption("[data-testid=audit-filter-resource]", "");
await owner.waitForTimeout(4000);
const beforePaging = await owner.evaluate(() => ({
  summary: document.querySelector("[data-testid=audit-page-summary]")?.textContent?.trim(),
  page: document.querySelector("[data-testid=audit-page-number]")?.textContent?.trim(),
  firstRowWhen: document.querySelector('[data-testid^="audit-when-"]')?.textContent?.trim(),
  prevDisabled: document.querySelector("[data-testid=audit-prev-page]")?.disabled,
}));
record("page1", beforePaging);
await owner.locator("[data-testid=audit-next-page]").click();
await owner.waitForTimeout(4500);
const afterPaging = await owner.evaluate(() => ({
  summary: document.querySelector("[data-testid=audit-page-summary]")?.textContent?.trim(),
  page: document.querySelector("[data-testid=audit-page-number]")?.textContent?.trim(),
  firstRowWhen: document.querySelector('[data-testid^="audit-when-"]')?.textContent?.trim(),
  prevDisabled: document.querySelector("[data-testid=audit-prev-page]")?.disabled,
}));
record("page2", afterPaging);
record("page2ShowsDifferentRows", beforePaging.firstRowWhen !== afterPaging.firstRowWhen);
await shot(owner, "09-owner-page-2");

// ═══ 6. a backwards range is refused at the UI ══════════════════════════════
log("\n=== 6. From after To ===");
await owner.fill("[data-testid=audit-filter-from]", "2026-08-12");
await owner.waitForTimeout(2500);
await owner.fill("[data-testid=audit-filter-to]", "2026-08-01");
await owner.waitForTimeout(2000);
const rangeError = await owner.evaluate(() => {
  const e = document.querySelector("[data-testid=audit-range-error]");
  return {
    text: e?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    role: e?.getAttribute("role") ?? null,
    fromInvalid: document.querySelector("[data-testid=audit-filter-from]")?.getAttribute("aria-invalid"),
    toInvalid: document.querySelector("[data-testid=audit-filter-to]")?.getAttribute("aria-invalid"),
    stillHasRows: document.querySelectorAll('table[aria-label="Audit log"] tbody tr').length,
  };
});
record("backwardsRange", rangeError);
await shot(owner, "10-owner-backwards-range");
await owner.locator("[data-testid=audit-clear-filters]").click();
await owner.waitForTimeout(3500);

// ═══ 7. the CASHIER is refused, by name ═════════════════════════════════════
log("\n=== 7. the cashier ===");
const cashier = await newCtx();
await signIn(cashier, PEOPLE.cashier);
await cashier.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await cashier.waitForTimeout(5000);
const cashierNav = await cashier.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a"))
    .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
    .filter((n) => /audit/i.test(`${n.t} ${n.h}`)),
);
record("cashierSidebarAuditEntries", cashierNav);
await cashier.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await cashier.waitForTimeout(5000);
await shot(cashier, "11-cashier-refused");
const refusal = await cashier.evaluate(() => ({
  heading: document.querySelector("h1")?.textContent?.trim() ?? null,
  body: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600),
  namesThePermission: (document.body.innerText || "").includes("audit.log.view"),
  tables: document.querySelectorAll('table[aria-label="Audit log"]').length,
  anyEventRows: document.querySelectorAll('[data-testid^="audit-when-"]').length,
  saysEmpty: /Nothing has been recorded|No events|0 events/i.test(document.body.innerText || ""),
}));
record("cashierRefusal", refusal);

// ═══ 8. responsive + themes ═════════════════════════════════════════════════
log("\n=== 8. 390 / 768 / 1440, light and dark ===");
for (const [w, h, label] of [[390, 844, "390"], [768, 1024, "768"], [1440, 950, "1440"]]) {
  for (const scheme of ["light", "dark"]) {
    const p = await newCtx({ width: w, height: h, colorScheme: scheme });
    let ok = false;
    for (let a = 0; a < 4 && !ok; a++) {
      try {
        await signIn(p, PEOPLE.owner);
        await p.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
        await p.waitForTimeout(7000);
        ok = (await p.locator("[data-testid=audit-zone-note]").count()) > 0;
      } catch (e) {
        log(`  ${label}/${scheme} attempt ${a + 1}: ${e.message.slice(0, 90)} — waiting`);
      }
      if (!ok) await p.waitForTimeout(20000);
    }
    if (!ok) throw new Error(`could not load the audit screen at ${label}/${scheme}`);
    const geom = await p.evaluate(() => ({
      bodyScrollW: document.body.scrollWidth,
      viewportW: window.innerWidth,
      tablesVisible: Array.from(document.querySelectorAll('table[aria-label="Audit log"]')).filter(
        (t) => t.closest("div")?.offsetParent !== null,
      ).length,
      cardList: document.querySelectorAll("[data-testid=data-grid-cards] li").length,
      rows: document.querySelectorAll('[data-testid^="audit-when-"]').length,
      bg: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.body).color,
    }));
    record(`layout-${label}-${scheme}`, geom);
    await p.screenshot({ path: `${OUT}/12-${label}-${scheme}.png`, fullPage: false });
    await p.context().close();
  }
}

record("ownerConsoleErrors", owner.__errors.slice(0, 8));
writeFileSync(`${OUT}/_proof.json`, JSON.stringify(findings, null, 2));
await browser.close();
log("\nproof done →", `${OUT}/_proof.json`);
