/*
 * B1 / S0-C — the ADJACENT READER the claimant did not open: /app/reports.
 *
 * The Takings screen derives the trading day at QUERY time, so the fix reached it for free.
 * reporting-service does not: OrderClosedConsumer READS businessDate off the ORDER_CLOSED
 * payload and writes it into ClickHouse sales_order_facts, where it is frozen. Every report
 * that groups by business_date is therefore still answering with the pre-fix UTC day for
 * every order closed before the fix — and nothing in the committed backfill touches it.
 *
 * This opens "Sales by Day" for 2026-08-11..2026-08-12 and puts its order counts next to the
 * cash-up screen's for the same two days.
 */
import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1/audit";
mkdirSync(OUT, { recursive: true });
const J = {};
const rec = (k, v) => {
  J[k] = v;
  console.log(`  ${k}: ${JSON.stringify(v)}`);
  writeFileSync(`${OUT}/audit-reports.json`, JSON.stringify(J, null, 2));
};
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
  console.log(`    shot: ${n}.png`);
};

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.manager);

log("\n=== /app/reports — the catalog ===");
let tr = await go(p, "/app/reports", { waitMs: 8000, allowTrouble: true });
rec("reportsTrouble", tr);
await shot(p, "e1-reports");
rec(
  "catalog",
  await p.evaluate(() =>
    document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 40),
  ),
);

log("\n=== Sales by Day, 2026-08-11 .. 2026-08-12 ===");
tr = await go(p, "/app/reports/sales-by-day?from=2026-08-11&to=2026-08-12", {
  waitMs: 9000,
  allowTrouble: true,
});
rec("salesByDayTrouble", tr);

// Fill whatever date controls the page actually shows, then run it.
const dates = p.locator('input[type="date"]');
const n = await dates.count();
rec("dateInputs", n);
if (n >= 2) {
  await dates.nth(0).fill("2026-08-11");
  await p.waitForTimeout(400);
  await dates.nth(1).fill("2026-08-12");
  await p.waitForTimeout(600);
  const run = p.getByRole("button", { name: /run|generate|apply|refresh/i }).first();
  if (await run.count()) {
    await run.click();
    await p.waitForTimeout(8000);
  } else {
    await p.waitForTimeout(6000);
  }
}
await shot(p, "e2-sales-by-day");
rec(
  "salesByDay",
  await p.evaluate(() => ({
    rows: [...document.querySelectorAll("table tr")]
      .map((r) => [...r.querySelectorAll("th,td")].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | "))
      .filter(Boolean)
      .slice(0, 15),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((x) => x.innerText.trim()),
  })),
);

log("\n=== the same two days on the cash-up screen, for comparison ===");
for (const d of ["2026-08-11", "2026-08-12"]) {
  await go(p, `/app/finance/takings?date=${d}`, { waitMs: 8000 });
  rec(
    `takings_${d}`,
    await p.evaluate(() => {
      const t = document.body.innerText;
      return {
        dateBox: document.querySelector("input[type=date]")?.value ?? null,
        orderLine: /(\d+) orders? closed on this trading day/.exec(t)?.[0] ?? null,
        gross: /GROSS SALES[\s\S]{0,120}?(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      };
    }),
  );
}

await browser.close();
log("\ndone");
