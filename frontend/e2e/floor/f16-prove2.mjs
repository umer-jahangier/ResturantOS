/*
 * F16 PROOF, PART 2 — ring a check of three items across two rates and follow the money.
 *
 * The cart, the charge page, the printed bill and the journal entry must all agree to the
 * paisa, and the cart must no longer hedge with "(est.)".
 *
 *   node e2e/floor/f16-prove2.mjs      (run f16-prove.mjs first — it writes f16-context.json)
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, tokenOf, money, log } from "../shift/lib.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16");
mkdirSync(OUT, { recursive: true });
const ctx = JSON.parse(readFileSync(`${OUT}/f16-context.json`, "utf8"));
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
};
const findings = {};
const record = (k, v) => {
  findings[k] = v;
  log(`  ▸ ${k}: ${JSON.stringify(v)}`);
};

const browser = await newBrowser();
const cashier = await newPage(browser);
await login(cashier, PEOPLE.cashier);

// ─── The till, and the cart ───────────────────────────────────────────────────
log("\n=== 6a. Ring three items across two rates ===");
let tr = await go(cashier, "/app/pos", { waitMs: 6000 });
record("posTrouble", tr.bad);

// Open a till if the cashier has none — a cash settlement needs one.
const hasOpen = await cashier.evaluate(
  () => !!document.querySelector("[data-testid=close-till-button]"),
);
if (!hasOpen) {
  const openBtn = cashier.locator("[data-testid=open-till-button]");
  if (await openBtn.count()) {
    await openBtn.click();
    await cashier.waitForTimeout(900);
    await cashier.locator("[data-testid=open-till-panel] input").first().fill("5000");
    await cashier.locator("[data-testid=open-till-confirm-button]").click();
    await cashier.waitForTimeout(3500);
  }
}

// Find the three dishes on the real grid. Search narrows the till's own grid.
const search = cashier.locator('input[aria-label="Search menu"]').first();
const tap = async (name) => {
  if (await search.count()) {
    await search.fill(name);
    await cashier.waitForTimeout(1400);
  }
  await cashier.getByRole("button", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await cashier.waitForTimeout(900);
};
await tap(`F16 Karahi ${ctx.STAMP}`);
await tap(`F16 Biryani ${ctx.STAMP}`);
await tap(`F16 Lime ${ctx.STAMP}`);
// Second Biryani, so the check carries a qty>1 line like a real one.
await tap(`F16 Biryani ${ctx.STAMP}`);
await cashier.waitForTimeout(800);
await shot(cashier, "05a-cart-three-items");

const cart = await cashier.evaluate(() => {
  const t = document.body.innerText;
  const read = (id) => document.querySelector(`[data-testid=${id}]`)?.textContent?.trim() ?? null;
  return {
    tax: read("cart-tax"),
    total: read("cart-total"),
    saysEst: /\(est\.\)/i.test(t),
    saysEstimated: /Estimated —/i.test(t),
    subtotalRow: (/Subtotal\s*\n?\s*(Rs [\d,.]+)/.exec(t) ?? [])[1] ?? null,
  };
});
record("cartTotals", cart);

// ─── Fire, then the charge page ───────────────────────────────────────────────
log("\n=== 6b. Send to kitchen, then the charge page ===");
await cashier.getByRole("button", { name: /Send to Kitchen/i }).click();
await cashier.waitForTimeout(6000);
await shot(cashier, "05b-fired");

// The order id, taken from the till's OWN traffic rather than by searching a list. The list
// projection carries no line items, so matching on the dish name there is impossible — and
// falling back to "the newest order" would happily measure another agent's check.
const orderId = (() => {
  const hit = [...cashier.__requests]
    .reverse()
    .map((r) => /\/api\/v1\/pos\/orders\/([0-9a-f-]{36})\/items/.exec(r.u))
    .find(Boolean);
  return hit?.[1] ?? null;
})();
record("orderIdFromTillTraffic", orderId);
// branchId comes from the cashier's OWN token — the order lives on their branch, not on HQ, and
// pos-service refuses a cross-branch read (which is correct, and is why HQ's token returned an
// empty shell on the first attempt rather than another branch's money).
const token = await tokenOf(cashier);
const claims = JSON.parse(
  Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
);
const branchId = claims.branchId ?? claims.branch_id ?? claims.bid;
record("cashierBranch", branchId ?? Object.keys(claims));
const full = await apiGet(cashier, `/api/v1/pos/orders/${orderId}?branchId=${branchId}`, token);
const order = full.body?.data;
record("orderOnServer", {
  orderNo: order?.orderNo,
  subtotal: money(order?.subtotalPaisa ?? 0),
  tax: money(order?.taxPaisa ?? 0),
  total: money(order?.totalPaisa ?? 0),
  lines: (order?.items ?? []).map((i) => ({
    n: i.itemNameSnapshot?.slice(-12),
    qty: i.quantity,
    rate: i.taxRatePct,
    code: i.taxRateCode,
    cls: i.taxClassName,
    tax: money(i.taxPaisa),
  })),
});

tr = await go(cashier, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
record("chargeTrouble", tr.bad);
await shot(cashier, "05c-charge-page");
record("chargePageTax", await cashier.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    tax: (/Tax[^R]*(Rs [\d,.]+)/.exec(t) ?? [])[1] ?? null,
    total: (/Total (?:due )?(Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null,
    raw: t.slice(0, 400),
  };
}));

// ─── Settle in cash, close, then the bill and the journal ─────────────────────
log("\n=== 6c. Settle, close, print, post ===");
const fullBtn = cashier.locator("[data-testid=fill-full-amount-button]");
if (await fullBtn.count()) await fullBtn.first().click({ force: true });
await cashier.waitForTimeout(600);
const amount = cashier.locator('input[aria-label*="Amount" i]').first();
if ((await amount.count()) && !(await amount.inputValue())) {
  await amount.fill(String((order.totalPaisa / 100).toFixed(2)));
}
await shot(cashier, "05d-cash-filled");
await cashier.locator("[data-testid=record-payment-button]").first().click({ force: true });
await cashier.waitForTimeout(5000);
await shot(cashier, "05e-after-payment");

// Mark served & close.
const closeBtn = cashier.getByRole("button", { name: /Mark served & close order/i });
if (await closeBtn.count()) {
  await closeBtn.first().click({ force: true });
  await cashier.waitForTimeout(6000);
}
await shot(cashier, "05f-after-close");

const closed = await apiGet(cashier, `/api/v1/pos/orders/${orderId}?branchId=${branchId}`);
record("closedOrder", {
  status: closed.body?.data?.status,
  subtotal: money(closed.body?.data?.subtotalPaisa ?? 0),
  tax: money(closed.body?.data?.taxPaisa ?? 0),
  total: money(closed.body?.data?.totalPaisa ?? 0),
});

// The printed bill.
tr = await go(cashier, `/app/pos/orders/${orderId}/receipt`, { waitMs: 5000 });
record("receiptTrouble", tr.bad);
await shot(cashier, "06a-printed-bill");
record("billTaxLines", await cashier.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".receipt-row")).map((r) =>
    (r.textContent || "").replace(/\s+/g, " ").trim(),
  );
  return rows.filter((r) => /tax|subtotal|total/i.test(r));
}));

// The journal entry, read as the ACCOUNTANT — the persona whose job it is.
const accountant = await newPage(browser);
await login(accountant, PEOPLE.accountant);
// The ledger, as the person who reads it. Searched by ORDER NUMBER, which is how an accountant
// finds a check — F10 landed that search, so this also confirms the two features compose.
tr = await go(accountant, "/app/finance/journal-entries", { waitMs: 6000 });
record("journalTrouble", tr.bad);
const jeSearch = accountant.locator('input[type="search"], input[placeholder*="Search" i]').first();
if (await jeSearch.count()) {
  await jeSearch.fill(order?.orderNo ?? "");
  await accountant.waitForTimeout(3000);
}
await shot(accountant, "07a-journal-search");
record("journalRows", await accountant.evaluate(() =>
  Array.from(document.querySelectorAll("tbody tr"))
    .slice(0, 6)
    .map((r) => (r.textContent || "").replace(/\s+/g, " ").trim().slice(0, 150)),
));

// And the entry itself, line by line, read over HTTP as the accountant.
const list = await apiGet(accountant, "/api/v1/finance/journal-entries?size=20");
const entries = list.body?.data ?? [];
const mine = entries.find((e) => JSON.stringify(e).includes(order?.orderNo ?? "@@"));
record("journalEntryHeader", mine ? { ref: mine.reference ?? mine.memo, id: mine.id } : null);
if (mine?.id) {
  const detail = await apiGet(accountant, `/api/v1/finance/journal-entries/${mine.id}`);
  const d = detail.body?.data;
  record("journalLines", (d?.lines ?? []).map((l) => ({
    account: `${l.accountCode} ${l.accountName ?? ""}`.trim().slice(0, 28),
    dr: money(l.debitPaisa ?? 0),
    cr: money(l.creditPaisa ?? 0),
  })));
  const dr = (d?.lines ?? []).reduce((s, l) => s + (l.debitPaisa ?? 0), 0);
  const cr = (d?.lines ?? []).reduce((s, l) => s + (l.creditPaisa ?? 0), 0);
  record("journalBalanced", { debits: money(dr), credits: money(cr), equal: dr === cr });
  await go(accountant, `/app/finance/journal-entries/${mine.id}`, { waitMs: 4000 });
  await shot(accountant, "07b-journal-entry-detail");
}

writeFileSync(`${OUT}/f16-prove-part2.json`, JSON.stringify(findings, null, 2));
log("\nPART 2 COMPLETE");
await browser.close();
