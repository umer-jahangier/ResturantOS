/*
 * F20 re-open, part F — the tender guard, and the state I leave behind.
 *
 * A tip is only meaningful on a tender that moves money now. Does the SERVER refuse one on
 * CHARGE_TO_ACCOUNT / LOYALTY_POINTS, or does the UI merely hide the box?
 * And: a negative tip.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, log } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20/reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const rec = (k, v) => { R[k] = v; log(`  [${k}]`, JSON.stringify(v)); };

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
async function signIn(page, who, n = 3) {
  for (let i = 1; ; i += 1) { try { return await login(page, who); } catch (e) { if (i >= n) throw e; await page.waitForTimeout(4000); } }
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
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(6000);
const orderNo = await cash.evaluate(() => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null);
const found = await apiGet(cash, `/api/v1/pos/orders?branchId=${BRANCH}&q=${encodeURIComponent(orderNo)}&size=5`);
const row = (found.body?.data ?? []).find((r) => r.orderNo === orderNo);
const orderId = row.orderId ?? row.id;
const order = (await apiGet(cash, `/api/v1/pos/orders/${orderId}?branchId=${BRANCH}`)).body?.data;
rec("order", { orderNo, total: order?.totalPaisa, sc: order?.serviceChargePaisa });

const probes = [
  ["negative tip on CASH", { method: "CASH", amountPaisa: order.totalPaisa, tipPaisa: -5000, tenderedPaisa: order.totalPaisa }],
  ["tip on CHARGE_TO_ACCOUNT", { method: "CHARGE_TO_ACCOUNT", amountPaisa: order.totalPaisa, tipPaisa: 5000 }],
  ["tip on LOYALTY_POINTS", { method: "LOYALTY_POINTS", amountPaisa: order.totalPaisa, tipPaisa: 5000 }],
  ["tendered below amount+tip on CASH", { method: "CASH", amountPaisa: order.totalPaisa, tipPaisa: 5000, tenderedPaisa: order.totalPaisa }],
];
for (const [name, body] of probes) {
  const r = await apiSend(cash, "POST", `/api/v1/pos/orders/${orderId}/payments?branchId=${BRANCH}`, body);
  rec(name, { status: r.status, code: r.body?.error?.code ?? r.body?.code ?? null,
    field: r.body?.error?.details?.[0]?.field ?? null,
    message: (r.body?.error?.message ?? "").slice(0, 200),
    persisted: r.status === 200 ? (r.body?.data ?? null) : null });
}
const pays = (await apiGet(cash, `/api/v1/pos/orders/${orderId}/payments?branchId=${BRANCH}`)).body?.data ?? [];
rec("payments-after-probes", pays.map((p) => ({ m: p.method, amt: p.amountPaisa, tip: p.tipPaisa, tendered: p.tenderedPaisa, change: p.changePaisa })));

// final policy state left behind
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);
rec("final-policy", (await apiGet(own, `/api/v1/pos/branches/${BRANCH}/service-charge`)).body?.data);

writeFileSync(`${OUT}/reopen-f.json`, JSON.stringify(R, null, 2));
await browser.close();
