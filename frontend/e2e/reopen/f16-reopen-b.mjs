/*
 * F16 RE-OPEN — PASS B. Ring a real check across two rates as the CASHIER, follow the money to
 * the cart, the charge page, the printed bill and the journal — and then take the adjacent path
 * the claim did not walk: apply a DISCOUNT and see whether the tax follows it.
 *
 *   node e2e/reopen/f16-reopen-b.mjs
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, tokenOf, money, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const S = "988362";
const OUT = resolve(process.cwd(), "../.planning/audits/reopen/F16");
mkdirSync(OUT, { recursive: true });
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}.png`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const browser = await newBrowser();
const cashier = await newPage(browser);
await login(cashier, PEOPLE.cashier);

log("\n=== B1. ring Alpha(17%) + Bravo x2(17%) + Charlie(0%) ===");
let tr = await go(cashier, "/app/pos", { waitMs: 6000 });
rec("posTrouble", tr.bad);
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
  await cashier.waitForTimeout(1000);
};
await tap(`ROPEN Alpha ${S}`);
await tap(`ROPEN Bravo ${S}`);
await tap(`ROPEN Bravo ${S}`);
await tap(`ROPEN Charlie ${S}`);
await cashier.waitForTimeout(900);
await shot(cashier, "b01-cart");

const readCart = async () => cashier.evaluate(() => {
  const t = document.body.innerText;
  const read = (id) => document.querySelector(`[data-testid=${id}]`)?.textContent?.trim() ?? null;
  return { tax: read("cart-tax"), total: read("cart-total"), saysEst: /\(est\.\)/i.test(t),
           subtotal: (/Subtotal\s*\n?\s*(Rs [\d,.]+)/.exec(t) ?? [])[1] ?? null,
           discount: (/Discount\s*\n?\s*(-?Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null };
});
rec("cartBeforeFire", await readCart());
rec("expected", { subtotal: "Rs 2,200.00", tax: "Rs 340.00 (17% of Rs 2,000.00)", total: "Rs 2,540.00" });

log("\n=== B2. fire, then read the server's own lines ===");
await cashier.getByRole("button", { name: /Send to Kitchen/i }).click();
await cashier.waitForTimeout(6500);
await shot(cashier, "b02-fired");
const orderId = (() => {
  const hit = [...cashier.__requests].reverse()
    .map((r) => /\/api\/v1\/pos\/orders\/([0-9a-f-]{36})\/items/.exec(r.u)).find(Boolean);
  return hit?.[1] ?? null;
})();
rec("orderId", orderId);
const token = await tokenOf(cashier);
const claims = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
const branchId = claims.branchId ?? claims.branch_id ?? claims.bid;
const readOrder = async () => {
  const r = await apiGet(cashier, `/api/v1/pos/orders/${orderId}?branchId=${branchId}`, token);
  const o = r.body?.data;
  return o && { orderNo: o.orderNo, status: o.status, subtotal: money(o.subtotalPaisa),
    discount: money(o.discountPaisa), tax: money(o.taxPaisa), total: money(o.totalPaisa),
    lines: (o.items ?? []).map((i) => ({ n: i.itemNameSnapshot?.replace(`ROPEN `, "").replace(` ${S}`, ""),
      qty: i.quantity, rate: i.taxRatePct, code: i.taxRateCode, cls: i.taxClassName,
      sub: money(i.subtotalPaisa ?? 0), disc: money(i.discountPaisa ?? 0), tax: money(i.taxPaisa) })) };
};
rec("orderAfterFire", await readOrder());

log("\n=== B3. charge page ===");
tr = await go(cashier, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
rec("chargeTrouble", tr.bad);
await shot(cashier, "b03-charge-before-discount");
const readCharge = async () => cashier.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return { tax: (/Tax[^R]*(Rs [\d,.]+)/.exec(t) ?? [])[1] ?? null,
           subtotal: (/Subtotal (Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null,
           discount: (/Discount[^R]*(-?Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null,
           total: (/Total (?:due )?(Rs [\d,.]+)/i.exec(t) ?? [])[1] ?? null,
           raw: t.slice(0, 500) };
});
rec("chargeBeforeDiscount", await readCharge());

// ── ADJACENT PATH: a 10% order discount. Tax is charged on what the guest PAYS. ──
log("\n=== B4. ADJACENT — apply a 10% order discount through the UI ===");
const addBtn = cashier.locator("[data-testid=add-discount-button]").first();
rec("discountButtonPresent", await addBtn.count());
if (await addBtn.count()) {
  await addBtn.click();
  await cashier.waitForTimeout(1200);
  await shot(cashier, "b04-discount-panel");
  const pct = cashier.locator("[data-testid=discount-type-percent]").first();
  if (await pct.count()) { await pct.click(); await cashier.waitForTimeout(400); }
  await cashier.locator("[data-testid=discount-value-input]").first().fill("10");
  const reason = cashier.locator("[data-testid=discount-reason-input]").first();
  if (await reason.count()) await reason.fill("reopen probe — tax on net?");
  await cashier.waitForTimeout(400);
  await shot(cashier, "b05-discount-filled");
  await cashier.locator("[data-testid=apply-discount-submit]").first().click();
  await cashier.waitForTimeout(4000);
  await shot(cashier, "b06-after-discount");
}
rec("chargeAfterDiscount", await readCharge());
rec("orderAfterDiscount", await readOrder());
rec("taxShouldBe", "Rs 306.00 — 17% of the Rs 1,800.00 the guest actually pays for the taxed lines");

writeFileSync(`${OUT}/reopen-b.json`, JSON.stringify({ S, orderId, F }, null, 2));
log("\nWROTE reopen-b.json  orderId=" + orderId);
await browser.close();
