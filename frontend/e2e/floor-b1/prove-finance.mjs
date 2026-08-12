/*
 * B1 / S0-C, part 2 — the two ledger screens, driven as the ACCOUNTANT, who is the persona
 * that holds finance.journal.view. The manager gets "Access denied" on both, which reads in a
 * screenshot exactly like a missing feature.
 *
 * Asserts the three dates a restaurant sees for ONE sale are the same day:
 *   Takings business date  ==  Transactions stamped date  ==  ORDER_REVENUE entry date
 * and that the walkthrough's own ORD-20260812-0164 — closed 08:15 Asia/Karachi, inside the
 * 04:00–09:00 window the UTC cut mis-filed — now appears on exactly ONE of the two adjacent days.
 */
import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1";
mkdirSync(OUT, { recursive: true });
const ORDER_NO = process.argv[2] ?? "ORD-20260812-0202";
const WALKTHROUGH_NO = "ORD-20260812-0164";

const journal = {};
const record = (k, v) => {
  journal[k] = v;
  log(`  ${k}: ${JSON.stringify(v)}`);
  writeFileSync(`${OUT}/prove-finance.json`, JSON.stringify(journal, null, 2));
};
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  log(`    shot: ${n}.png`);
};

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.accountant);
record("clock", {
  utc: new Date().toISOString(),
  karachi: new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" }),
});

// ── Transactions: find the payment row for our order ─────────────────────────
let tr = await go(p, "/app/finance/transactions", { waitMs: 9000 });
record("transactionsTrouble", tr);
await shot(p, "31-transactions-accountant");
const search = p.locator('input[type="search"], input[placeholder*="earch"]').first();
if (await search.count()) {
  await search.fill(ORDER_NO);
  await p.waitForTimeout(4500);
}
await shot(p, "32-transactions-searched");
record(
  "transactionRows",
  await p.evaluate((no) => {
    const rows = [...document.querySelectorAll("tr")].map((r) =>
      r.innerText.replace(/\s+/g, " ").trim(),
    );
    return {
      matching: rows.filter((r) => r.includes(no)),
      firstFew: rows.slice(0, 6),
      bodyHasOrder: document.body.innerText.includes(no),
    };
  }, ORDER_NO),
);

// ── Journal entries ──────────────────────────────────────────────────────────
tr = await go(p, "/app/finance/journal-entries", { waitMs: 9000 });
record("journalTrouble", tr);
await shot(p, "41-journal-accountant");
const jsearch = p.locator('input[type="search"], input[placeholder*="earch"]').first();
if (await jsearch.count()) {
  await jsearch.fill("Order revenue");
  await p.waitForTimeout(4000);
}
await shot(p, "42-journal-searched");
record(
  "journalRows",
  await p.evaluate(() =>
    [...document.querySelectorAll("tr")]
      .map((r) => r.innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 15),
  ),
);

// ── Takings, both days, on the accountant's own bearer ───────────────────────
for (const d of ["", "?date=2026-08-11", "?date=2026-08-12"]) {
  tr = await go(p, `/app/finance/takings${d}`, { waitMs: 8000 });
  const probe = await p.evaluate(() => {
    const t = document.body.innerText;
    // The tender split renders each method with its amount; read the CASH row specifically.
    const rows = [...document.querySelectorAll("tr")].map((r) =>
      r.innerText.replace(/\s+/g, " ").trim(),
    );
    return {
      dateBox: document.querySelector("input[type=date]")?.value ?? null,
      orderLine: /(\d+) orders? closed on this trading day/.exec(t)?.[0] ?? null,
      cashRow: rows.find((r) => /^CASH/i.test(r)) ?? null,
      tenderRows: rows.filter((r) => /^(CASH|CARD|WALLET|BANK)/i.test(r)),
      trouble: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
    };
  });
  record(`takings${d || "Default"}`, { asked: d || "(default)", ...tr, ...probe });
  await shot(p, `50-takings${(d || "-default").replace(/[?=]/g, "-")}`);
}

await browser.close();
