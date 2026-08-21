/*
 * RE-OPEN B1 / S0-C — part 3: the row that was ALREADY WRITTEN.
 *
 * The DONE MEANS ends: "re-check an already-written row: the walkthrough's own JE-2027-000254 ...
 * reads the corrected date after the backfill, and its order still appears exactly once across the
 * two adjacent Takings days."
 *
 * ORD-20260812-0164 closed 2026-08-12T03:15:24Z = 08:15 Asia/Karachi, inside the window where the
 * old UTC cut and the branch cut name different days. Its money is now on the 2026-08-12 Takings
 * page (proved in part 1). This script asks the LEDGER screens what day they think it is.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1-reopen";
mkdirSync(OUT, { recursive: true });
const J = {};
const rec = (k, v) => {
  J[k] = v;
  console.log(`  ${k}: ${JSON.stringify(v)?.slice(0, 1400)}`);
  writeFileSync(`${OUT}/legacy-row.json`, JSON.stringify(J, null, 2));
};
const shot = async (pg, n) => {
  await pg.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};
const rows = (pg, n = 40) =>
  pg.evaluate(
    (k) =>
      (document.querySelector("main")?.innerText ?? document.body.innerText)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, k),
    n,
  );

const browser = await newBrowser();
const a = await newPage(browser);
await login(a, PEOPLE.accountant);
const tok = await tokenOf(a);

// ── 1. journal entries, by entry number ─────────────────────────────────────
rec("journalTrouble", await go(a, "/app/finance/journal-entries", { waitMs: 11000 }));
let s = a.locator('input[type="search"], input[placeholder*="earch"]').first();
await s.waitFor({ timeout: 20000 });
await s.fill("JE-2027-000254");
await a.waitForTimeout(7000);
await shot(a, "e1-journal-je254");
rec("journal_je254_rows", await rows(a, 30));

// open the entry itself
const row = a.getByText("JE-2027-000254", { exact: false }).first();
if (await row.count()) {
  await row.click().catch(() => {});
  await a.waitForTimeout(5000);
  await shot(a, "e2-journal-je254-detail");
  rec("journal_je254_detail", await rows(a, 45));
}

// ── 2. transactions, by order number ────────────────────────────────────────
rec("txTrouble", await go(a, "/app/finance/transactions", { waitMs: 11000 }));
s = a.locator('input[type="search"], input[placeholder*="earch"]').first();
const hasTxSearch = (await s.count()) > 0;
rec("txHasSearch", hasTxSearch);
if (hasTxSearch) {
  await s.fill("ORD-20260812-0164");
  await a.waitForTimeout(7000);
  await shot(a, "e3-tx-0164");
  rec("tx_0164_rows", await rows(a, 30));
} else {
  // no search box — narrow the date range to the two adjacent days instead
  const from = a.locator('input[type="date"]').first();
  const to = a.locator('input[type="date"]').nth(1);
  if (await from.count()) await from.fill("2026-08-12");
  if (await to.count()) await to.fill("2026-08-12");
  await a.waitForTimeout(6000);
  await shot(a, "e3-tx-0812-range");
  rec("tx_0812_range_rows", await rows(a, 40));
}

// ── 3. the same two facts over HTTP, on the accountant's own bearer ─────────
const je = await apiGet(a, `/api/v1/finance/journal-entries?search=JE-2027-000254&size=5`, tok);
rec("api_je254", {
  status: je.status,
  rows: (je.body?.data ?? []).map((e) => `${e.entryNo}|${e.entryDate}|${e.description}`),
});

const tx = await apiGet(
  a,
  `/api/v1/finance/transactions?from=2026-08-12&to=2026-08-12&size=200`,
  tok,
);
const txRows = (tx.body?.data ?? []).filter((r) =>
  JSON.stringify(r).includes("ORD-20260812-0164"),
);
rec("api_tx_0164", {
  status: tx.status,
  matched: txRows.map((r) => JSON.stringify(r).slice(0, 300)),
});

await browser.close();
console.log("\ndone -> legacy-row.json");
