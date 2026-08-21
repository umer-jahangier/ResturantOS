/*
 * B1 / S0-C — INDEPENDENT RE-VERIFICATION (adversarial).
 *
 * The claim under test: the trading day is now cut on the branch's IANA zone in all three
 * places, and the Takings screen / transactions list / journal entry agree.
 *
 * What this harness checks that the claimant's did not:
 *   A. the live ring-and-settle path, as the manager, INCLUDING a reload (does it PERSIST?)
 *   B. the SAME pre-existing order — the walkthrough's own ORD-20260812-0164 — looked at from
 *      BOTH screens at once: the Takings day it lands on, and the entry_date its ORDER_REVENUE
 *      journal entry carries. The DONE MEANS requires these to agree after the backfill.
 *   C. JE-2027-000254 read on screen, by name, as the accountant.
 *   D. the wrong persona: cashier on the cash-up + ledger screens (was anything widened?).
 */
import { PEOPLE, newBrowser, newPage, login, go, log, BASE, API } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1/audit";
mkdirSync(OUT, { recursive: true });
const J = {};
const rec = (k, v) => {
  J[k] = v;
  console.log(`  ${k}: ${JSON.stringify(v)}`);
  writeFileSync(`${OUT}/audit.json`, JSON.stringify(J, null, 2));
};
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};

const takingsProbe = (p) =>
  p.evaluate(() => {
    const t = document.body.innerText;
    const money = (label) => {
      const i = t.indexOf(label);
      return i < 0 ? null : /Rs [\d,]+\.\d\d/.exec(t.slice(i, i + 160))?.[0] ?? null;
    };
    const cashIdx = t.indexOf("CASH");
    return {
      dateBox: document.querySelector("input[type=date]")?.value ?? null,
      orderLine: /(\d+) orders? closed on this trading day/.exec(t)?.[0] ?? null,
      gross: money("GROSS SALES"),
      cashTender: cashIdx < 0 ? null : t.slice(cashIdx, cashIdx + 110).replace(/\s+/g, " "),
      empty: /No trading recorded on this date/i.test(t),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
    };
  });

const browser = await newBrowser();

/* ─────────────────────────── A. manager: ring, settle, cash up ───────────── */
const p = await newPage(browser);
await login(p, PEOPLE.manager);
rec("clock", {
  utc: new Date().toISOString(),
  karachi: new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi", hour12: false }),
});

log("\n=== A1. ring a TAKEAWAY check and settle it in CASH ===");
let tr = await go(p, "/app/pos", { waitMs: 9000 });
rec("posTrouble", tr);
const openTill = p.locator("[data-testid=open-till-button]");
if (await openTill.count()) {
  await openTill.first().click();
  await p.waitForTimeout(1500);
  const float = p.locator('input[type="number"], input[inputmode="decimal"]').first();
  if (await float.count()) await float.fill("5000");
  const confirm = p.getByRole("button", { name: /open till|confirm|start/i }).first();
  if (await confirm.count()) await confirm.click();
  await p.waitForTimeout(4500);
  log("  opened a till");
}
await p.locator("[data-testid=order-type-takeaway]").click();
await p.waitForTimeout(700);
const tiles = p.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 25000 });
await tiles.nth(2).click();
await p.waitForTimeout(500);
await tiles.nth(3).click();
await p.waitForTimeout(900);
await shot(p, "a1-cart");
await p.locator("[data-testid=send-to-kitchen-button]").click();
await p.waitForTimeout(8000);
const rung = await p.evaluate(() => ({
  orderNos: [...new Set([...document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)].map((m) => m[0]))],
  alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
}));
rec("rung", rung);
await shot(p, "a2-fired");
const orderNo = rung.orderNos[0];
if (!orderNo) throw new Error("no ORD- number after Send to Kitchen");

await p.getByText("Order Management", { exact: true }).click();
await p.waitForTimeout(5000);
await p.locator("[data-testid=order-management-search]").first().fill(orderNo);
await p.waitForTimeout(5000);
const orderId = await p.evaluate(
  () =>
    document.querySelector('[data-testid^="open-order-"]')?.getAttribute("data-testid")?.replace("open-order-", "") ??
    null,
);
rec("order", { orderNo, orderId });

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 8000 });
const fill = p.locator("[data-testid=fill-full-amount-button]");
if (await fill.count()) {
  await fill.first().click();
  await p.waitForTimeout(900);
}
const amountField = await p.locator('[aria-label="Amount (Rs)"]').first().inputValue();
rec("amountField", amountField);
await shot(p, "a3-charge");
await p.locator("[data-testid=record-payment-button]").click();
await p.waitForTimeout(8000);
await shot(p, "a4-paid");
rec(
  "afterPayment",
  await p.evaluate(() => ({
    err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
    rows: [...document.querySelectorAll("[data-testid=payment-history-rows] > *")].map((n) =>
      n.innerText.replace(/\s+/g, " ").trim(),
    ),
  })),
);
await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
const serve = p.getByRole("button", { name: /mark served|serve all|mark all served/i });
if (await serve.count()) {
  await serve.first().click();
  await p.waitForTimeout(6000);
  log("  pressed Mark Served");
}
await shot(p, "a5-served");

log("\n=== A2. Takings at its DEFAULT date ===");
tr = await go(p, "/app/finance/takings", { waitMs: 9000 });
rec("takingsDefaultTrouble", tr);
await shot(p, "a6-takings-default");
const dflt = await takingsProbe(p);
rec("takingsDefault", dflt);

log("\n=== A3. RELOAD — does the default persist? ===");
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(9000);
await shot(p, "a7-takings-reloaded");
rec("takingsAfterReload", await takingsProbe(p));

log("\n=== A4. the day BEFORE — the same money must be absent ===");
const y = new Date(`${dflt.dateBox}T00:00:00Z`);
y.setUTCDate(y.getUTCDate() - 1);
const yISO = y.toISOString().slice(0, 10);
tr = await go(p, `/app/finance/takings?date=${yISO}`, { waitMs: 9000 });
rec("takingsYesterdayTrouble", tr);
await shot(p, "a8-takings-yesterday");
rec("takingsYesterday", { asked: yISO, ...(await takingsProbe(p)) });

/* ────────── B. the pre-existing row: which Takings day does 0164 land on? ── */
log("\n=== B. the walkthrough's own ORD-20260812-0164 on the Takings screen ===");
for (const d of ["2026-08-11", "2026-08-12"]) {
  await go(p, `/app/finance/takings?date=${d}`, { waitMs: 9000 });
  await shot(p, `b-takings-${d}`);
  rec(`takings_${d}`, await takingsProbe(p));
}

/* ────────────────────────── D. wrong persona ─────────────────────────────── */
log("\n=== D. wrong persona: the cashier ===");
const cp = await newPage(browser);
await login(cp, PEOPLE.cashier);
for (const [name, route] of [
  ["cashierTakings", "/app/finance/takings"],
  ["cashierJournal", "/app/finance/journal-entries"],
  ["cashierTransactions", "/app/finance/transactions"],
]) {
  const t = await go(cp, route, { waitMs: 7000, allowTrouble: true });
  rec(name, t);
  await shot(cp, `d-${name}`);
}
await cp.close();

/* ────────────────────── C. accountant: the ledger screens ────────────────── */
log("\n=== C. accountant: transactions + journal entries ===");
const ap = await newPage(browser);
await login(ap, PEOPLE.accountant);

tr = await go(ap, "/app/finance/transactions", { waitMs: 9000 });
rec("txTrouble", tr);
await shot(ap, "c1-transactions");
rec(
  "txForMyOrder",
  await ap.evaluate((no) => {
    const lines = document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
    const i = lines.findIndex((l) => l.includes(no));
    return i < 0 ? { found: false, first15: lines.slice(0, 15) } : { found: true, around: lines.slice(Math.max(0, i - 4), i + 5) };
  }, orderNo),
);

tr = await go(ap, "/app/finance/journal-entries", { waitMs: 9000 });
rec("jeTrouble", tr);
await shot(ap, "c2-journal");

const searchJe = async (q, tag) => {
  const box = ap.locator('input[placeholder*="Search by entry no"]').first();
  await box.fill("");
  await ap.waitForTimeout(400);
  await box.fill(q);
  await ap.waitForTimeout(6000);
  await shot(ap, `c3-je-${tag}`);
  return ap.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")].map((r) =>
      [...r.querySelectorAll("td,th")].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | "),
    );
    return {
      count: document.querySelector("[data-testid=je-result-count]")?.innerText?.trim() ?? null,
      rows: rows.slice(0, 8),
    };
  });
};

rec("je_myOrder", await searchJe(orderNo, "mine"));
rec("je_0164", await searchJe("ORD-20260812-0164", "0164"));
rec("je_254", await searchJe("JE-2027-000254", "254"));

await browser.close();
log("\ndone — audit.json written");
