/*
 * RE-OPEN B1 / S0-C — part 2: the WRITE path and the ledger readers.
 *
 *  A. manager rings + settles a CASH check, then reads it back on /app/finance/takings.
 *  B. accountant opens /app/finance/transactions and /app/finance/journal-entries for BOTH
 *     the new order and the walkthrough's own ORD-20260812-0164 / JE-2027-000254.
 *  D. persona: manager on the two ledger screens; cashier on takings.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1-reopen";
mkdirSync(OUT, { recursive: true });
const J = {};
const rec = (k, v) => {
  J[k] = v;
  console.log(`  ${k}: ${JSON.stringify(v)?.slice(0, 1000)}`);
  writeFileSync(`${OUT}/write-path.json`, JSON.stringify(J, null, 2));
};
const shot = async (pg, n) => {
  await pg.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};
const lines = (pg, n = 70) =>
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
const p = await newPage(browser);
await login(p, PEOPLE.manager);
rec("clock", {
  utc: new Date().toISOString(),
  karachi: new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" }),
});

const clearModifierDialog = async () => {
  const dlg = p.locator("[data-testid=modifier-dialog]");
  if (await dlg.count()) {
    const add = p.locator("[data-testid=modifier-dialog-add]");
    if (await add.count()) {
      if ((await add.first().getAttribute("aria-disabled")) === "true") {
        const opts = dlg.locator('button[role="radio"], [role="checkbox"], input[type=radio]');
        const n = Math.min(await opts.count(), 6);
        for (let i = 0; i < n; i++) await opts.nth(i).click({ timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(400);
      }
      await add.first().click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(900);
    }
    if (await p.locator("[data-testid=modifier-dialog]").count()) {
      await p.keyboard.press("Escape");
      await p.waitForTimeout(600);
    }
  }
};

// ── A. ring and settle ──────────────────────────────────────────────────────
console.log("\n=== A. ring + settle a CASH check as the manager ===");
let orderNo = null;
for (let attempt = 1; attempt <= 4 && !orderNo; attempt++) {
  console.log(`  attempt ${attempt}`);
  const tr = await go(p, "/app/pos", { waitMs: 10000, allowTrouble: true });
  rec(`posTrouble_${attempt}`, tr);

  const openTill = p.locator("[data-testid=open-till-button]");
  if (await openTill.count()) {
    await openTill.first().click();
    await p.waitForTimeout(1500);
    const float = p.locator('input[type="number"], input[inputmode="decimal"]').first();
    if (await float.count()) await float.fill("5000");
    const confirm = p.getByRole("button", { name: /open till|confirm|start/i }).first();
    if (await confirm.count()) await confirm.click();
    await p.waitForTimeout(4500);
    console.log("  opened a till");
  }

  const takeaway = p.locator("[data-testid=order-type-takeaway]");
  if (!(await takeaway.count())) {
    await p.waitForTimeout(15000);
    continue;
  }
  await takeaway.click();
  await p.waitForTimeout(800);
  const tiles = p.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30000 }).catch(() => {});
  await tiles.nth(0).click().catch(() => {});
  await p.waitForTimeout(900);
  await clearModifierDialog();
  await shot(p, `a2-cart-${attempt}`);

  await p.locator("[data-testid=send-to-kitchen-button]").click().catch(() => {});
  await p.waitForTimeout(9000);
  const rung = await p.evaluate(() => ({
    orderNos: [
      ...new Set([...document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)].map((m) => m[0])),
    ],
    alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
  }));
  rec(`rung_${attempt}`, rung);
  orderNo = rung.orderNos[0] ?? null;
  if (!orderNo) await p.waitForTimeout(20000);
}
if (!orderNo) throw new Error("could not ring an order after 4 attempts");
await shot(p, "a3-fired");

await p.getByText("Order Management", { exact: true }).click();
await p.waitForTimeout(5000);
await p.locator("[data-testid=order-management-search]").first().fill(orderNo);
await p.waitForTimeout(5000);
const orderId = await p.evaluate(() => {
  const btn = document.querySelector('[data-testid^="open-order-"]');
  return btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null;
});
rec("newOrder", { orderNo, orderId });

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 9000 });
await shot(p, "a4-charge");
const fillFull = p.locator("[data-testid=fill-full-amount-button]");
if (await fillFull.count()) {
  await fillFull.first().click();
  await p.waitForTimeout(900);
}
rec("amountField", await p.locator('[aria-label="Amount (Rs)"]').first().inputValue());
await p.locator("[data-testid=record-payment-button]").click();
await p.waitForTimeout(9000);
await shot(p, "a5-paid");
rec(
  "afterPayment",
  await p.evaluate(() => ({
    err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
    text: (document.querySelector("main")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 700),
  })),
);

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 6000 });
const serve = p.getByRole("button", { name: /mark served|serve all|mark all served/i });
if (await serve.count()) {
  await serve.first().click();
  await p.waitForTimeout(7000);
  console.log("  pressed Mark Served");
}
await shot(p, "a6-served");

const tok = await tokenOf(p);
const ord = (await apiGet(p, `/api/v1/pos/orders/${orderId}`, tok)).body?.data ?? null;
rec("orderReadBack", ord && {
  orderNo: ord.orderNo,
  status: ord.status,
  closedAt: ord.closedAt,
  totalPaisa: ord.totalPaisa,
});

// ── takings, default date, after the sale ───────────────────────────────────
const takingsProbe = async () => {
  await p
    .waitForFunction(
      () =>
        /orders? closed on this trading day/.test(document.body.innerText) ||
        /No trading recorded on this date/.test(document.body.innerText) ||
        /Couldn.t load|unavailable right now|Access denied/i.test(document.body.innerText),
      null,
      { timeout: 45000 },
    )
    .catch(() => console.log("    ! takings never settled"));
  return p.evaluate(() => {
    const t = document.body.innerText;
    const grab = (label, span = 110) => {
      const i = t.indexOf(label);
      return i < 0 ? null : t.slice(i, i + span).replace(/\s+/g, " ").trim();
    };
    return {
      dateBox: document.querySelector("[data-testid=takings-date]")?.value ?? null,
      orderLine: /(\d+) orders? closed on this trading day/.exec(t)?.[0] ?? null,
      cash: grab("Cash"),
      card: grab("Card"),
      emptyState: /No trading recorded on this date/i.test(t),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
    };
  });
};

console.log("\n=== A2. takings at its DEFAULT date, after the sale ===");
rec("takingsAfterTrouble", await go(p, "/app/finance/takings", { waitMs: 9000 }));
rec("takingsDefault_after", await takingsProbe());
await shot(p, "a7-takings-default-after");
rec("api_takings_default_after", (await apiGet(p, "/api/v1/pos/takings/daily", tok)).body?.data
  ? {
      businessDate: (await apiGet(p, "/api/v1/pos/takings/daily", tok)).body.data.businessDate,
    }
  : null);

await go(p, "/app/finance/takings?date=2026-08-11", { waitMs: 9000 });
rec("takings_0811_after", await takingsProbe());
await shot(p, "a8-takings-yesterday-after");

// ── D. manager on the ledger screens ────────────────────────────────────────
console.log("\n=== D. manager on the ledger screens ===");
rec("manager_transactions", await go(p, "/app/finance/transactions", { waitMs: 9000, allowTrouble: true }));
await shot(p, "d1-manager-transactions");
rec("manager_journal", await go(p, "/app/finance/journal-entries", { waitMs: 9000, allowTrouble: true }));
await shot(p, "d2-manager-journal");
await p.context().close();

// ── B. the accountant ───────────────────────────────────────────────────────
console.log("\n=== B. accountant on the ledger ===");
const a = await newPage(browser);
await login(a, PEOPLE.accountant);
const atok = await tokenOf(a);

rec("acc_journalTrouble", await go(a, "/app/finance/journal-entries", { waitMs: 10000 }));
await shot(a, "b1-journal");
rec("journalScreen_top", await lines(a, 60));

const search = a.locator('input[type="search"], input[placeholder*="earch"]').first();
const hasSearch = (await search.count()) > 0;
rec("journalHasSearch", hasSearch);
if (hasSearch) {
  await search.fill(orderNo);
  await a.waitForTimeout(6000);
  await shot(a, "b2-journal-neworder");
  rec("journalScreen_newOrder", await lines(a, 50));

  await search.fill("");
  await a.waitForTimeout(1500);
  await search.fill("ORD-20260812-0164");
  await a.waitForTimeout(6000);
  await shot(a, "b3-journal-0164");
  rec("journalScreen_0164", await lines(a, 50));
}

// The two ledger rows, straight off the API on the accountant's own bearer.
for (const [k, q] of [
  ["je_api_new", `search=${encodeURIComponent(orderNo)}`],
  ["je_api_0164", `search=${encodeURIComponent("ORD-20260812-0164")}`],
]) {
  const r = await apiGet(a, `/api/v1/finance/journal-entries?${q}&size=20`, atok);
  rec(k, { status: r.status, body: JSON.stringify(r.body).slice(0, 1400) });
}

rec("acc_transactionsTrouble", await go(a, "/app/finance/transactions", { waitMs: 10000 }));
await shot(a, "b4-transactions");
rec("transactionsScreen_top", await lines(a, 60));
const tx = a.locator('input[type="search"], input[placeholder*="earch"]').first();
if (await tx.count()) {
  await tx.fill(orderNo);
  await a.waitForTimeout(6000);
  await shot(a, "b5-transactions-neworder");
  rec("transactionsScreen_newOrder", await lines(a, 40));

  await tx.fill("");
  await a.waitForTimeout(1500);
  await tx.fill("ORD-20260812-0164");
  await a.waitForTimeout(6000);
  await shot(a, "b6-transactions-0164");
  rec("transactionsScreen_0164", await lines(a, 40));
}
await a.context().close();

// ── D2. cashier ─────────────────────────────────────────────────────────────
console.log("\n=== D2. cashier on takings ===");
const c = await newPage(browser);
await login(c, PEOPLE.cashier);
rec("cashier_takings", await go(c, "/app/finance/takings", { waitMs: 9000, allowTrouble: true }));
await shot(c, "d3-cashier-takings");
await c.context().close();

await browser.close();
console.log("\ndone -> write-path.json");
