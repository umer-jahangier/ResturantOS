/*
 * F9 RE-OPEN, part 2 — the adjacent paths and the wrong personas.
 *
 *  A. cashier@terrace.local on the same URL — did anything get widened?
 *  B. accountant@control.local (the other tenant) — can they see Floating Terrace's entry?
 *  C. the calendar's own navigation: chevrons, a date in a DIFFERENT month, and the LOCKED
 *     July 2026 period the claimant self-reported as a hole.
 *  D. the fallback SENTENCE, independently: server answers with FY2026 open periods only.
 *  E. the empty and the errored open-periods reads.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, log, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F9-reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const browser = await newBrowser();

const CONTROL_ACCOUNTANT = {
  slug: "control-bistro-isolation-test-tenant",
  email: "accountant@control.local",
  password: "Control#Accountant1",
  totpSecret: "EJBVEEJHZ5EISVP64TLCT54G52PKWWV2",
};

// ── A. the cashier ───────────────────────────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await login(page, PEOPLE.cashier);
  const t = await go(page, "/app/finance/journal-entries/new", { waitMs: 5000, allowTrouble: true });
  R.cashier = {
    trouble: t,
    text: await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 350)),
    hasMoneyInputs: await page.locator('input[inputmode="decimal"]').count(),
    api: (await apiGet(page, "/api/v1/finance/periods/open")).status,
  };
  // and can a cashier POST a journal entry straight at the API?
  const tok = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  R.cashier.postJe = await page.evaluate(async (t) => {
    const r = await fetch("http://localhost:8080/api/v1/finance/journal-entries", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), Authorization: `Bearer ${t}` },
      body: JSON.stringify({ entryDate: "2026-08-12", description: "cashier probe", lines: [] }),
    });
    return r.status;
  }, tok);
  await page.screenshot({ path: `${OUT}/10-cashier.png` });
  log("\n  A. cashier:", JSON.stringify(R.cashier, null, 1));
  await page.context().close();
}

// ── B. the other tenant ──────────────────────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  try {
    await login(page, CONTROL_ACCOUNTANT);
    const t = await go(page, "/app/finance/journal-entries", { waitMs: 5000, allowTrouble: true });
    R.control = {
      trouble: t,
      seesTerraceEntry: await page.evaluate(() => /F9 REOPEN|F9 rupee-entry proof/.test(document.body.innerText)),
      rows: await page.evaluate(() =>
        Array.from(document.querySelectorAll("tr")).map((r) => r.innerText.replace(/\s+/g, " ").trim()).slice(0, 4),
      ),
      openPeriods: (await apiGet(page, "/api/v1/finance/periods/open")).body?.data?.length ?? null,
    };
    // direct read of the Floating Terrace entry id, with the control tenant's own bearer
    const id = process.env.F9_JE_ID;
    if (id) R.control.directRead = (await apiGet(page, `/api/v1/finance/journal-entries/${id}`)).status;
    await page.screenshot({ path: `${OUT}/11-control-tenant.png` });
  } catch (e) {
    R.control = { error: String(e).slice(0, 300) };
  }
  log("\n  B. control tenant:", JSON.stringify(R.control, null, 1));
  await page.context().close();
}

// ── C/D/E as the accountant ──────────────────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await login(page, PEOPLE.accountant);

  // C. calendar navigation and the LOCKED July 2026 month
  await go(page, "/app/finance/journal-entries/new", { waitMs: 6000 });
  const monthLabel = () =>
    page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, " ");
      return (t.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/) ?? [null])[0];
    });
  R.nav = { start: await monthLabel() };
  await page.getByLabel("Previous month").click();
  await page.waitForTimeout(700);
  R.nav.afterPrev = await monthLabel();
  R.nav.julyDisabled = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter((b) => /^\d{1,2}$/.test(b.textContent.trim()));
    return { total: btns.length, disabled: btns.filter((b) => b.disabled).length };
  });
  await page.screenshot({ path: `${OUT}/12-july-locked.png` });
  await page.getByLabel("Next month").click();
  await page.waitForTimeout(500);
  await page.getByLabel("Next month").click();
  await page.waitForTimeout(700);
  R.nav.afterTwoNext = await monthLabel();
  // pick the 3rd of September and check the picked date sticks and the month does not snap back
  const sep3 = page.getByRole("button", { name: "3 Sep 2026" }).first();
  R.nav.sep3Present = (await sep3.count()) > 0;
  if (R.nav.sep3Present) {
    await sep3.click();
    await page.waitForTimeout(700);
    R.nav.afterPickingSep3 = {
      month: await monthLabel(),
      selected: await page.evaluate(() => {
        const t = document.body.innerText.replace(/\s+/g, " ");
        return (t.match(/Selected: [^]{0,20}?\d{4}/) ?? [null])[0];
      }),
    };
  }
  await page.screenshot({ path: `${OUT}/13-picked-other-month.png` });
  log("\n  C. calendar navigation:", JSON.stringify(R.nav, null, 1));

  // D. the fallback sentence — server answers FY2026 open periods only
  await page.route("**/api/v1/finance/periods/open", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    const only2026 = (json.data ?? []).filter((p) => p.fiscalYear === 2026);
    await route.fulfill({ response: res, body: JSON.stringify({ ...json, data: only2026 }), headers: { ...res.headers(), "content-type": "application/json" } });
  });
  await go(page, "/app/finance/journal-entries/new", { waitMs: 6000 });
  R.fallback = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const n = document.querySelector('[data-testid="entry-date-notice"]');
    return {
      notice: n ? n.innerText.replace(/\s+/g, " ").trim() : null,
      month: (t.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/) ?? [null])[0],
      selected: (t.match(/Selected: [^]{0,20}?\d{4}/) ?? [null])[0],
      pressed: Array.from(document.querySelectorAll('[aria-pressed="true"]')).map((b) => b.textContent.trim()),
    };
  });
  await page.screenshot({ path: `${OUT}/14-fallback-sentence.png` });
  log("\n  D. fallback:", JSON.stringify(R.fallback, null, 1));
  await page.unroute("**/api/v1/finance/periods/open");

  // E1. empty open-periods
  await page.route("**/api/v1/finance/periods/open", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, body: JSON.stringify({ ...json, data: [] }), headers: { ...res.headers(), "content-type": "application/json" } });
  });
  await go(page, "/app/finance/journal-entries/new", { waitMs: 6000, allowTrouble: true });
  R.empty = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const n = document.querySelector('[data-testid="entry-date-notice"]');
    return {
      notice: n ? n.innerText.replace(/\s+/g, " ").trim() : null,
      saysNoPeriod: /No accounting period is open/.test(t),
      saysSeedCoa: /Seed COA/i.test(t),
      blocked: document.querySelector('[data-testid="submit-blocked-reason"]')?.textContent.trim() ?? null,
      saveDisabled: document.querySelector('button[type="submit"]')?.disabled ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}/15-no-open-periods.png` });
  log("\n  E1. empty:", JSON.stringify(R.empty, null, 1));
  await page.unroute("**/api/v1/finance/periods/open");

  // E2. an outage on open-periods
  await page.route("**/api/v1/finance/periods/open", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "down" } }) }),
  );
  await go(page, "/app/finance/journal-entries/new", { waitMs: 8000, allowTrouble: true });
  R.outage = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    return {
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 160)),
      saysSeedCoa: /Seed COA/i.test(t),
      saysNoPeriod: /No accounting period is open/.test(t),
      notice: document.querySelector('[data-testid="entry-date-notice"]')?.textContent.trim() ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}/16-outage.png` });
  log("\n  E2. outage:", JSON.stringify(R.outage, null, 1));

  await page.context().close();
}

writeFileSync(`${OUT}/_reopen2.json`, JSON.stringify(R, null, 2));
log("\n  wrote", `${OUT}/_reopen2.json`);
await browser.close();
