/*
 * F16 RE-OPEN — Stage E. THE REPRINT, and the ledger.
 *
 * Their strongest and least-tested claim is that `order_items` SNAPSHOTS the rate, so a bill
 * reprinted after somebody re-rates the menu still says what the guest actually paid. That is
 * exactly the kind of claim that is structurally present and behaviourally absent, so:
 *
 *   E1  read the settled order's LINE snapshots (rate / code / label) off the wire
 *   E2  issue the bill and read the tax breakdown the PRINTER gets
 *   E3  as the OWNER, re-rate the class 17.00 -> 5.00 — the thing a restaurant does in a budget
 *   E4  REPRINT the same settled bill. The paper must be UNCHANGED.
 *       And the MENU must have moved, or step E3 did nothing and E4 proves nothing.
 *   E5  restore 17.00, then read the JOURNAL: debits == credits and the tax credit == the bill.
 */
import { newBrowser, newPage, login, go, apiGet as rawGet, apiSend as rawSend, tokenOf, log } from "../shift/lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const D = JSON.parse(readFileSync(`${OUT}/stage-d.json`, "utf8"));
const S = A.S, STD = A.STD, CAT = A.CAT, ORDER = D.orderId;
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

async function loginRetry(page, who, n = 4) {
  for (let i = 0; i < n; i++) {
    try { await login(page, who); return; } catch { log(`    retry ${i + 1} ${who.email}`); await page.waitForTimeout(7000); }
  }
  throw new Error(`login exhausted ${who.email}`);
}
const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1",
                totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const ACC = { slug: "floating-terrace", email: "accountant@terrace.local",
              password: "Terrace#Accountant1", totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C" };

const browser = await newBrowser();
const o = await newPage(browser);
await loginRetry(o, OWNER);
let tok = await tokenOf(o);
const get = (p) => rawGet(o, p, tok);
const send = (m, p, b) => rawSend(o, m, p, b, tok);

// ── E1. the order's line snapshots ──────────────────────────────────────────
log("\n=== E1. line snapshots on the settled order ===");
const ord = await get(`/api/v1/pos/orders/${ORDER}`);
const od = ord.body?.data ?? ord.body ?? {};
const lineView = (d) => (d.items ?? []).map((i) => ({
  n: (i.itemNameSnapshot ?? i.name ?? "").replace(` ${S}`, ""),
  rate: i.taxRatePct, code: i.taxRateCode, label: i.taxClassName, tax: i.taxPaisa,
})).sort((a, b) => a.n.localeCompare(b.n));
rec("orderBefore", { no: od.orderNumber ?? od.orderNo, status: od.status,
  subtotal: od.subtotalPaisa, tax: od.taxPaisa, total: od.totalPaisa, lines: lineView(od) });

// ── E2. the bill the printer gets ───────────────────────────────────────────
log("\n=== E2. issue the bill ===");
const jobs = await get(`/api/v1/pos/orders/${ORDER}/print-jobs`);
const jl = jobs.body?.data ?? jobs.body ?? [];
rec("printJobCount", Array.isArray(jl) ? jl.length : null);
const taxLinesOf = (doc) => (doc?.taxBreakdown ?? doc?.document?.taxBreakdown ?? []).map((t) => ({
  code: t.rateCode, pct: t.ratePercent, amt: t.amount?.formatted ?? t.amount }));
let firstJob = Array.isArray(jl) && jl.length ? jl[jl.length - 1] : null;
if (firstJob?.id) {
  const doc = await get(`/api/v1/pos/print-jobs/${firstJob.id}`);
  const dd = doc.body?.data ?? doc.body ?? {};
  rec("billTaxLinesBefore", taxLinesOf(dd.document ?? dd));
  rec("billTotalsBefore", JSON.stringify(dd.document?.totals ?? dd.totals ?? {}).slice(0, 400));
}

// ── E3. re-rate the class 17 -> 5 ───────────────────────────────────────────
log("\n=== E3. re-rate the class 17.00 -> 5.00 ===");
const reRate = await send("PUT", `/api/v1/pos/tax-classes/${STD.id}`,
  { code: `RX-STD-${S}`, name: `RX Standard ${S}`, ratePct: "5.00", active: true });
rec("reRate", { status: reRate.status, now: reRate.body?.data?.ratePct });

// the MENU must have moved — otherwise E4 proves nothing
const menuNow = await get(`/api/v1/pos/menu/items?categoryId=${CAT}&size=50`);
const mArr = menuNow.body?.data?.content ?? menuNow.body?.data ?? [];
rec("menuAfterReRate", mArr.map((i) => ({ n: i.name.replace(` ${S}`, ""),
  rate: i.effectiveTaxRatePct, code: i.effectiveTaxRateCode })).sort((a, b) => a.n.localeCompare(b.n)));

// ── E4. the settled order and its REPRINT must be unchanged ─────────────────
log("\n=== E4. reprint the settled bill ===");
const ord2 = await get(`/api/v1/pos/orders/${ORDER}`);
const od2 = ord2.body?.data ?? ord2.body ?? {};
rec("orderAfterReRate", { tax: od2.taxPaisa, total: od2.totalPaisa, lines: lineView(od2) });

const reissue = await send("POST", `/api/v1/pos/orders/${ORDER}/print-jobs`, { reason: "REPRINT" });
rec("reissueStatus", reissue.status);
const rd = reissue.body?.data ?? reissue.body ?? {};
rec("reprintTaxLines", taxLinesOf(rd.document ?? rd));
rec("reprintTotals", JSON.stringify(rd.document?.totals ?? rd.totals ?? {}).slice(0, 400));

await go(o, `/app/pos/orders/${ORDER}/receipt`, { waitMs: 4000, allowTrouble: true });
await shot(o, "e01-reprint-after-rate-change");
rec("reprintOnScreen", await o.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  const i = t.indexOf("Subtotal");
  return i >= 0 ? t.slice(i, i + 320) : t.slice(0, 320);
}));

// ── E5. restore, then the ledger ────────────────────────────────────────────
log("\n=== E5. restore 17.00 and read the ledger ===");
const back = await send("PUT", `/api/v1/pos/tax-classes/${STD.id}`,
  { code: `RX-STD-${S}`, name: `RX Standard ${S}`, ratePct: "17.00", active: true });
rec("restored", { status: back.status, now: back.body?.data?.ratePct });
await o.close();

const acc = await newPage(browser);
await loginRetry(acc, ACC);
const atok = await tokenOf(acc);
const no = F.orderBefore?.no;
const je = await rawGet(acc, `/api/v1/finance/journal-entries?search=${encodeURIComponent(no ?? "")}&size=5`, atok);
const entries = je.body?.data?.content ?? je.body?.data ?? [];
rec("journalFound", Array.isArray(entries) ? entries.length : null);
if (Array.isArray(entries) && entries.length) {
  const e = entries[0];
  const det = await rawGet(acc, `/api/v1/finance/journal-entries/${e.id}`, atok);
  const dd = det.body?.data ?? det.body ?? {};
  const ls = (dd.lines ?? []).map((l) => ({ acct: l.accountCode, dr: l.debitPaisa, cr: l.creditPaisa }));
  const dr = ls.reduce((s, l) => s + (l.dr ?? 0), 0);
  const cr = ls.reduce((s, l) => s + (l.cr ?? 0), 0);
  rec("journal", { ref: dd.reference ?? dd.memo, status: dd.status, lines: ls, drTotal: dr, crTotal: cr, balanced: dr === cr });
  await go(acc, `/app/finance/journal-entries/${e.id}`, { waitMs: 4000, allowTrouble: true });
  await shot(acc, "e02-journal");
}
await acc.close();

writeFileSync(`${OUT}/stage-e.json`, JSON.stringify(F, null, 2));
log("\nSTAGE E written");
await browser.close();
