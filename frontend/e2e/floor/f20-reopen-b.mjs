/*
 * F20 re-open, part B — re-read the three things part A's harness asked the wrong way.
 *
 *   1. the journal entry, via /journal-entries/by-source/{orderId}
 *   2. the till the ORDER is actually bound to, and whether its expected cash carries the tip
 *   3. the charge page's bill rows, scoped so a discount REASON containing the words
 *      "service charge" cannot be mistaken for the service-charge row (part A's own bug)
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, log } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20/reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const rec = (k, v) => { R[k] = v; log(`  [${k}]`, JSON.stringify(v)); };

const ORDER = process.argv[2];
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

async function signIn(page, who, n = 3) {
  for (let i = 1; ; i += 1) {
    try { return await login(page, who); } catch (e) {
      if (i >= n) throw e; await page.waitForTimeout(4000);
    }
  }
}

const browser = await newBrowser();
const cash = await newPage(browser);
await signIn(cash, PEOPLE.cashier);

const order = (await apiGet(cash, `/api/v1/pos/orders/${ORDER}?branchId=${BRANCH}`)).body?.data;
rec("order", {
  orderNo: order?.orderNo, status: order?.status, type: order?.type,
  subtotal: order?.subtotalPaisa, discount: order?.discountPaisa, tax: order?.taxPaisa,
  sc: order?.serviceChargePaisa, scPct: order?.serviceChargePct, scLabel: order?.serviceChargeLabel,
  total: order?.totalPaisa, tillSessionId: order?.tillSessionId,
});
const payments = (await apiGet(cash, `/api/v1/pos/orders/${ORDER}/payments?branchId=${BRANCH}`)).body?.data ?? [];
rec("payments", payments.map((p) => ({ m: p.method, amt: p.amountPaisa, tip: p.tipPaisa, tendered: p.tenderedPaisa, change: p.changePaisa })));

// ── 2. the till this order is bound to ──────────────────────────────────────
const tillId = order?.tillSessionId;
if (tillId) {
  const rec1 = await apiGet(cash, `/api/v1/pos/tills/${tillId}/reconciliation?branchId=${BRANCH}`);
  const d = rec1.body?.data;
  const line = (d?.orders ?? []).find((o) => o.orderId === ORDER);
  rec("till", {
    status: rec1.status,
    tillId,
    cashCollectedPaisa: d?.cashCollectedPaisa,
    nonCashCollectedPaisa: d?.nonCashCollectedPaisa,
    liveExpectedCashPaisa: d?.liveExpectedCashPaisa,
    openingFloatPaisa: d?.session?.openingFloatPaisa,
    orderCount: d?.orderCount,
    thisOrderLine: line ?? null,
  });
  // What the drawer physically holds for this check: amount + tip − change.
  const p = payments.find((x) => x.method === "CASH");
  if (p) {
    rec("till-expectation-for-this-check", {
      amount: p.amountPaisa, tip: p.tipPaisa, change: p.changePaisa,
      inDrawerForThisCheck: p.amountPaisa + p.tipPaisa - p.changePaisa,
    });
  }
} else {
  rec("till", { none: true, note: "order carries no tillSessionId" });
}

// ── 1. the journal entry, asked correctly ───────────────────────────────────
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);
const bySource = await apiGet(own, `/api/v1/finance/journal-entries/by-source/${ORDER}?sourceType=ORDER_REVENUE`);
const list = Array.isArray(bySource.body?.data) ? bySource.body.data : [bySource.body?.data].filter(Boolean);
rec("journal", {
  status: bySource.status,
  entries: list.map((je) => ({
    entryNo: je.entryNo, st: je.status, dr: je.totalDebitPaisa, cr: je.totalCreditPaisa,
    balanced: je.totalDebitPaisa === je.totalCreditPaisa,
    lines: (je.lines ?? []).map((l) => ({ code: l.accountCode, desc: l.description, d: l.debitPaisa, c: l.creditPaisa })),
  })),
});
const je = list[0];
if (je) {
  const cr = (code) => (je.lines ?? []).filter((l) => l.accountCode === code).reduce((a, l) => a + l.creditPaisa, 0);
  rec("journal-attribution", {
    cr4910: cr("4910"), wantSc: order?.serviceChargePaisa,
    cr2330: cr("2330"), wantTip: payments.reduce((a, p) => a + (p.tipPaisa ?? 0), 0),
    cr4100: cr("4100"), wantNetSales: (order?.subtotalPaisa ?? 0) - (order?.discountPaisa ?? 0),
    balanced: je.totalDebitPaisa === je.totalCreditPaisa,
  });
}

// ── 3. the bill rows, scoped so a discount REASON cannot pose as the charge ──
await go(cash, `/app/pos/orders/${ORDER}/charge`, { waitMs: 5000 });
await cash.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()));
const bill = await cash.evaluate(() => {
  const el = document.querySelector('[data-testid="service-charge-row"]')
    ?? Array.from(document.querySelectorAll("[data-testid]")).find((n) => /service-charge/i.test(n.getAttribute("data-testid")));
  const section = Array.from(document.querySelectorAll("section")).find((s) => /^Bill/.test((s.innerText || "").trim()));
  return {
    serviceChargeTestId: el?.getAttribute("data-testid") ?? null,
    serviceChargePaisaAttr: el?.getAttribute("data-paisa") ?? null,
    serviceChargeText: el?.textContent?.trim() ?? null,
    billText: (section?.innerText ?? "").replace(/\n+/g, " | "),
  };
});
rec("charge-page-bill", bill);
await cash.screenshot({ path: `${OUT}/r11-bill-rows.png` });

writeFileSync(`${OUT}/reopen-b.json`, JSON.stringify(R, null, 2));
await browser.close();
