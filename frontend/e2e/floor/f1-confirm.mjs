/*
 * F1 CONFIRM — two loose ends from the proof run.
 *
 *  a. dark theme: the shortage must still be the DESTRUCTIVE token, not merely "some red".
 *  b. the manager's Till Review row must be provably THE session the cashier just closed —
 *     open Details and match the session id and the cashier's own note.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log, money } from "../shift/lib.mjs";

const OUT = "../.planning/audits/floor/F1";
const TILL_ID = process.argv[2];
if (!TILL_ID) throw new Error("usage: node e2e/floor/f1-confirm.mjs <tillId>");

const browser = await newBrowser();

// ── a. dark-theme tone, measured against the token, on a live open till ───────
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier); // the shared cashier still holds an OPEN till
await go(cash, "/app/pos", { waitMs: 8000 });
await cash.emulateMedia({ colorScheme: "dark" });
await cash.waitForTimeout(800);
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
const expected = await cash.evaluate(
  () => document.querySelector("[data-testid=close-till-expected]")?.innerText.trim() ?? null,
);
log("  dark close panel, expected cash:", expected);
const input = cash.locator("[data-testid=close-till-panel] input[type=number]").first();

const measure = () =>
  cash.evaluate(() => {
    const v = document.querySelector("[data-testid=close-till-variance]");
    if (!v) return null;
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const tone = (c) => {
      probe.className = c;
      return getComputedStyle(probe).color;
    };
    const out = {
      text: v.innerText.replace(/\s+/g, " ").trim(),
      color: getComputedStyle(v).color,
      destructive: tone("text-destructive"),
      success: tone("text-success"),
      warning: tone("text-warning"),
    };
    probe.remove();
    out.isDestructive = out.color === out.destructive;
    out.isWarning = out.color === out.warning;
    out.isSuccess = out.color === out.success;
    return out;
  });

const expPaisa = Number(/([\d,]+)\.(\d\d)/.exec(expected)?.[0]?.replace(/,/g, "") ?? 0) * 100;
await input.fill(((expPaisa - 20000) / 100).toFixed(2));
await cash.waitForTimeout(1200);
const short = await measure();
log("  DARK · Rs 200 short →", JSON.stringify(short));
await cash.screenshot({ path: `${OUT}/23-dark-short.png` });

await input.fill(((expPaisa + 15000) / 100).toFixed(2));
await cash.waitForTimeout(1200);
const over = await measure();
log("  DARK · Rs 150 over  →", JSON.stringify(over));
await cash.screenshot({ path: `${OUT}/24-dark-over.png` });

await input.fill((expPaisa / 100).toFixed(2));
await cash.waitForTimeout(1200);
const balanced = await measure();
log("  DARK · balanced     →", JSON.stringify(balanced));
await cash.screenshot({ path: `${OUT}/25-dark-balanced.png` });

await input.fill("-40");
await cash.waitForTimeout(1000);
const negative = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=close-till-declared-error]")?.innerText.trim() ?? null,
  confirmDisabled: document.querySelector("[data-testid=close-till-confirm-button]")?.disabled ?? null,
  variancePresent: !!document.querySelector("[data-testid=close-till-variance]"),
}));
log("  DARK · negative count →", JSON.stringify(negative));
await cash.screenshot({ path: `${OUT}/26-dark-negative.png` });

// ── b. the manager's row is provably the closed session ──────────────────────
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mtok = await tokenOf(mgr);
const api = await apiGet(mgr, `/api/v1/pos/tills/${TILL_ID}`, mtok);
const t = api.body?.data ?? api.body;
log("\n  server row for the closed session:", JSON.stringify({
  id: t.id, status: t.status,
  expected: money(t.expectedClosingPaisa), declared: money(t.declaredClosingPaisa),
  variance: money(t.variancePaisa), note: t.note,
}));

await go(mgr, "/app/pos/tills", { waitMs: 7000 });
const rows = await mgr.evaluate(() =>
  Array.from(document.querySelectorAll("tbody tr")).slice(0, 4).map((r, i) => ({
    i, text: r.innerText.replace(/\s+/g, " ").trim(),
    detailsBtn: !!Array.from(r.querySelectorAll("button")).find((b) => /details/i.test(b.textContent)),
  })),
);
log("  top rows:", JSON.stringify(rows, null, 1));

// Open Details on the newest row and read the reconciliation drill-down.
const first = mgr.locator("tbody tr").first();
await first.getByRole("button", { name: /details/i }).click();
await mgr.waitForTimeout(4000);
const detail = await mgr.evaluate(() => {
  const body = document.body.innerText.replace(/\s+/g, " ");
  return { snippet: body.slice(body.indexOf("Expected cash") - 260, body.indexOf("Expected cash") + 320) };
});
log("  detail drill-down:", detail.snippet);
await mgr.screenshot({ path: `${OUT}/27-manager-details.png`, fullPage: false });

await browser.close();
