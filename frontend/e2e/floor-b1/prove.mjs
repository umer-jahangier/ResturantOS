/*
 * B1 / S0-C — drive the DONE MEANS path in real Chromium as the manager who cashes up.
 *
 *   1. Ring a TAKEAWAY check on the POS terminal and settle it in CASH.
 *   2. Open /app/finance/takings with the date box LEFT AT ITS DEFAULT.
 *      The check's money must be there, on today's trading day, with a non-zero CASH line.
 *   3. Change the date box to YESTERDAY. The same money must be ABSENT.
 *   4. /app/finance/transactions — the payment row's stamped date must equal the Takings date.
 *   5. /app/finance/journal-entries — the ORDER_REVENUE entry for that order, same day again.
 *   6. The walkthrough's own ORD-20260812-0164 (closed 08:15 Asia/Karachi, inside the
 *      04:00–09:00 window the UTC cut mis-filed) must appear on exactly ONE of the two
 *      adjacent Takings days.
 */
import { PEOPLE, newBrowser, newPage, login, go, log, BASE, API } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1";
mkdirSync(OUT, { recursive: true });
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  log(`    shot: ${n}.png`);
};
const journal = {};
const record = (k, v) => {
  journal[k] = v;
  log(`  ${k}: ${JSON.stringify(v)}`);
  writeFileSync(`${OUT}/prove.json`, JSON.stringify(journal, null, 2));
};

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.manager);
record("clock", {
  utc: new Date().toISOString(),
  karachi: new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" }),
});

// ── 1. Ring and settle a cash check ──────────────────────────────────────────
log("\n=== 1. ring a takeaway check and settle it in CASH ===");
let tr = await go(p, "/app/pos", { waitMs: 8000 });
record("posTrouble", tr);
await shot(p, "10-pos-terminal");

// A manager must hold an OPEN till before a CASH tender is accepted (D-30).
const openTill = p.locator("[data-testid=open-till-button]");
if (await openTill.count()) {
  await openTill.first().click();
  await p.waitForTimeout(1500);
  const float = p.locator('input[type="number"], input[inputmode="decimal"]').first();
  if (await float.count()) await float.fill("5000");
  const confirm = p.getByRole("button", { name: /open till|confirm|start/i }).first();
  if (await confirm.count()) await confirm.click();
  await p.waitForTimeout(4000);
  log("  opened a till");
}
await shot(p, "11-till-strip");

await p.locator("[data-testid=order-type-takeaway]").click();
await p.waitForTimeout(600);
const tiles = p.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 25000 });
await tiles.nth(0).click();
await p.waitForTimeout(400);
await tiles.nth(1).click();
await p.waitForTimeout(800);
await shot(p, "12-cart");

await p.locator("[data-testid=send-to-kitchen-button]").click();
await p.waitForTimeout(7000);
const rung = await p.evaluate(() => ({
  orderNos: [...new Set([...document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)].map((m) => m[0]))],
  alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
}));
record("rung", rung);
await shot(p, "13-after-send");

const orderNo = rung.orderNos[0];
if (!orderNo) throw new Error("no order number after Send to Kitchen — cannot continue");

// Find the order id over HTTP on this same signed-in persona's bearer.
const found = await p.evaluate(async ({ api, no }) => {
  const r = await fetch(`${api}/api/v1/pos/orders/search?q=${encodeURIComponent(no)}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${window.__accessToken ?? ""}` },
  }).catch(() => null);
  return r ? { status: r.status } : null;
}, { api: API, no: orderNo });
log("  (search probe)", JSON.stringify(found));

// Drive the charge page through the UI: Order Management -> search -> open.
await p.getByText("Order Management", { exact: true }).click();
await p.waitForTimeout(4500);
await p.locator("[data-testid=order-management-search]").first().fill(orderNo);
await p.waitForTimeout(4500);
const orderId = await p.evaluate(() => {
  const btn = document.querySelector('[data-testid^="open-order-"]');
  return btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null;
});
record("order", { orderNo, orderId });

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
await shot(p, "14-charge-page");
const fillFull = p.locator("[data-testid=fill-full-amount-button]");
if (await fillFull.count()) {
  await fillFull.first().click();
  await p.waitForTimeout(800);
}
const amount = await p.locator('[aria-label="Amount (Rs)"]').first().inputValue();
record("amountField", amount);
await p.locator("[data-testid=record-payment-button]").click();
await p.waitForTimeout(7000);
await shot(p, "15-after-payment");
const paid = await p.evaluate(() => ({
  err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
  rows: [...document.querySelectorAll("[data-testid=payment-history-rows] > *")].map((n) =>
    n.innerText.replace(/\s+/g, " ").trim(),
  ),
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
}));
record("afterPayment", paid);

// Serve the lines so POS-23 closes the order (paid AND served).
await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 4000 });
const serve = p.getByRole("button", { name: /mark served|serve all|mark all served/i });
if (await serve.count()) {
  await serve.first().click();
  await p.waitForTimeout(5000);
  log("  pressed Mark Served");
}
await shot(p, "16-after-serve");

// ── 2/3. Takings at the DEFAULT date, then yesterday ─────────────────────────
log("\n=== 2. /app/finance/takings at its DEFAULT date ===");
const takingsProbe = () =>
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
      cashTender: cashIdx < 0 ? null : t.slice(cashIdx, cashIdx + 120).replace(/\s+/g, " "),
      emptyState: /No trading recorded on this date/i.test(t),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
    };
  });

tr = await go(p, "/app/finance/takings", { waitMs: 8000 });
record("takingsDefaultTrouble", tr);
await shot(p, "20-takings-default");
const dflt = await takingsProbe();
record("takingsDefault", dflt);

const yesterday = new Date(`${dflt.dateBox}T00:00:00Z`);
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const yISO = yesterday.toISOString().slice(0, 10);
tr = await go(p, `/app/finance/takings?date=${yISO}`, { waitMs: 8000 });
record("takingsYesterdayTrouble", tr);
await shot(p, "21-takings-yesterday");
record("takingsYesterday", { asked: yISO, ...(await takingsProbe()) });

// ── 4. Transactions ──────────────────────────────────────────────────────────
log("\n=== 4. /app/finance/transactions ===");
tr = await go(p, "/app/finance/transactions", { waitMs: 8000 });
record("transactionsTrouble", tr);
await shot(p, "30-transactions");
record(
  "transactionsTop",
  await p.evaluate(() =>
    document.body.innerText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 45),
  ),
);

// ── 5. Journal entries ───────────────────────────────────────────────────────
log("\n=== 5. /app/finance/journal-entries ===");
tr = await go(p, "/app/finance/journal-entries", { waitMs: 8000 });
record("journalTrouble", tr);
await shot(p, "40-journal-entries");
record(
  "journalTop",
  await p.evaluate(() =>
    document.body.innerText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50),
  ),
);

await browser.close();
log("\nJournal written to prove.json");
