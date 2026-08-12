/*
 * F9 RE-OPEN, part 3 — two answers the last run left ambiguous.
 *   1. the cashier's POST came back 400 (my payload was invalid), which hides whether the
 *      permission would have refused it. Re-ask with a payload that IS valid.
 *   2. the "no open periods at all" screen printed nothing at all — look at it properly.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F9-reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const browser = await newBrowser();

const validJe = (branchId) => ({
  entryDate: "2026-08-12",
  description: "F9 wrong-persona probe — should be refused",
  branchId,
  lines: [
    { accountCode: "1010", description: "", debitPaisa: 100, creditPaisa: 0 },
    { accountCode: "3100", description: "", debitPaisa: 0, creditPaisa: 100 },
  ],
});

async function bearer(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}

async function probePost(page, payload) {
  const tok = await bearer(page);
  return page.evaluate(
    async ({ t, b }) => {
      const r = await fetch("http://localhost:8080/api/v1/finance/journal-entries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), Authorization: `Bearer ${t}` },
        body: JSON.stringify(b),
      });
      let j = null;
      try { j = await r.json(); } catch {}
      return { status: r.status, code: j?.error?.code ?? j?.code ?? null, msg: (j?.error?.message ?? j?.message ?? "").slice(0, 160) };
    },
    { t: tok, b: payload },
  );
}

// the branch id the accountant's own session uses
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

for (const [name, who] of [["cashier", PEOPLE.cashier], ["waiter", { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" }], ["kitchen", PEOPLE.kitchen]]) {
  const page = await newPage(browser);
  try {
    await login(page, who);
    R[name] = await probePost(page, validJe(BRANCH));
    log(`  ${name} POST /finance/journal-entries →`, JSON.stringify(R[name]));
  } catch (e) {
    R[name] = { error: String(e).slice(0, 200) };
  }
  await page.context().close();
}

// 2. the no-open-periods screen, looked at properly
{
  const page = await newPage(browser);
  await login(page, PEOPLE.accountant);
  await page.route("**/api/v1/finance/periods/open", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
  await go(page, "/app/finance/journal-entries/new", { waitMs: 8000, allowTrouble: true });
  R.noPeriods = await page.evaluate(() => ({
    fullText: document.body.innerText.replace(/\s+/g, " ").slice(0, 1200),
    notice: document.querySelector('[data-testid="entry-date-notice"]')?.textContent.trim() ?? null,
    blocked: document.querySelector('[data-testid="submit-blocked-reason"]')?.textContent.trim() ?? null,
    saveDisabled: document.querySelector('button[type="submit"]')?.disabled ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 120)),
    statuses: Array.from(document.querySelectorAll('[role="status"]')).map((n) => n.getAttribute("aria-label")),
  }));
  log("\n  no-open-periods screen:", JSON.stringify(R.noPeriods, null, 1));
  await page.screenshot({ path: `${OUT}/17-no-periods-detail.png` });
  await page.context().close();
}

writeFileSync(`${OUT}/_reopen3.json`, JSON.stringify(R, null, 2));
log("\n  wrote _reopen3.json");
await browser.close();
