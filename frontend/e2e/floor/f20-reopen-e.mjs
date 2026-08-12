/*
 * F20 re-open, part E — the guest's bill, and what a REFUND does to a tipped,
 * service-charged check.
 *
 *  E1. the printed bill for the discounted + service-charged + tipped check
 *  E2. a MANAGER refunds it. What can be refunded (bill only, or bill + tip)?
 *      Does the refund's journal entry balance, and does it reverse the service charge
 *      to 4910 or dump it into sales refunds?
 *  E3. the till's expected cash after the refund
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, log } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20/reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const rec = (k, v) => { R[k] = v; log(`  [${k}]`, JSON.stringify(v)); };
const save = () => writeFileSync(`${OUT}/reopen-e.json`, JSON.stringify(R, null, 2));

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ORDER = "af087e09-9f60-4082-a500-b7e5b2727512"; // ORD-20260812-0411: 5% sc, Rs 100 discount, Rs 60 cash tip
const TILL = "42ed0480-fe85-4751-9382-078e42dd4c9f";

async function signIn(page, who, n = 3) {
  for (let i = 1; ; i += 1) { try { return await login(page, who); } catch (e) { if (i >= n) throw e; await page.waitForTimeout(4000); } }
}
const clean = (page) => page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()));

const browser = await newBrowser();

// ── E1. the guest's bill ────────────────────────────────────────────────────
log("\n=== E1. the printed bill ===");
const cash = await newPage(browser);
await signIn(cash, PEOPLE.cashier);
const t = await go(cash, `/app/pos/orders/${ORDER}/receipt`, { waitMs: 7000, allowTrouble: true });
await clean(cash);
const bill = await cash.evaluate(() => {
  const doc = document.querySelector("[data-testid=receipt-document]") ?? document.body;
  return (doc.innerText || "").replace(/\n+/g, " | ");
});
rec("E1-bill", { trouble: t, text: bill });
await cash.screenshot({ path: `${OUT}/r16-bill.png`, fullPage: true });
save();

// ── E2. the refund ──────────────────────────────────────────────────────────
log("\n=== E2. manager refunds it ===");
const mgr = await newPage(browser);
await signIn(mgr, PEOPLE.manager);
const before = (await apiGet(mgr, `/api/v1/pos/orders/${ORDER}?branchId=${BRANCH}`)).body?.data;
const paysBefore = (await apiGet(mgr, `/api/v1/pos/orders/${ORDER}/payments?branchId=${BRANCH}`)).body?.data ?? [];
rec("E2-before", {
  status: before?.status, total: before?.totalPaisa, sc: before?.serviceChargePaisa,
  payments: paysBefore.map((p) => ({ m: p.method, amt: p.amountPaisa, tip: p.tipPaisa, kind: p.kind })),
});

// Can a refund reach the tip? Ask for bill + tip and see what the server says.
const over = await apiSend(mgr, "POST", `/api/v1/pos/orders/${ORDER}/refund?branchId=${BRANCH}`,
  { refundPaisa: (before?.totalPaisa ?? 0) + 6000, reason: "re-open audit: can a refund reach the tip?", scope: "PARTIAL" });
rec("E2-refund-over-the-bill", { status: over.status, code: over.body?.error?.code ?? null,
  message: (over.body?.error?.message ?? "").slice(0, 220) });

// A partial refund of the service-charged bill.
const part = await apiSend(mgr, "POST", `/api/v1/pos/orders/${ORDER}/refund?branchId=${BRANCH}`,
  { refundPaisa: 20000, reason: "re-open audit: partial refund of a service-charged check", scope: "PARTIAL" });
rec("E2-refund-partial", { status: part.status, body: part.body?.data ?? part.body?.error ?? part.body });
save();

await new Promise((r) => setTimeout(r, 9000));

// ── the ledger for that refund ──────────────────────────────────────────────
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);
const je = await apiGet(own, `/api/v1/finance/journal-entries/by-source/${ORDER}?sourceType=ORDER_REFUND`);
const list = Array.isArray(je.body?.data) ? je.body.data : [je.body?.data].filter(Boolean);
rec("E2-refund-journal", {
  status: je.status,
  entries: list.map((e) => ({ entryNo: e.entryNo, st: e.status, dr: e.totalDebitPaisa, cr: e.totalCreditPaisa,
    balanced: e.totalDebitPaisa === e.totalCreditPaisa,
    lines: (e.lines ?? []).map((l) => ({ code: l.accountCode, desc: l.description, d: l.debitPaisa, c: l.creditPaisa })) })),
});
save();

// ── E3. the till after ──────────────────────────────────────────────────────
const recon = await apiGet(cash, `/api/v1/pos/tills/${TILL}/reconciliation?branchId=${BRANCH}`);
rec("E3-till-after-refund", {
  status: recon.status,
  cashCollectedPaisa: recon.body?.data?.cashCollectedPaisa,
  liveExpectedCashPaisa: recon.body?.data?.liveExpectedCashPaisa,
});
const after = (await apiGet(cash, `/api/v1/pos/orders/${ORDER}?branchId=${BRANCH}`)).body?.data;
rec("E3-order-after", { status: after?.status, total: after?.totalPaisa, sc: after?.serviceChargePaisa,
  scPct: after?.serviceChargePct, scLabel: after?.serviceChargeLabel });
save();

// the bill, reprinted after the refund
await go(cash, `/app/pos/orders/${ORDER}/receipt`, { waitMs: 6000, allowTrouble: true });
await clean(cash);
rec("E3-bill-after-refund", { text: (await cash.evaluate(() => (document.body.innerText || "").replace(/\n+/g, " | "))).slice(0, 1400) });
await cash.screenshot({ path: `${OUT}/r17-bill-after-refund.png`, fullPage: true });
save();

log("\ndone");
await browser.close();
