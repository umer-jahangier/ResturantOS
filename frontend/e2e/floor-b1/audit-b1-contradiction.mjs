/*
 * B1 / S0-C — the surviving contradiction, photographed on two screens.
 *
 * ORD-20260812-0164 (till f6b61863, cashier bc0d9897, closed 08:15 Asia/Karachi on 12 Aug):
 *   - the cash-up screen files its money on 2026-08-12
 *   - its ORDER_REVENUE entry JE-2027-000254 is dated 2026-08-11
 * Same order. Same money. Two days. Also: the manager the DONE MEANS names cannot open
 * either ledger screen.
 */
import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1/audit";
mkdirSync(OUT, { recursive: true });
const J = {};
const rec = (k, v) => {
  J[k] = v;
  console.log(`  ${k}: ${JSON.stringify(v)}`);
  writeFileSync(`${OUT}/audit-contradiction.json`, JSON.stringify(J, null, 2));
};
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};

const browser = await newBrowser();

log("\n=== the manager the DONE MEANS names, on the two ledger screens ===");
const mp = await newPage(browser);
await login(mp, PEOPLE.manager);
for (const [k, route] of [
  ["managerTransactions", "/app/finance/transactions"],
  ["managerJournal", "/app/finance/journal-entries"],
]) {
  const t = await go(mp, route, { waitMs: 7000, allowTrouble: true });
  rec(k, {
    ...t,
    heading: await mp.evaluate(
      () => document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6),
    ),
  });
  await shot(mp, `f-${k}`);
}

log("\n=== the cash-up screen: 0164's till sits on 2026-08-12 ===");
await go(mp, "/app/finance/takings?date=2026-08-12", { waitMs: 9000 });
rec(
  "takings0812_till",
  await mp.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("bc0d9897");
    return {
      orderLine: /(\d+) orders? closed on this trading day/.exec(t)?.[0] ?? null,
      tillRow: i < 0 ? "NOT ON THIS PAGE" : t.slice(i - 60, i + 200).replace(/\s+/g, " "),
    };
  }),
);
await shot(mp, "f-takings-0812-till");

await go(mp, "/app/finance/takings?date=2026-08-11", { waitMs: 9000 });
rec(
  "takings0811_till",
  await mp.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("bc0d9897");
    return {
      orderLine: /(\d+) orders? closed on this trading day/.exec(t)?.[0] ?? null,
      tillRow: i < 0 ? "NOT ON THIS PAGE" : t.slice(i - 60, i + 200).replace(/\s+/g, " "),
    };
  }),
);
await shot(mp, "f-takings-0811-till");
await mp.close();

log("\n=== the ledger: the same order's ORDER_REVENUE entry ===");
const ap = await newPage(browser);
await login(ap, PEOPLE.accountant);
await go(ap, "/app/finance/journal-entries", { waitMs: 9000 });
const box = ap.locator('input[placeholder*="Search by entry no"]').first();
await box.fill("JE-2027-000254");
await ap.waitForTimeout(6000);
await shot(ap, "f-je-254");
rec(
  "je254",
  await ap.evaluate(() => ({
    count: document.querySelector("[data-testid=je-result-count]")?.innerText?.trim() ?? null,
    rows: [...document.querySelectorAll("tbody tr")].map((r) =>
      [...r.querySelectorAll("td,th")].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | "),
    ),
  })),
);

// open it, so the date is read on the entry's own page and not only in a list row
const first = ap.locator("tbody tr").first();
if (await first.count()) {
  await first.click();
  await ap.waitForTimeout(6000);
  await shot(ap, "f-je-254-detail");
  rec(
    "je254detail",
    await ap.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
    })),
  );
}

await browser.close();
log("\ndone");
