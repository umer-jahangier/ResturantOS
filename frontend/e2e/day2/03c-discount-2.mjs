/* DAY 2 — 3b continued: the CASHIER takes an amount off one item; then the MANAGER
 * signs in and takes a percentage off the whole check. Money re-read from the server. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const OID = S.order1.id;
const B = S.branchId;
const browser = await newBrowser();

async function bill(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const g = (re) => re.exec(t)?.[1] ?? null;
    return {
      subtotal: g(/Subtotal (Rs [\d,]+\.\d\d)/),
      discounts: g(/Discounts (-?Rs ?[\d,]+\.\d\d)/),
      service: g(/Service charge \([\d.]+%\) (Rs [\d,]+\.\d\d)/),
      taxes: g(/Taxes (Rs [\d,]+\.\d\d)/),
      total: g(/Total (Rs [\d,]+\.\d\d)/),
      remaining: g(/Remaining balance (Rs [\d,]+\.\d\d)/),
      applied: document.querySelector("[data-testid=applied-discounts]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    };
  });
}
async function apply(page, { scope, type, value, reason, lineIdx }) {
  if (!(await page.locator("[data-testid=discount-panel]").count())) {
    await page.locator("[data-testid=add-discount-button]").click();
    await page.waitForTimeout(1500);
  }
  await page.locator(`[data-testid=discount-scope-${scope}]`).first().click();
  await page.waitForTimeout(900);
  if (scope === "line") {
    const sel = page.locator("[data-testid=discount-line-select]");
    const os = await sel.locator("option").allTextContents();
    log("    line options:", JSON.stringify(os));
    await sel.selectOption({ index: lineIdx ?? 1 });
    await page.waitForTimeout(700);
  }
  await page.locator(`[data-testid=discount-type-${type}]`).first().click();
  await page.waitForTimeout(500);
  await page.locator("[data-testid=discount-value-input]").fill(String(value));
  await page.waitForTimeout(400);
  await page.locator("[data-testid=discount-reason-input]").fill(reason);
  await page.waitForTimeout(700);
  const pre = await page.evaluate(() => ({
    preview: document.querySelector("[data-testid=discount-preview]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    valErr: document.querySelector("[data-testid=discount-validation-error]")?.innerText.trim() ?? null,
  }));
  log("    preview:", JSON.stringify(pre));
  await page.locator("[data-testid=apply-discount-submit]").click({ force: true }).catch(() => {});
  await page.waitForTimeout(5000);
  const res = await page.evaluate(() => ({
    serverErr: document.querySelector("[data-testid=discount-server-error]")?.innerText.trim() ?? null,
    valErr: document.querySelector("[data-testid=discount-validation-error]")?.innerText.trim() ?? null,
    panelOpen: !!document.querySelector("[data-testid=discount-panel]"),
  }));
  log("    result:", JSON.stringify(res));
  return { pre, res };
}

// ── CASHIER: one item ────────────────────────────────────────────────────────
const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const slug = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await cash.locator('input[name="email"]').first().fill(NEW.email);
await cash.locator('input[name="password"]').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);
await go(cash, `/app/pos/orders/${OID}/charge`, { waitMs: 8000 });
const b0 = await bill(cash);
log("  BILL BEFORE ANY DISCOUNT:", JSON.stringify(b0));
log("\n  --- cashier: Rs 100 off one item ---");
const lineRes = await apply(cash, { scope: "line", type: "flat", value: 100, reason: "Kebab was cold — day 2", lineIdx: 2 });
const b1 = await bill(cash);
log("  BILL AFTER LINE DISCOUNT:", JSON.stringify(b1));
await shot(cash, "03l-after-line-discount");

// ── MANAGER: whole check ─────────────────────────────────────────────────────
log("\n  --- manager: 10% off the whole check ---");
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, `/app/pos/orders/${OID}/charge`, { waitMs: 8000 });
const m0 = await bill(mgr);
log("  manager sees:", JSON.stringify(m0));
await shot(mgr, "03m-manager-charge-page");
const ordRes = await apply(mgr, { scope: "order", type: "percent", value: 10, reason: "Regular guest — 10% off, day 2" });
const m1 = await bill(mgr);
log("  BILL AFTER ORDER DISCOUNT:", JSON.stringify(m1));
await shot(mgr, "03n-after-order-discount");

const detail = await apiGet(mgr, `/api/v1/pos/orders/${OID}?branchId=${B}`);
const o = detail.body?.data ?? detail.body;
log("  SERVER:", JSON.stringify({
  sub: o?.subtotalPaisa, disc: o?.discountPaisa, svc: o?.serviceChargePaisa, tax: o?.taxPaisa, total: o?.totalPaisa,
  discounts: (o?.discounts ?? []).map((d) => ({ scope: d.scope, type: d.type, value: d.value, amt: d.amountPaisa, reason: d.reason, by: d.appliedByName ?? d.appliedBy })),
}, null, 1).slice(0, 1400));
saveState({ discountRun: { b0, lineRes, b1, ordRes, m1, server: o } });
await browser.close();
