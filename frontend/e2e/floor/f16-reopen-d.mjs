/*
 * F16 RE-OPEN — Stage D. Follow the money, then attack the two adjacent paths.
 *
 *   D1  Ring MY four dishes across two rates as the CASHIER. Cart tax, and no "(est.)".
 *   D2  Fire → charge page → settle CASH → printed bill. Every figure to the paisa.
 *   D3  The JOURNAL entry: debits == credits, and the tax credit equals the bill's tax.
 *   D4  THE REPRINT. Their strongest claim is that the order line SNAPSHOTS the rate. So:
 *       after the bill is closed, go and change the class's rate 17 -> 5, then REPRINT the
 *       same bill. If the snapshot is real the paper is unchanged. If it re-reads the menu,
 *       the tax on a settled bill moves — money attributed to a rate it never paid.
 *   D5  A DISCOUNT on a taxed check (V27 says tax is computed on the NET). Does the cart's
 *       number match the server's, and does the journal still balance?
 */
import { newBrowser, newPage, login, go, apiGet as rawGet, apiSend as rawSend, tokenOf, money, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
mkdirSync(OUT, { recursive: true });
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const S = A.S, STD = A.STD;
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const WHO = {
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1",
           totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  accountant: { slug: "floating-terrace", email: "accountant@terrace.local",
                password: "Terrace#Accountant1", totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C" },
};
// The owner's TOTP occasionally lands on a step boundary and the login fails. Retry rather
// than score a permission finding on a clock.
async function loginRetry(page, who, n = 3) {
  for (let i = 0; i < n; i++) {
    try { await login(page, who); return; }
    catch (e) { log(`    login retry ${i + 1} for ${who.email}`); await page.waitForTimeout(6000); }
  }
  throw new Error(`login exhausted for ${who.email}`);
}

const browser = await newBrowser();
const cashier = await newPage(browser);
await loginRetry(cashier, WHO.cashier);
const ctok = await tokenOf(cashier);

// ── D1. the cart ────────────────────────────────────────────────────────────
log("\n=== D1. ring the check ===");
rec("posTrouble", (await go(cashier, "/app/pos", { waitMs: 6000 })).bad);
const hasOpen = await cashier.evaluate(() => !!document.querySelector("[data-testid=close-till-button]"));
if (!hasOpen) {
  const b = cashier.locator("[data-testid=open-till-button]");
  if (await b.count()) {
    await b.click(); await cashier.waitForTimeout(900);
    await cashier.locator("[data-testid=open-till-panel] input").first().fill("5000");
    await cashier.locator("[data-testid=open-till-confirm-button]").click();
    await cashier.waitForTimeout(3500);
  }
}
const search = cashier.locator('input[aria-label="Search menu"]').first();
const tap = async (name) => {
  if (await search.count()) { await search.fill(name); await cashier.waitForTimeout(1500); }
  await cashier.getByRole("button", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await cashier.waitForTimeout(900);
};
// RX Alpha 500.00 @17, RX Beta 333.00 @17, RX Delta 100.00 @17, RX Gamma 200.00 @0 (override)
await tap(`RX Alpha ${S} R`);
await tap(`RX Beta ${S}`);
await tap(`RX Gamma ${S}`);
await tap(`RX Delta ${S}`);
await cashier.waitForTimeout(1000);
await shot(cashier, "d01-cart");

rec("cart", await cashier.evaluate(() => {
  const t = document.body.innerText;
  const read = (id) => document.querySelector(`[data-testid=${id}]`)?.textContent?.trim() ?? null;
  return { tax: read("cart-tax"), total: read("cart-total"), subtotal: read("cart-subtotal"),
           saysEst: /\(est\.\)/i.test(t) };
}));
// expected: subtotal 1133.00; taxed base 933.00 @17% = 158.61; gamma 200.00 @0
rec("expectedTax", money(Math.round(93300 * 17) / 100 | 0));

// ── D2. fire → charge → settle ──────────────────────────────────────────────
log("\n=== D2. fire, charge, settle ===");
await cashier.getByRole("button", { name: /Send to Kitchen/i }).click();
await cashier.waitForTimeout(6000);
await shot(cashier, "d02-fired");
const orderId = cashier.__requests.filter((r) => /\/api\/v1\/pos\/orders\/[0-9a-f-]{36}/.test(r.u))
  .map((r) => /orders\/([0-9a-f-]{36})/.exec(r.u)[1]).pop()
  ?? (await rawGet(cashier, "/api/v1/pos/orders?status=OPEN&size=5", ctok)).body?.data?.content?.[0]?.id;
rec("orderId", orderId);

const ord = await rawGet(cashier, `/api/v1/pos/orders/${orderId}`, ctok);
const od = ord.body?.data ?? ord.body ?? {};
rec("orderServer", {
  no: od.orderNumber, subtotal: od.subtotalPaisa, tax: od.taxPaisa, total: od.totalPaisa,
  lines: (od.items ?? []).map((i) => ({ n: i.itemNameSnapshot ?? i.name, q: i.quantity,
    rate: i.taxRatePct, code: i.taxRateCode, label: i.taxClassName, tax: i.taxPaisa })),
});

await go(cashier, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
await shot(cashier, "d03-charge");
rec("chargePage", await cashier.evaluate(() => {
  const t = document.body.innerText;
  const g = (re) => (re.exec(t) ?? [])[1] ?? null;
  return { tax: g(/Tax(?:es)?[^\n]*\n?\s*(Rs [\d,.]+)/i), total: g(/Total\s*\n?\s*(Rs [\d,.]+)/i) };
}));

// "Full amount" fills the payment amount from the remaining balance; "Exact" tenders it.
// Typing a number into the first decimal input lands in Amount, leaves Tendered empty, and
// Record Payment stays disabled — which is the till telling the truth, not a defect.
await cashier.getByRole("button", { name: /^full amount$/i }).first().click();
await cashier.waitForTimeout(700);
await cashier.getByRole("button", { name: /^exact$/i }).first().click();
await cashier.waitForTimeout(700);
await shot(cashier, "d04-cash");
rec("tenderPanel", await cashier.evaluate(() => {
  const t = document.body.innerText;
  const g = (re) => (re.exec(t) ?? [])[1] ?? null;
  return { changeDue: g(/Change due\s*\n?\s*(Rs [\d,.]+)/i),
           payDisabled: document.querySelector("[data-testid=record-payment-button]")?.disabled ?? null };
}));
const payBtn = cashier.locator("[data-testid=record-payment-button]").first();
if (await payBtn.count()) { await payBtn.click(); await cashier.waitForTimeout(6000); }
await shot(cashier, "d05-paid");

const closeBtn = cashier.getByRole("button", { name: /close (check|order|bill)/i }).first();
if (await closeBtn.count()) { await closeBtn.click(); await cashier.waitForTimeout(5000); }
const after = await rawGet(cashier, `/api/v1/pos/orders/${orderId}`, ctok);
const ad = after.body?.data ?? after.body ?? {};
rec("orderAfterSettle", { status: ad.status, subtotal: ad.subtotalPaisa, tax: ad.taxPaisa, total: ad.totalPaisa });

// ── D3. the printed bill, BEFORE any rate change ────────────────────────────
log("\n=== D3. the printed bill ===");
const bill1 = await rawGet(cashier, `/api/v1/pos/orders/${orderId}/receipt`, ctok);
rec("billBefore", JSON.stringify(bill1.body?.data ?? bill1.body ?? {}).slice(0, 900));
await go(cashier, `/app/pos/orders/${orderId}/receipt`, { waitMs: 4000, allowTrouble: true });
await shot(cashier, "d06-bill-before");
rec("billTextBefore", await cashier.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700)));

writeFileSync(`${OUT}/stage-d.json`, JSON.stringify({ ...F, orderId, S }, null, 2));
log("\nSTAGE D written");
await browser.close();
