/* F16 RE-OPEN — Stage G. Find MY order honestly, then read line snapshots + ledger. */
import { newBrowser, newPage, login, go, apiGet as rawGet, tokenOf, log } from "../shift/lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const D = JSON.parse(readFileSync(`${OUT}/stage-d.json`, "utf8"));
const S = A.S;
const BR = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";  // Floating Terrace HQ (F-7)
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}`); };
const F = {}; const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };
async function loginRetry(page, who, n = 4) {
  for (let i = 0; i < n; i++) { try { await login(page, who); return; }
    catch { log("    retry"); await page.waitForTimeout(7000); } }
  throw new Error("login exhausted");
}
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1",
                totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const ACC = { slug: "floating-terrace", email: "accountant@terrace.local",
              password: "Terrace#Accountant1", totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C" };

const browser = await newBrowser();
const o = await newPage(browser);
await loginRetry(o, OWNER);
const tok = await tokenOf(o);

// what did the bad id actually return?
const bad = await rawGet(o, `/api/v1/pos/orders/${D.orderId}?branchId=${BR}`, tok);
rec("badIdError", JSON.stringify(bad.body).slice(0, 200));

// find my order: the one carrying my dishes, newest first
let mine = null;
for (const q of [`?branchId=${BR}&size=40&sort=createdAt,desc`, `?branchId=${BR}&status=CLOSED&size=40`, `?branchId=${BR}&size=100`]) {
  const r = await rawGet(o, `/api/v1/pos/orders${q}`, tok);
  const arr = r.body?.data?.content ?? r.body?.data ?? [];
  if (!Array.isArray(arr) || !arr.length) continue;
  rec("listSampleKeys", Object.keys(arr[0]).slice(0, 25));
  for (const row of arr) {
    const id = row.id ?? row.orderId;
    const det = await rawGet(o, `/api/v1/pos/orders/${id}?branchId=${BR}`, tok);
    const dd = det.body?.data ?? det.body ?? {};
    const its = dd.items ?? dd.orderItems ?? [];
    if (its.some((i) => String(i.itemNameSnapshot ?? i.itemName ?? i.name ?? "").includes(S))) {
      mine = { id, dd }; break;
    }
  }
  if (mine) break;
}
if (!mine) { rec("myOrder", "NOT FOUND"); }
else {
  const dd = mine.dd;
  const NO = dd.orderNumber ?? dd.orderNo;
  rec("myOrder", { id: mine.id, no: NO, status: dd.status, subtotal: dd.subtotalPaisa,
    discount: dd.discountPaisa, svc: dd.serviceChargePaisa, tax: dd.taxPaisa, total: dd.totalPaisa });
  rec("myOrderLines", (dd.items ?? []).map((i) => ({
    n: String(i.itemNameSnapshot ?? i.itemName ?? i.name).replace(` ${S}`, ""),
    qty: i.quantity, rate: i.taxRatePct, code: i.taxRateCode, label: i.taxClassName,
    tax: i.taxPaisa })).sort((a, b) => a.n.localeCompare(b.n)));

  const jobs = await rawGet(o, `/api/v1/pos/orders/${mine.id}/print-jobs`, tok);
  const jl = jobs.body?.data ?? jobs.body ?? [];
  rec("printJobKeys", Array.isArray(jl) && jl.length ? Object.keys(jl[0]) : []);
  const last = Array.isArray(jl) && jl.length ? jl[jl.length - 1] : null;
  const jid = last?.id ?? last?.printJobId;
  if (jid) {
    const doc = await rawGet(o, `/api/v1/pos/print-jobs/${jid}`, tok);
    const dz = doc.body?.data ?? doc.body ?? {};
    const document = dz.document ?? dz;
    rec("printedTaxBreakdown", (document.taxBreakdown ?? []).map((t) => ({
      code: t.rateCode, pct: t.ratePercent, amt: t.amount?.formatted ?? t.amount })));
    rec("printedTotals", { sub: document.totals?.subtotal?.formatted,
      svc: document.totals?.serviceCharge?.formatted, tax: document.totals?.tax?.formatted,
      total: document.totals?.total?.formatted });
  }
  writeFileSync(`${OUT}/my-order.json`, JSON.stringify({ id: mine.id, no: NO }, null, 2));

  await o.close();
  // ledger
  const acc = await newPage(browser);
  await loginRetry(acc, ACC);
  const atok = await tokenOf(acc);
  let found = null;
  for (const q of [`?search=${encodeURIComponent(NO)}&size=20`, "?size=200"]) {
    const je = await rawGet(acc, `/api/v1/finance/journal-entries${q}`, atok);
    const arr = je.body?.data?.content ?? je.body?.data ?? [];
    found = (Array.isArray(arr) ? arr : []).find((e) => JSON.stringify(e).includes(NO));
    if (found) break;
  }
  rec("journalMatched", found ? { id: found.id } : "NOT FOUND");
  if (found) {
    const det = await rawGet(acc, `/api/v1/finance/journal-entries/${found.id}`, atok);
    const dd2 = det.body?.data ?? det.body ?? {};
    const ls = (dd2.lines ?? []).map((l) => ({ acct: l.accountCode, dr: l.debitPaisa ?? 0, cr: l.creditPaisa ?? 0 }));
    const dr = ls.reduce((s, l) => s + l.dr, 0), cr = ls.reduce((s, l) => s + l.cr, 0);
    rec("journal", { status: dd2.status, ref: dd2.reference ?? dd2.memo ?? dd2.description,
      lines: ls, drTotal: dr, crTotal: cr, balanced: dr === cr });
    await go(acc, `/app/finance/journal-entries/${found.id}`, { waitMs: 4500, allowTrouble: true });
    await shot(acc, "g01-journal");
  }
  await acc.close();
}
writeFileSync(`${OUT}/stage-g.json`, JSON.stringify(F, null, 2));
log("\nSTAGE G written");
await browser.close();
