/*
 * F20 re-open — final confirmation against the pos-service process running RIGHT NOW.
 *
 * A sibling agent restarted pos-service mid-audit (check-stale-jars flipped it to STALE against
 * a NEWER jar on disk). Everything above was measured on the previous process, so the whole
 * DONE MEANS is re-driven here on the current one: ring a dine-in check as the CASHIER, read the
 * service charge on the charge page BEFORE payment, settle it on a CARD with a tip, print the
 * guest's bill, close it, and read the journal entry.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, money, log } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20/reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const rec = (k, v) => { R[k] = v; log(`  [${k}]`, JSON.stringify(v)); };
const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

async function signIn(page, who, n = 4) {
  for (let i = 1; ; i += 1) { try { return await login(page, who); } catch (e) { if (i >= n) throw e; await page.waitForTimeout(6000); } }
}
const clean = (p) => p.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()));
async function tapTile(page, index) {
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 20000 });
  await tiles.nth(index).click();
  await page.waitForTimeout(700);
  const dialog = page.locator("[role=dialog]");
  if (!(await dialog.count())) return;
  const add = dialog.locator("[data-testid=modifier-dialog-add]");
  for (let r = 0; r < 6; r += 1) {
    if ((await add.getAttribute("aria-disabled")) !== "true") break;
    const gids = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid^=modifier-group-error-]"))
      .map((n) => n.getAttribute("data-testid").replace("modifier-group-error-", "")));
    if (!gids.length) break;
    for (const g of gids) {
      const o = page.locator(`[data-testid="modifier-group-${g}"] [data-testid^="modifier-option-"][aria-checked="false"]`).first();
      if (await o.count()) { await o.click(); await page.waitForTimeout(300); }
    }
  }
  await add.click({ timeout: 15000 });
  await page.waitForTimeout(900);
}

const browser = await newBrowser();
const cash = await newPage(browser);
await signIn(cash, PEOPLE.cashier);

await go(cash, "/app/pos", { waitMs: 8000 });
await clean(cash);
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(400);
await tapTile(cash, 0);
await tapTile(cash, 0);
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(6000);
const orderNo = await cash.evaluate(() => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null);
const found = await apiGet(cash, `/api/v1/pos/orders?branchId=${BRANCH}&q=${encodeURIComponent(orderNo)}&size=5`);
const row = (found.body?.data ?? []).find((r) => r.orderNo === orderNo);
const orderId = row.orderId ?? row.id;

await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
await clean(cash);
const billRows = await cash.evaluate(() => {
  const s = Array.from(document.querySelectorAll("section")).find((n) => /^Bill/.test((n.innerText || "").trim()));
  const t = s?.innerText ?? "";
  return Object.fromEntries(t.split("\n").map((l) => l.trim()).filter(Boolean)
    .reduce((acc, line, i, all) => { const m = /^(-?Rs [\d,]+\.\d\d)$/.exec(line); if (m && i > 0) acc.push([all[i - 1], m[1]]); return acc; }, []));
});
const o = (await apiGet(cash, `/api/v1/pos/orders/${orderId}?branchId=${BRANCH}`)).body?.data;
rec("charge-page-before-payment", { orderNo, billRows,
  server: { subtotal: o.subtotalPaisa, sc: o.serviceChargePaisa, pct: o.serviceChargePct, label: o.serviceChargeLabel, tax: o.taxPaisa, total: o.totalPaisa },
  screenSc: billRows["Service charge (5.00%)"], serverScFormatted: money(o.serviceChargePaisa),
  agrees: billRows["Service charge (5.00%)"] === money(o.serviceChargePaisa),
  identity: o.subtotalPaisa - o.discountPaisa + o.taxPaisa + o.serviceChargePaisa === o.totalPaisa });
await cash.screenshot({ path: `${OUT}/r18-final-charge-page.png` });

// CARD + tip, through the screen.
await cash.locator("[data-testid=tender-row]").first().waitFor({ timeout: 20000 });
await cash.locator('select[aria-label="Payment method"]').first().selectOption("CARD");
await cash.waitForTimeout(400);
await cash.locator("[data-testid=fill-full-amount-button]").first().click();
await cash.waitForTimeout(400);
await cash.locator("[data-testid=tip-input]").first().fill("120");
await cash.waitForTimeout(700);
rec("before-submit", await cash.evaluate(() => ({
  offTheCard: document.querySelector("[data-testid=tender-plus-tip-value]")?.getAttribute("data-paisa"),
  tipTotal: document.querySelector("[data-testid=tip-total-value]")?.getAttribute("data-paisa"),
})));
await cash.screenshot({ path: `${OUT}/r19-final-tip-entered.png` });
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(6000);
await clean(cash);
await cash.screenshot({ path: `${OUT}/r20-final-after-payment.png` });
const pays = (await apiGet(cash, `/api/v1/pos/orders/${orderId}/payments?branchId=${BRANCH}`)).body?.data ?? [];
rec("payments", pays.map((p) => ({ m: p.method, amt: p.amountPaisa, tip: p.tipPaisa, tendered: p.tenderedPaisa, change: p.changePaisa })));
rec("after-payment-screen", await cash.evaluate(() => ({
  amountPaid: /Amount paid\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(document.body.innerText)?.[1] ?? null,
  remaining: /Remaining balance\s*\n?\s*(-?Rs [\d,]+\.\d\d)/.exec(document.body.innerText)?.[1] ?? null,
  tipLine: document.querySelector("[data-testid=payment-history-tip]")?.textContent?.trim() ?? null,
})));

// the guest's bill
await go(cash, `/app/pos/orders/${orderId}/receipt`, { waitMs: 7000, allowTrouble: true });
await clean(cash);
rec("bill", { text: (await cash.evaluate(() => (document.body.innerText || "").replace(/\n+/g, " | "))).slice(-420) });
await cash.screenshot({ path: `${OUT}/r21-final-bill.png`, fullPage: true });

// close and read the ledger
await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
await clean(cash);
const cb = cash.locator("[data-testid=close-order-button]");
if (await cb.count()) { await cb.first().click(); await cash.waitForTimeout(5000); }
rec("status", (await apiGet(cash, `/api/v1/pos/orders/${orderId}?branchId=${BRANCH}`)).body?.data?.status);
await new Promise((r) => setTimeout(r, 10000));
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);
const je = await apiGet(own, `/api/v1/finance/journal-entries/by-source/${orderId}?sourceType=ORDER_REVENUE`);
const list = Array.isArray(je.body?.data) ? je.body.data : [je.body?.data].filter(Boolean);
const e = list[0];
rec("journal", e ? { entryNo: e.entryNo, st: e.status, dr: e.totalDebitPaisa, cr: e.totalCreditPaisa,
  balanced: e.totalDebitPaisa === e.totalCreditPaisa,
  lines: e.lines.map((l) => ({ code: l.accountCode, desc: l.description, d: l.debitPaisa, c: l.creditPaisa })) } : { none: true });
await own.screenshot({ path: `${OUT}/r22-final-owner.png` });

writeFileSync(`${OUT}/reopen-final.json`, JSON.stringify(R, null, 2));
await browser.close();
