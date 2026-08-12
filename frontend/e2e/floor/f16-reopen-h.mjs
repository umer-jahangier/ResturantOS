/*
 * F16 RE-OPEN — Stage H. The CLOSED order (0414), its printed document, and its ledger row.
 * Plus the reprint test re-run cleanly on the CLOSED bill, both halves in one run.
 */
import { newBrowser, newPage, login, go, apiGet as rawGet, apiSend as rawSend, tokenOf, log } from "../shift/lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const D = JSON.parse(readFileSync(`${OUT}/stage-d.json`, "utf8"));
const S = A.S, STD = A.STD, CAT = A.CAT, BR = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ORDER = D.orderId;                       // ORD-20260812-0414, CLOSED
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}`); };
const F = {}; const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };
async function loginRetry(page, who, n = 5) {
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
const get = (p) => rawGet(o, p, tok);
const send = (m, p, b) => rawSend(o, m, p, b, tok);

// ── H1. the closed bill ─────────────────────────────────────────────────────
log("\n=== H1. the CLOSED order ===");
const rd = (await get(`/api/v1/pos/orders/${ORDER}?branchId=${BR}`)).body?.data ?? {};
const NO = rd.orderNo ?? rd.orderNumber;
const lineView = (d) => (d.items ?? []).map((i) => ({
  n: String(i.itemNameSnapshot ?? i.itemName ?? i.name).replace(` ${S}`, ""),
  rate: i.taxRatePct, code: i.taxRateCode, label: i.taxClassName, tax: i.taxPaisa }))
  .sort((a, b) => a.n.localeCompare(b.n));
rec("closedOrder", { no: NO, status: rd.status, subtotal: rd.subtotalPaisa, discount: rd.discountPaisa,
  svc: rd.serviceChargePaisa, tax: rd.taxPaisa, total: rd.totalPaisa });
rec("closedLines", lineView(rd));
rec("lineTaxSum", lineView(rd).reduce((s, l) => s + (l.tax ?? 0), 0));

// the printed document
const jl = (await get(`/api/v1/pos/orders/${ORDER}/print-jobs`)).body?.data ?? [];
const jid = jl.length ? (jl[jl.length - 1].printJobId ?? jl[jl.length - 1].id) : null;
const readDoc = async () => {
  const dz = (await get(`/api/v1/pos/print-jobs/${jid}`)).body?.data ?? {};
  const doc = dz.document ?? dz;
  return { tax: (doc.taxBreakdown ?? []).map((t) => ({ code: t.rateCode, pct: t.ratePercent,
             amt: t.amount?.formatted ?? t.amount })),
           totals: { sub: doc.totals?.subtotal?.formatted, svc: doc.totals?.serviceCharge?.formatted,
             tax: doc.totals?.tax?.formatted, total: doc.totals?.total?.formatted } };
};
rec("printedDocBefore", jid ? await readDoc() : "no job");

// ── H2. re-rate 17 -> 3, then re-read the CLOSED bill and its paper ─────────
log("\n=== H2. re-rate to 3.00 and re-read the settled bill ===");
rec("reRate", (await send("PUT", `/api/v1/pos/tax-classes/${STD.id}`,
  { code: `RX-STD-${S}`, name: `RX Standard ${S}`, ratePct: "3.00", active: true })).status);
const menu = (await get(`/api/v1/pos/menu/items?categoryId=${CAT}&size=50`)).body?.data?.content
  ?? (await get(`/api/v1/pos/menu/items?categoryId=${CAT}&size=50`)).body?.data ?? [];
rec("menuNow", menu.map((i) => ({ n: i.name.replace(` ${S}`, ""), rate: i.effectiveTaxRatePct }))
  .sort((a, b) => a.n.localeCompare(b.n)));
const rd2 = (await get(`/api/v1/pos/orders/${ORDER}?branchId=${BR}`)).body?.data ?? {};
rec("closedOrderAfter", { tax: rd2.taxPaisa, total: rd2.totalPaisa });
rec("closedLinesAfter", lineView(rd2));
rec("printedDocAfter", jid ? await readDoc() : "no job");
await go(o, `/app/pos/orders/${ORDER}/receipt`, { waitMs: 4500, allowTrouble: true });
await shot(o, "h01-bill-while-menu-is-3pct");
rec("billOnScreenWhileMenuIs3", await o.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  const i = t.indexOf("Subtotal"); return i >= 0 ? t.slice(i, i + 260) : null;
}));

// restore
rec("restore", (await send("PUT", `/api/v1/pos/tax-classes/${STD.id}`,
  { code: `RX-STD-${S}`, name: `RX Standard ${S}`, ratePct: "17.00", active: true })).status);
await o.close();

// ── H3. the ledger ──────────────────────────────────────────────────────────
log("\n=== H3. the ledger ===");
const acc = await newPage(browser);
await loginRetry(acc, ACC);
const atok = await tokenOf(acc);
let found = null, probed = [];
for (const q of [`?search=${encodeURIComponent(NO)}&size=25`, `?q=${encodeURIComponent(NO)}&size=25`,
                 `?reference=${encodeURIComponent(NO)}`, `?size=200&sort=createdAt,desc`]) {
  const je = await rawGet(acc, `/api/v1/finance/journal-entries${q}`, atok);
  const arr = je.body?.data?.content ?? je.body?.data ?? [];
  probed.push({ q: q.slice(0, 28), status: je.status, n: Array.isArray(arr) ? arr.length : null });
  const hit = (Array.isArray(arr) ? arr : []).find((e) => JSON.stringify(e).includes(NO));
  if (hit) { found = hit; break; }
}
rec("jeProbes", probed);
rec("jeFound", found ? { id: found.id, ref: found.reference ?? found.memo ?? found.description } : "NOT FOUND");
if (found) {
  const dd = (await rawGet(acc, `/api/v1/finance/journal-entries/${found.id}`, atok)).body?.data ?? {};
  const ls = (dd.lines ?? []).map((l) => ({ acct: l.accountCode, dr: l.debitPaisa ?? 0, cr: l.creditPaisa ?? 0 }));
  const dr = ls.reduce((s, l) => s + l.dr, 0), cr = ls.reduce((s, l) => s + l.cr, 0);
  rec("journal", { status: dd.status, ref: dd.reference ?? dd.memo, lines: ls,
    drTotal: dr, crTotal: cr, balanced: dr === cr });
  await go(acc, `/app/finance/journal-entries/${found.id}`, { waitMs: 4500, allowTrouble: true });
  await shot(acc, "h02-journal");
}
await acc.close();
writeFileSync(`${OUT}/stage-h.json`, JSON.stringify({ ...F, NO, ORDER }, null, 2));
log("\nSTAGE H written");
await browser.close();
