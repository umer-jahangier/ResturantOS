/*
 * F1 RE-OPEN — the two money invariants, re-proved on the rows THIS run created.
 *
 * The fix is display-only, but this re-open drove real cash, a real Rs 75.00 tip, a real card
 * tender and a real Rs 50.00 refund through the drawer, and then closed the till. So:
 *   1. screen ↔ persisted: what the charge page shows for the tipped check must equal the
 *      order_payments rows read back over HTTP, to the paisa;
 *   2. debits = credits on the journal entries those events posted.
 */
import { PEOPLE, newBrowser, newPage, go, apiGet, tokenOf, log, money } from "../shift/lib.mjs";
import { loginTenant as login } from "./f1-reopen-lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "../.planning/audits/floor/F1-reopen";
const M = JSON.parse(readFileSync(`${OUT}/money.json`, "utf8"));
const R = {};

const browser = await newBrowser();
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const mtok = await tokenOf(mgr);

const rec = await apiGet(mgr, `/api/v1/pos/tills/${M.tillId}/reconciliation`, mtok);
const rb = rec.body?.data ?? rec.body;
const lineA = (rb.orders ?? []).find((o) => o.orderNo === M.orderA.no);
log("  order A:", lineA?.orderNo, lineA?.orderId);

// ── 1. screen ↔ persisted ─────────────────────────────────────────────────────
const pays = await apiGet(mgr, `/api/v1/pos/orders/${lineA.orderId}/payments`, mtok);
const rows = pays.body?.data ?? pays.body ?? [];
log("  order_payments rows:", JSON.stringify(rows.map((p) => ({
  kind: p.kind, method: p.method, amt: p.amountPaisa, tip: p.tipPaisa,
  tendered: p.tenderedPaisa, change: p.changePaisa }))));
R.paymentRows = rows.map((p) => ({ kind: p.kind, method: p.method, amountPaisa: p.amountPaisa,
  tipPaisa: p.tipPaisa ?? null, tenderedPaisa: p.tenderedPaisa ?? null, changePaisa: p.changePaisa ?? null }));

await go(mgr, `/app/pos/orders/${lineA.orderId}/charge`, { waitMs: 9000 });
const onScreen = await mgr.evaluate(() => {
  const hist = document.querySelector("[data-testid=payment-history-rows]");
  return {
    historyText: hist ? hist.innerText.replace(/\s+/g, " ").trim() : null,
    tips: Array.from(document.querySelectorAll("[data-testid=payment-history-tip]"))
      .map((n) => n.innerText.replace(/\s+/g, " ").trim()),
    refundRows: Array.from(document.querySelectorAll("[data-testid=refund-history-row]"))
      .map((n) => n.innerText.replace(/\s+/g, " ").trim()),
  };
});
log("  charge screen payment history:", onScreen.historyText);
log("  tip shown:", JSON.stringify(onScreen.tips), " refund rows:", JSON.stringify(onScreen.refundRows));
R.onScreen = onScreen;
await mgr.screenshot({ path: `${OUT}/s01-charge-history.png` });

const pay = rows.find((p) => p.kind === "PAYMENT");
const refund = rows.find((p) => p.kind === "REFUND");
R.screenMatchesRows = {
  paymentAmountOnScreen: onScreen.historyText?.includes(money(pay.amountPaisa)) ?? false,
  tipOnScreen: pay.tipPaisa ? (onScreen.tips.some((t) => t.includes(money(pay.tipPaisa)))
    || (onScreen.historyText?.includes(money(pay.tipPaisa)) ?? false)) : null,
  refundOnScreen: refund ? (onScreen.refundRows.some((t) => t.includes(money(refund.amountPaisa)))) : null,
};
log("  screen ↔ rows:", JSON.stringify(R.screenMatchesRows),
    ` (payment ${money(pay.amountPaisa)}, tip ${money(pay.tipPaisa ?? 0)}, refund ${refund ? money(refund.amountPaisa) : "—"})`);

// ── 2. debits = credits ───────────────────────────────────────────────────────
const acct = await newPage(browser);
await login(acct, PEOPLE.accountant);
const atok = await tokenOf(acct);
let jes = null;
for (const path of [
  `/api/v1/finance/journal-entries?size=40`,
  `/api/v1/finance/journal-entries?page=0&size=40`,
  `/api/v1/finance/gl/journal-entries?size=40`,
]) {
  const r = await apiGet(acct, path, atok);
  log(`  ${path} → ${r.status}`);
  if (r.status === 200) { jes = r.body?.data ?? r.body; break; }
}
const list = Array.isArray(jes) ? jes : (jes?.content ?? jes?.items ?? []);
log("  journal entries returned:", list.length);
const checked = [];
for (const je of list.slice(0, 15)) {
  const id = je.id ?? je.journalEntryId;
  const d = await apiGet(acct, `/api/v1/finance/journal-entries/${id}`, atok);
  const body = d.body?.data ?? d.body;
  const lines = body?.lines ?? body?.journalLines ?? [];
  if (!lines.length) continue;
  const dr = lines.reduce((s, l) => s + (l.debitPaisa ?? 0), 0);
  const cr = lines.reduce((s, l) => s + (l.creditPaisa ?? 0), 0);
  checked.push({ ref: body.reference ?? body.memo ?? id.slice(0, 8), status: body.status,
                 debitPaisa: dr, creditPaisa: cr, balanced: dr === cr });
}
log("  JE balance check:");
for (const c of checked) log(`    ${c.ref} ${c.status} Dr ${money(c.debitPaisa)} Cr ${money(c.creditPaisa)} balanced=${c.balanced}`);
R.journalEntries = checked;
R.allBalanced = checked.length > 0 && checked.every((c) => c.balanced);
log("  ALL BALANCED:", R.allBalanced, `(${checked.length} entries)`);

writeFileSync(`${OUT}/invariants.json`, JSON.stringify(R, null, 1));
console.log("\n" + JSON.stringify(R, null, 1));
await browser.close();
