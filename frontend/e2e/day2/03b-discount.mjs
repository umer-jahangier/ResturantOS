/* DAY 2 — step 3b: a discount at the charge step. Who can give one, on a FIRED check,
 * with a reason — and what the money does. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();
async function loginCashier(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(NEW.email);
  await page.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
}
async function bill(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const g = (re) => re.exec(t)?.[1] ?? null;
    return {
      subtotal: g(/Subtotal (Rs [\d,]+\.\d\d)/),
      discounts: g(/Discounts (-?Rs [\d,]+\.\d\d)/),
      service: g(/Service charge \([\d.]+%\) (Rs [\d,]+\.\d\d)/),
      taxes: g(/Taxes (Rs [\d,]+\.\d\d)/),
      total: g(/Total (Rs [\d,]+\.\d\d)/),
      remaining: g(/Remaining balance (Rs [\d,]+\.\d\d)/),
      applied: document.querySelector("[data-testid=applied-discounts]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    };
  });
}

const cash = await newPage(browser);
await loginCashier(cash);
const url = `/app/pos/orders/${S.order1.id ?? "b3e88e09-ce18-436f-8c5a-e0599c07a08e"}/charge`;
await go(cash, url, { waitMs: 8000 });
const before = await bill(cash);
log("  BILL BEFORE:", JSON.stringify(before));

await cash.locator("[data-testid=add-discount-button]").click();
await cash.waitForTimeout(1500);
await shot(cash, "03g-discount-panel");
const panel = await cash.evaluate(() => {
  const p = document.querySelector("[data-testid=discount-panel]");
  if (!p) return null;
  return {
    text: p.innerText.replace(/\s+/g, " ").trim().slice(0, 800),
    scopes: Array.from(p.querySelectorAll('[data-testid^="discount-scope-"]')).map((n) => ({
      id: n.getAttribute("data-testid"), t: n.innerText.trim(), disabled: n.getAttribute("aria-disabled") ?? n.disabled,
      pressed: n.getAttribute("aria-pressed") ?? n.getAttribute("data-state"),
    })),
    types: Array.from(p.querySelectorAll('[data-testid^="discount-type-"]')).map((n) => ({ id: n.getAttribute("data-testid"), t: n.innerText.trim() })),
    hasReason: !!p.querySelector("[data-testid=discount-reason-input]"),
    reasonPh: p.querySelector("[data-testid=discount-reason-input]")?.getAttribute("placeholder"),
    submit: p.querySelector("[data-testid=apply-discount-submit]")?.innerText.trim(),
  };
});
log("  DISCOUNT PANEL:", JSON.stringify(panel, null, 1).slice(0, 2000));

// CASHIER holds pos.order.discount.line only — try ORDER scope first, then LINE.
const REASON = "Regular guest — 10% off, day 2 walkthrough";
async function tryScope(scope, type, value) {
  const sc = cash.locator(`[data-testid=discount-scope-${scope}]`);
  if (await sc.count()) { await sc.first().click(); await cash.waitForTimeout(800); }
  if (scope === "line") {
    const lineSel = cash.locator("[data-testid=discount-line-select]");
    if (await lineSel.count()) {
      const os = await lineSel.locator("option").allTextContents();
      log("    line options:", JSON.stringify(os));
      await lineSel.selectOption({ index: os.length > 1 ? 1 : 0 });
      await cash.waitForTimeout(600);
    }
  }
  const ty = cash.locator(`[data-testid=discount-type-${type}]`);
  if (await ty.count()) { await ty.first().click(); await cash.waitForTimeout(500); }
  await cash.locator("[data-testid=discount-value-input]").fill(String(value));
  await cash.waitForTimeout(400);
  const r = cash.locator("[data-testid=discount-reason-input]");
  if (await r.count()) await r.fill(REASON);
  await cash.waitForTimeout(500);
  const pre = await cash.evaluate(() => ({
    preview: document.querySelector("[data-testid=discount-preview]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    valErr: document.querySelector("[data-testid=discount-validation-error]")?.innerText.trim() ?? null,
    submitDisabled: document.querySelector("[data-testid=apply-discount-submit]")?.getAttribute("aria-disabled"),
  }));
  log(`    ${scope}/${type}/${value} preview:`, JSON.stringify(pre));
  await shot(cash, `03h-discount-${scope}-filled`);
  await cash.locator("[data-testid=apply-discount-submit]").click({ force: true }).catch(() => {});
  await cash.waitForTimeout(4500);
  const res = await cash.evaluate(() => ({
    serverErr: document.querySelector("[data-testid=discount-server-error]")?.innerText.trim() ?? null,
    valErr: document.querySelector("[data-testid=discount-validation-error]")?.innerText.trim() ?? null,
    panelOpen: !!document.querySelector("[data-testid=discount-panel]"),
  }));
  log(`    ${scope} result:`, JSON.stringify(res));
  return res;
}

const orderTry = await tryScope("order", "percent", 10);
await shot(cash, "03i-after-order-discount");
let lineTry = null;
if (orderTry.serverErr) {
  finding({ id: "D2-DISC-ORDER", sev: "high", what: `cashier ORDER-scope discount refused: ${orderTry.serverErr}` });
  if (!(await cash.locator("[data-testid=discount-panel]").count())) {
    await cash.locator("[data-testid=add-discount-button]").click();
    await cash.waitForTimeout(1200);
  }
  lineTry = await tryScope("line", "percent", 10);
  await shot(cash, "03j-after-line-discount");
}
const after = await bill(cash);
log("  BILL AFTER:", JSON.stringify(after));
await shot(cash, "03k-bill-after-discount");

// what the server holds
const detail = await apiGet(cash, `/api/v1/pos/orders/${S.order1.id}?branchId=${S.branchId ?? "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03"}`);
const o = detail.body?.data ?? detail.body;
log("  SERVER:", JSON.stringify({
  sub: o?.subtotalPaisa, disc: o?.discountPaisa, svc: o?.serviceChargePaisa, tax: o?.taxPaisa, total: o?.totalPaisa,
  discounts: o?.discounts,
}).slice(0, 900));
saveState({ discount: { panel, before, after, orderTry, lineTry, server: { sub: o?.subtotalPaisa, disc: o?.discountPaisa, svc: o?.serviceChargePaisa, tax: o?.taxPaisa, total: o?.totalPaisa, discounts: o?.discounts } }, reasonUsed: REASON });
await browser.close();
