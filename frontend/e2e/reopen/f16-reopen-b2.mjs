/*
 * F16 RE-OPEN — PASS B2. Charge page, the DISCOUNT adjacency, settle, bill, journal.
 *   node e2e/reopen/f16-reopen-b2.mjs
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, tokenOf, money, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const S = "988362";
const ORDER = "239740b5-cfb2-48a0-be0f-3526de6b987d";
const OUT = resolve(process.cwd(), "../.planning/audits/reopen/F16");
mkdirSync(OUT, { recursive: true });
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}.png`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const browser = await newBrowser();
const cashier = await newPage(browser);
await login(cashier, PEOPLE.cashier);
const token = await tokenOf(cashier);
const claims = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
const branchId = claims.branchId ?? claims.branch_id ?? claims.bid;

const readOrder = async () => {
  const tk = await tokenOf(cashier);
  const r = await apiGet(cashier, `/api/v1/pos/orders/${ORDER}?branchId=${branchId}`, tk);
  const o = r.body?.data;
  return o && { orderNo: o.orderNo, status: o.status, subtotal: money(o.subtotalPaisa),
    discount: money(o.discountPaisa), tax: money(o.taxPaisa), svc: money(o.serviceChargePaisa ?? 0),
    total: money(o.totalPaisa),
    lines: (o.items ?? []).map((i) => ({ n: i.itemNameSnapshot?.replace(`ROPEN `, "").replace(` ${S}`, ""),
      qty: i.quantity, rate: i.taxRatePct, tax: money(i.taxPaisa) })) };
};
const readCharge = async () => cashier.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return { subtotal: (/Subtotal (Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null,
           discount: (/Discount[^R]*(-?Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null,
           tax: (/Tax[^R]*(Rs [\d,.]+)/.exec(t) ?? [])[1] ?? null,
           total: (/Total (?:due )?(Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null,
           raw: t.slice(0, 600) };
});

log("\n=== B3. charge page, before any discount ===");
let tr = await go(cashier, `/app/pos/orders/${ORDER}/charge`, { waitMs: 6000 });
rec("chargeTrouble", tr.bad);
await shot(cashier, "b03-charge-before-discount");
rec("chargeBefore", await readCharge());
rec("serverBefore", await readOrder());

log("\n=== B4. ADJACENT — 10% order discount through the UI ===");
const addBtn = cashier.locator("[data-testid=add-discount-button]").first();
rec("discountButtonPresent", await addBtn.count());
if (await addBtn.count()) {
  await addBtn.click(); await cashier.waitForTimeout(1400);
  await shot(cashier, "b04-discount-panel");
  const pct = cashier.locator("[data-testid=discount-type-percent]").first();
  if (await pct.count()) { await pct.click(); await cashier.waitForTimeout(400); }
  await cashier.locator("[data-testid=discount-value-input]").first().fill("10");
  const reason = cashier.locator("[data-testid=discount-reason-input]").first();
  if (await reason.count()) await reason.fill("reopen probe");
  await cashier.waitForTimeout(400);
  rec("discountPreview", await cashier.evaluate(() =>
    document.querySelector("[data-testid=discount-preview]")?.textContent?.trim() ?? null));
  await shot(cashier, "b05-discount-filled");
  await cashier.locator("[data-testid=apply-discount-submit]").first().click();
  await cashier.waitForTimeout(4500);
  await shot(cashier, "b06-after-discount");
  rec("discountServerError", await cashier.evaluate(() =>
    document.querySelector("[data-testid=discount-server-error]")?.textContent?.trim() ?? null));
}
rec("chargeAfterDiscount", await readCharge());
rec("serverAfterDiscount", await readOrder());
rec("EXPECTED_taxOnNet", "Rs 306.00 — 17% of Rs 1,800.00 net of the 10% the guest was forgiven");

writeFileSync(`${OUT}/reopen-b2.json`, JSON.stringify({ S, ORDER, F }, null, 2));
log("\nWROTE reopen-b2.json");
await browser.close();
