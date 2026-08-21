/*
 * RE-OPEN ATTEMPT on B1 / S0-C — driven independently in real Chromium.
 *
 * The claim under test: the trading day is now cut on the branch's IANA zone in all three
 * places (Takings screen, ORDER_CLOSED businessDate -> journal_entries.entry_date, and the
 * ORD-YYYYMMDD-NNNN sequence), and a newly rung cash check reads the same day on all three
 * screens.
 *
 * What this run tries to break:
 *   A. the WRITER — ring + settle a cash check as the manager, then read it back on
 *      /app/finance/takings (default date), /app/finance/transactions, /app/finance/journal-entries.
 *   B. the READER on rows ALREADY WRITTEN — the walkthrough's own ORD-20260812-0164 closed
 *      03:15:24Z, which is 08:15 Asia/Karachi and therefore inside the 23:00Z-04:00Z window where
 *      the two rules disagree. Takings must file it on 2026-08-12; the ledger row says 2026-08-11.
 *      Same order, two screens, two days.
 *   C. the DISCRIMINATOR, read-only — 23 F-7 orders sit in that window. If the Takings SQL were
 *      still UTC they would ALL be on the 11th. Their money moving to the 12th is only explicable
 *      by the branch zone. No global state is mutated to get this.
 *   D. PERSONA — manager vs accountant on the two ledger screens; cashier on takings. Nothing
 *      widened.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1-reopen";
mkdirSync(OUT, { recursive: true });
const J = {};
const rec = (k, v) => {
  J[k] = v;
  console.log(`  ${k}: ${JSON.stringify(v)?.slice(0, 900)}`);
  writeFileSync(`${OUT}/reopen.json`, JSON.stringify(J, null, 2));
};
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03"; // F-7

const browser = await newBrowser();

// ───────────────────────────── MANAGER ─────────────────────────────
const p = await newPage(browser);
await login(p, PEOPLE.manager);
rec("clock", {
  utc: new Date().toISOString(),
  karachi: new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" }),
});

const takingsProbe = async () => {
  // NEVER score this screen mid-flight: an unresolved query looks exactly like an empty day.
  await p
    .waitForFunction(
      () =>
        /orders? closed on this trading day/.test(document.body.innerText) ||
        /No trading recorded on this date/.test(document.body.innerText) ||
        /Couldn.t load|Access denied/i.test(document.body.innerText),
      null,
      { timeout: 45000 },
    )
    .catch(() => console.log("    ! takings never settled within 45s"));
  return p.evaluate(() => {
    const t = document.body.innerText;
    const grab = (label, span = 120) => {
      const i = t.indexOf(label);
      return i < 0 ? null : t.slice(i, i + span).replace(/\s+/g, " ").trim();
    };
    const main = document.querySelector("main")?.innerText ?? t;
    return {
      dateBox: document.querySelector("[data-testid=takings-date]")?.value ?? null,
      orderLine: /(\d+) orders? closed on this trading day/.exec(t)?.[0] ?? null,
      gross: grab("Gross sales") ?? grab("GROSS SALES"),
      net: grab("Net sales") ?? grab("NET SALES"),
      cash: grab("Cash"),
      card: grab("Card"),
      tills: [...t.matchAll(/Cashier ([0-9a-f]{8})/g)].map((m) => m[1]),
      emptyState: /No trading recorded on this date/i.test(t),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
      main: main.replace(/\s+/g, " ").slice(0, 2500),
    };
  });
};

/** Same figures, straight off the API on this persona's own bearer — no UI in the way. */
const takingsApi = async (date) => {
  const r = await apiGet(p, `/api/v1/pos/takings/daily${date ? `?date=${date}` : ""}`, await tokenOf(p));
  const d = r.body?.data ?? r.body ?? null;
  return {
    status: r.status,
    businessDate: d?.businessDate ?? null,
    orderCount: d?.orderCount ?? null,
    byTender: (d?.byTender ?? []).map((x) => `${x.tenderType}:${x.count}:${x.amountPaisa}`),
    tills: (d?.tills ?? []).map((x) => `${String(x.tillSessionId ?? "").slice(0, 8)}`),
  };
};

/** Clear the modifier dialog if a tile opened one. */
const clearModifierDialog = async () => {
  const dlg = p.locator("[data-testid=modifier-dialog]");
  if (await dlg.count()) {
    const add = p.locator("[data-testid=modifier-dialog-add]");
    if (await add.count()) {
      const blocked = (await add.first().getAttribute("aria-disabled")) === "true";
      if (blocked) {
        // Pick the first choice in every group, then add.
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

// ── C. the read-only discriminator, taken BEFORE anything is rung ──────────
console.log("\n=== C. adjacent days, read-only discriminator ===");
let tr = await go(p, "/app/finance/takings", { waitMs: 9000 });
rec("takingsDefaultTrouble", tr);
rec("takingsDefault_before", await takingsProbe());
await shot(p, "c1-takings-default");
rec("api_takings_default", await takingsApi(null));

tr = await go(p, "/app/finance/takings?date=2026-08-11", { waitMs: 9000 });
rec("takings0811Trouble", tr);
rec("takings_0811", await takingsProbe());
await shot(p, "c2-takings-0811");
rec("api_takings_0811", await takingsApi("2026-08-11"));

tr = await go(p, "/app/finance/takings?date=2026-08-12", { waitMs: 9000 });
rec("takings_0812", await takingsProbe());
await shot(p, "c3-takings-0812");
rec("api_takings_0812", await takingsApi("2026-08-12"));

// ── A. ring and settle a cash check ────────────────────────────────────────
console.log("\n=== A. ring + settle a CASH check as the manager ===");
tr = await go(p, "/app/pos", { waitMs: 9000 });
rec("posTrouble", tr);
await shot(p, "a1-pos");

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

await p.locator("[data-testid=order-type-takeaway]").click();
await p.waitForTimeout(700);
const tiles = p.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 30000 });
await tiles.nth(0).click();
await p.waitForTimeout(900);
await clearModifierDialog();
await tiles.nth(2).click();
await p.waitForTimeout(900);
await clearModifierDialog();
await shot(p, "a2-cart");

await p.locator("[data-testid=send-to-kitchen-button]").click();
await p.waitForTimeout(8000);
const rung = await p.evaluate(() => ({
  orderNos: [...new Set([...document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)].map((m) => m[0]))],
  alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.innerText.trim()),
}));
rec("rung", rung);
await shot(p, "a3-fired");
const orderNo = rung.orderNos[0];
if (!orderNo) throw new Error("no order number after Send to Kitchen");

await p.getByText("Order Management", { exact: true }).click();
await p.waitForTimeout(5000);
await p.locator("[data-testid=order-management-search]").first().fill(orderNo);
await p.waitForTimeout(5000);
const orderId = await p.evaluate(() => {
  const btn = document.querySelector('[data-testid^="open-order-"]');
  return btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null;
});
rec("newOrder", { orderNo, orderId });

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 8000 });
await shot(p, "a4-charge");
const fillFull = p.locator("[data-testid=fill-full-amount-button]");
if (await fillFull.count()) {
  await fillFull.first().click();
  await p.waitForTimeout(900);
}
const amount = await p.locator('[aria-label="Amount (Rs)"]').first().inputValue();
rec("amountField", amount);
await p.locator("[data-testid=record-payment-button]").click();
await p.waitForTimeout(8000);
await shot(p, "a5-paid");
rec(
  "afterPayment",
  await p.evaluate(() => ({
    err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
  })),
);

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
const serve = p.getByRole("button", { name: /mark served|serve all|mark all served/i });
if (await serve.count()) {
  await serve.first().click();
  await p.waitForTimeout(6000);
  console.log("  pressed Mark Served");
}
await shot(p, "a6-served");

// order row, straight off the API on the manager's own bearer
const tok = await tokenOf(p);
rec("orderReadBack", (await apiGet(p, `/api/v1/pos/orders/${orderId}`, tok)).body?.data ?? null);

// ── takings again, default date ────────────────────────────────────────────
console.log("\n=== A2. takings at its DEFAULT date, after the sale ===");
tr = await go(p, "/app/finance/takings", { waitMs: 9000 });
rec("takingsAfterTrouble", tr);
rec("takingsDefault_after", await takingsProbe());
await shot(p, "a7-takings-default-after");
rec("api_takings_default_after", await takingsApi(null));

tr = await go(p, "/app/finance/takings?date=2026-08-11", { waitMs: 9000 });
rec("takings_0811_after", await takingsProbe());
await shot(p, "a8-takings-yesterday-after");
rec("api_takings_0811_after", await takingsApi("2026-08-11"));

// ── D. manager on the two ledger screens (must NOT have been widened) ──────
console.log("\n=== D. manager on the ledger screens ===");
tr = await go(p, "/app/finance/transactions", { waitMs: 8000, allowTrouble: true });
rec("manager_transactions", tr);
await shot(p, "d1-manager-transactions");
tr = await go(p, "/app/finance/journal-entries", { waitMs: 8000, allowTrouble: true });
rec("manager_journal", tr);
await shot(p, "d2-manager-journal");

await p.context().close();

// ───────────────────────────── ACCOUNTANT ──────────────────────────────────
console.log("\n=== B. accountant on the ledger ===");
const a = await newPage(browser);
await login(a, PEOPLE.accountant);

const atok = await tokenOf(a);

tr = await go(a, "/app/finance/journal-entries", { waitMs: 9000 });
rec("acc_journalTrouble", tr);
await shot(a, "b1-journal");

// The new order's ORDER_REVENUE entry
const jeNew = await apiGet(
  a,
  `/api/v1/finance/journal-entries?search=${encodeURIComponent(orderNo)}&size=20`,
  atok,
);
rec("je_newOrder_api", { status: jeNew.status, body: JSON.stringify(jeNew.body).slice(0, 1200) });

// The walkthrough's own row
const je254 = await apiGet(
  a,
  `/api/v1/finance/journal-entries?search=${encodeURIComponent("JE-2027-000254")}&size=20`,
  atok,
);
rec("je_254_api", { status: je254.status, body: JSON.stringify(je254.body).slice(0, 1200) });

// Drive it through the screen too, not just the API.
const search = a.locator('input[type="search"], input[placeholder*="earch"]');
if (await search.count()) {
  await search.first().fill("JE-2027-000254");
  await a.waitForTimeout(5000);
}
await shot(a, "b2-journal-je254");
rec(
  "journalScreen_je254",
  await a.evaluate(() =>
    document.body.innerText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 60),
  ),
);

tr = await go(a, "/app/finance/transactions", { waitMs: 9000 });
rec("acc_transactionsTrouble", tr);
await shot(a, "b3-transactions");
const txSearch = a.locator('input[type="search"], input[placeholder*="earch"]');
if (await txSearch.count()) {
  await txSearch.first().fill("ORD-20260812-0164");
  await a.waitForTimeout(5000);
}
await shot(a, "b4-transactions-0164");
rec(
  "transactionsScreen_0164",
  await a.evaluate(() =>
    document.body.innerText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 60),
  ),
);

await a.context().close();

// ───────────────────────────── CASHIER ─────────────────────────────────────
console.log("\n=== D2. cashier on takings ===");
const c = await newPage(browser);
await login(c, PEOPLE.cashier);
tr = await go(c, "/app/finance/takings", { waitMs: 8000, allowTrouble: true });
rec("cashier_takings", tr);
await shot(c, "d3-cashier-takings");
await c.context().close();

await browser.close();
console.log("\ndone -> reopen.json");
