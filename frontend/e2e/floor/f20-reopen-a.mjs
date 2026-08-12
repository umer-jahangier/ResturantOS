/*
 * F20 — INDEPENDENT RE-OPEN, part A.
 *
 * Not a re-run of the author's proof. This drives the paths the proof did NOT:
 *
 *   A1. OWNER reads the live policy, sets a known state (5%, DINE-IN ONLY), then RELOADS
 *       and re-reads the form — persistence, not just a 200.
 *   B.  CASHIER rings a TAKEAWAY check. The policy does not cover takeaway, so there must be
 *       NO service-charge line anywhere — the channel gate, which the proof never exercised.
 *   C.  OWNER switches takeaway ON. A new takeaway check must now carry the charge.
 *   D.  CASHIER rings a DINE-IN check and takes a DISCOUNT on it. The charge must re-base on
 *       the net-of-discount subtotal, on the screen and on the server.
 *   E.  CASH tender with a TIP and CHANGE: change == tendered − amount − tip on screen and in
 *       order_payments, and the till's expected cash must include the tip.
 *   F.  Close → journal entry: 4910 == serviceCharge, 2330 == tip, DR == CR.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, money, log,
} from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20/reopen");
mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
};
const R = { steps: {}, breaks: [] };
const record = (k, v) => { R.steps[k] = v; log(`  [${k}]`, JSON.stringify(v)); };
const breakage = (what, detail) => { R.breaks.push({ what, detail }); log(`  !! BREAK ${what}:`, JSON.stringify(detail)); };
const save = () => writeFileSync(`${OUT}/reopen-a.json`, JSON.stringify(R, null, 2));

async function signIn(page, who, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try { return await login(page, who); }
    catch (err) {
      if (i >= attempts) throw err;
      log(`  ! sign-in attempt ${i} failed (${err.message}); retry`);
      await page.waitForTimeout(4000);
    }
  }
}
async function clearDevOverlay(page) {
  await page.evaluate(() => { document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()); });
}
async function tapTile(page, index) {
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 20000 });
  await tiles.nth(index).click();
  await page.waitForTimeout(700);
  const dialog = page.locator("[role=dialog]");
  if (!(await dialog.count())) return;
  const add = dialog.locator("[data-testid=modifier-dialog-add]");
  for (let round = 0; round < 6; round += 1) {
    const blocked = await add.getAttribute("aria-disabled");
    if (blocked !== "true") break;
    const groupIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-testid^=modifier-group-error-]"))
        .map((n) => n.getAttribute("data-testid").replace("modifier-group-error-", "")));
    if (groupIds.length === 0) break;
    for (const gid of groupIds) {
      const option = page.locator(`[data-testid="modifier-group-${gid}"] [data-testid^="modifier-option-"][aria-checked="false"]`).first();
      if (await option.count()) { await option.click(); await page.waitForTimeout(300); }
    }
  }
  await add.click({ timeout: 15000 });
  await page.waitForTimeout(900);
}
async function fireAndFindCheck(page, branchId) {
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(6000);
  const orderNo = await page.evaluate(() => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null);
  if (!orderNo) throw new Error("no order number after Send to Kitchen");
  const found = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&q=${encodeURIComponent(orderNo)}&size=5`);
  const row = (found.body?.data ?? []).find((r) => r.orderNo === orderNo);
  if (!row) throw new Error(`server does not have ${orderNo}`);
  return { orderNo, orderId: row.orderId ?? row.id };
}
/** The BILL section of the charge page, as a cashier reads it. */
async function billProbe(page) {
  return page.evaluate(() => {
    const bill = Array.from(document.querySelectorAll("section")).find((s) => /^Bill/.test((s.innerText || "").trim()));
    const t = bill?.innerText ?? "";
    const rows = Object.fromEntries(t.split("\n").map((l) => l.trim()).filter(Boolean)
      .reduce((acc, line, i, all) => {
        const m = /^(-?Rs [\d,]+\.\d\d)$/.exec(line);
        if (m && i > 0) acc.push([all[i - 1], m[1]]);
        return acc;
      }, []));
    const scKey = Object.keys(rows).find((k) => /service charge/i.test(k)) ?? null;
    return {
      billText: t.replace(/\n+/g, " | "),
      rows,
      serviceChargeCaption: scKey,
      serviceChargeValue: scKey ? rows[scKey] : null,
      anyServiceChargeTextInBill: /service charge/i.test(t),
      tipInputPresent: !!document.querySelector("[data-testid=tip-input]"),
    };
  });
}
async function setPolicy(page, branchId, body) {
  const r = await apiSend(page, "PUT", `/api/v1/pos/branches/${branchId}/service-charge`, body);
  return { status: r.status, body: r.body?.data ?? r.body };
}

const browser = await newBrowser();

// ── A1. OWNER: known state, then a hard reload ───────────────────────────────
log("\n=== A1. OWNER sets 5% DINE-IN ONLY, then reloads ===");
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);
const branches = await apiGet(own, "/api/v1/branches/mine");
const branchId = (branches.body?.data ?? [])[0]?.id;
record("branch", { branchId, count: (branches.body?.data ?? []).length });

const liveBefore = await apiGet(own, `/api/v1/pos/branches/${branchId}/service-charge`);
record("A1-live-state-found", { status: liveBefore.status, body: liveBefore.body?.data });

let tr = await go(own, "/app/settings/service-charge", { waitMs: 2500, allowTrouble: true });
await clearDevOverlay(own);
await own.locator("[data-testid=service-charge-enabled]").waitFor({ timeout: 30000 });
record("A1-screen-trouble", tr);

// Set the known state through the SCREEN, as a person does.
const isOn = await own.evaluate(() => document.querySelector("[data-testid=service-charge-enabled]")?.checked);
if (!isOn) await own.locator("[data-testid=service-charge-enabled]").check();
await own.locator("[data-testid=service-charge-rate]").fill("5");
await own.locator("[data-testid=service-charge-label]").fill("Service charge");
// dine-in ON, takeaway OFF, pickup OFF
for (const [tid, want] of [["service-charge-dineIn", true], ["service-charge-takeaway", false], ["service-charge-pickup", false]]) {
  const el = own.locator(`[data-testid=${tid}]`);
  if (await el.count()) {
    const now = await el.first().isChecked().catch(() => null);
    if (now !== null && now !== want) await el.first().click();
  }
}
await own.waitForTimeout(400);
await own.locator("[data-testid=service-charge-save]").click();
await own.waitForTimeout(3000);
await shot(own, "r01-owner-saved-5pct-dinein");

// PERSIST: full reload, re-read the form off the wire.
// Retried: the dev server recompiles this route under ten agents and a cold compile can outrun
// a single wait. A timeout there is the harness's weather, not the product's.
for (let attempt = 1; attempt <= 3; attempt += 1) {
  await own.goto("http://localhost:3000/app/settings/service-charge", { waitUntil: "domcontentloaded" });
  await own.waitForTimeout(4000);
  await clearDevOverlay(own);
  try {
    await own.locator("[data-testid=service-charge-enabled]").waitFor({ timeout: 30000 });
    break;
  } catch (e) {
    log(`  ! reload attempt ${attempt}: form did not mount`, JSON.stringify(await own.evaluate(() => ({
      url: location.href, head: (document.body.innerText || "").slice(0, 200),
    }))));
    if (attempt === 3) { await shot(own, "rXX-reload-failed"); throw e; }
  }
}
const afterReload = await own.evaluate(() => ({
  enabled: document.querySelector("[data-testid=service-charge-enabled]")?.checked ?? null,
  rate: document.querySelector("[data-testid=service-charge-rate]")?.value ?? null,
  label: document.querySelector("[data-testid=service-charge-label]")?.value ?? null,
  dineIn: document.querySelector("[data-testid=service-charge-dineIn]")?.checked ?? null,
  takeaway: document.querySelector("[data-testid=service-charge-takeaway]")?.checked ?? null,
  pickup: document.querySelector("[data-testid=service-charge-pickup]")?.checked ?? null,
}));
record("A1-after-reload", afterReload);
await shot(own, "r02-after-reload");
if (!afterReload.enabled || afterReload.rate !== "5") breakage("policy did not persist across reload", afterReload);
save();

// ── B. CASHIER rings a TAKEAWAY check — the channel the policy excludes ──────
log("\n=== B. CASHIER rings a TAKEAWAY check (policy is dine-in only) ===");
const cash = await newPage(browser);
await signIn(cash, PEOPLE.cashier);
tr = await go(cash, "/app/pos", { waitMs: 8000 });
await clearDevOverlay(cash);
if (tr.bad.length) throw new Error(`/app/pos broken: ${tr.bad.join(",")}`);

await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(500);
await tapTile(cash, 0);
const takeaway = await fireAndFindCheck(cash, branchId);
record("B-takeaway-order", takeaway);
await go(cash, `/app/pos/orders/${takeaway.orderId}/charge`, { waitMs: 5000 });
await clearDevOverlay(cash);
const bTakeaway = await billProbe(cash);
record("B-takeaway-charge-page", bTakeaway);
await shot(cash, "r03-takeaway-no-service-charge");
const bServer = (await apiGet(cash, `/api/v1/pos/orders/${takeaway.orderId}?branchId=${branchId}`)).body?.data;
record("B-takeaway-server", {
  type: bServer?.type, subtotalPaisa: bServer?.subtotalPaisa,
  serviceChargePaisa: bServer?.serviceChargePaisa, serviceChargePct: bServer?.serviceChargePct,
  serviceChargeLabel: bServer?.serviceChargeLabel, totalPaisa: bServer?.totalPaisa,
});
if (bTakeaway.anyServiceChargeTextInBill) breakage("takeaway check shows a service-charge line for a dine-in-only policy", bTakeaway);
if ((bServer?.serviceChargePaisa ?? 0) !== 0) breakage("takeaway check was charged", bServer);
save();

// ── C. OWNER turns takeaway ON; a new takeaway check must carry the charge ───
log("\n=== C. OWNER extends the policy to takeaway ===");
const onTakeaway = await setPolicy(own, branchId, {
  enabled: true, ratePct: 5, label: "Service charge", dineIn: true, takeaway: true, pickup: false,
});
record("C-policy-now", onTakeaway);
await go(cash, "/app/pos", { waitMs: 7000 });
await clearDevOverlay(cash);
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(500);
await tapTile(cash, 0);
const takeaway2 = await fireAndFindCheck(cash, branchId);
await go(cash, `/app/pos/orders/${takeaway2.orderId}/charge`, { waitMs: 5000 });
await clearDevOverlay(cash);
const cProbe = await billProbe(cash);
const cServer = (await apiGet(cash, `/api/v1/pos/orders/${takeaway2.orderId}?branchId=${branchId}`)).body?.data;
record("C-takeaway-now-charged", {
  orderNo: takeaway2.orderNo, caption: cProbe.serviceChargeCaption, value: cProbe.serviceChargeValue,
  serverSc: cServer?.serviceChargePaisa, subtotal: cServer?.subtotalPaisa, total: cServer?.totalPaisa,
});
await shot(cash, "r04-takeaway-now-charged");
if ((cServer?.serviceChargePaisa ?? 0) <= 0) breakage("takeaway=true did not apply the charge", cServer);
save();

// restore dine-in only for the rest of the drive
await setPolicy(own, branchId, { enabled: true, ratePct: 5, label: "Service charge", dineIn: true, takeaway: false, pickup: false });

// ── D. DINE-IN + DISCOUNT: the charge must re-base ───────────────────────────
log("\n=== D. CASHIER rings a dine-in check and discounts it ===");
await go(cash, "/app/pos", { waitMs: 7000 });
await clearDevOverlay(cash);
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(500);
await tapTile(cash, 0);
await tapTile(cash, 0);
const dine = await fireAndFindCheck(cash, branchId);
record("D-order", dine);
await go(cash, `/app/pos/orders/${dine.orderId}/charge`, { waitMs: 5000 });
await clearDevOverlay(cash);
const dBefore = await billProbe(cash);
const dServerBefore = (await apiGet(cash, `/api/v1/pos/orders/${dine.orderId}?branchId=${branchId}`)).body?.data;
record("D-before-discount", {
  caption: dBefore.serviceChargeCaption, value: dBefore.serviceChargeValue,
  subtotal: dServerBefore?.subtotalPaisa, sc: dServerBefore?.serviceChargePaisa,
  tax: dServerBefore?.taxPaisa, total: dServerBefore?.totalPaisa,
  expectedSc: Math.round((dServerBefore?.subtotalPaisa ?? 0) * 5 / 100),
});
await shot(cash, "r05-dinein-before-discount");
save();

// Apply an ORDER-scope discount of Rs 100 through the screen.
const openDiscount = cash.locator("[data-testid=add-discount-button]");
if (await openDiscount.count()) {
  await openDiscount.first().click();
  await cash.waitForTimeout(1200);
  await clearDevOverlay(cash);
  // LINE scope — the one a CASHIER holds. Pick the only line on the check.
  await cash.locator("[data-testid=discount-scope-line]").click();
  await cash.waitForTimeout(300);
  const sel = cash.locator("[data-testid=discount-line-select]");
  const opts = await sel.locator("option").all();
  const firstReal = (await Promise.all(opts.map((o) => o.getAttribute("value")))).find((v) => v);
  await sel.selectOption(firstReal);
  await cash.waitForTimeout(300);
  await cash.locator("[data-testid=discount-type-flat]").click();
  await cash.waitForTimeout(200);
  await cash.locator("[data-testid=discount-value-input]").fill("100");
  await cash.locator("[data-testid=discount-reason-input]").fill("re-open audit: re-base the service charge");
  await cash.waitForTimeout(500);
  await shot(cash, "r06-discount-panel");
  const submitState = await cash.evaluate(() => ({
    disabled: document.querySelector("[data-testid=apply-discount-submit]")?.disabled,
    err: document.querySelector("[data-testid=discount-validation-error]")?.textContent?.trim() ?? null,
    preview: document.querySelector("[data-testid=discount-preview]")?.textContent?.trim() ?? null,
  }));
  record("D-discount-submit-state", submitState);
  await cash.locator("[data-testid=apply-discount-submit]").click({ timeout: 20000 });
  await cash.waitForTimeout(4500);
  await clearDevOverlay(cash);
}
const dAfter = await billProbe(cash);
const dServerAfter = (await apiGet(cash, `/api/v1/pos/orders/${dine.orderId}?branchId=${branchId}`)).body?.data;
const expectedScAfter = Math.round(((dServerAfter?.subtotalPaisa ?? 0) - (dServerAfter?.discountPaisa ?? 0)) * 5 / 100);
record("D-after-discount", {
  screenCaption: dAfter.serviceChargeCaption, screenValue: dAfter.serviceChargeValue,
  subtotal: dServerAfter?.subtotalPaisa, discount: dServerAfter?.discountPaisa,
  sc: dServerAfter?.serviceChargePaisa, tax: dServerAfter?.taxPaisa, total: dServerAfter?.totalPaisa,
  expectedSc: expectedScAfter,
  scMatchesNetOfDiscount: dServerAfter?.serviceChargePaisa === expectedScAfter,
  totalIdentity: (dServerAfter?.subtotalPaisa ?? 0) - (dServerAfter?.discountPaisa ?? 0)
    + (dServerAfter?.taxPaisa ?? 0) + (dServerAfter?.serviceChargePaisa ?? 0) === dServerAfter?.totalPaisa,
  screenAgreesWithServer: dAfter.serviceChargeValue === money(dServerAfter?.serviceChargePaisa ?? 0),
});
await shot(cash, "r07-dinein-after-discount");
if (dServerAfter?.serviceChargePaisa !== expectedScAfter) breakage("service charge did not re-base on the discounted subtotal", { got: dServerAfter?.serviceChargePaisa, want: expectedScAfter });
if (dAfter.serviceChargeValue !== money(dServerAfter?.serviceChargePaisa ?? 0)) breakage("screen and server disagree on the service charge", { screen: dAfter.serviceChargeValue, server: dServerAfter?.serviceChargePaisa });
save();

// ── E. CASH tender with a TIP and CHANGE ────────────────────────────────────
log("\n=== E. CASH tender: tip AND change ===");
const total = dServerAfter?.totalPaisa ?? 0;
const tipRs = 60;
const tenderedRs = Math.ceil((total / 100 + tipRs) / 100) * 100 + 100; // a round note comfortably above
// till state before
const tills = await apiGet(cash, `/api/v1/pos/tills?branchId=${branchId}&status=OPEN&size=10`);
const openTill = (tills.body?.data ?? []).find((t) => t.status === "OPEN");
const tillBefore = openTill
  ? await apiGet(cash, `/api/v1/pos/tills/${openTill.id}/reconciliation?branchId=${branchId}`)
  : { status: null, body: null };
record("E-till-before", { tillId: openTill?.id ?? null, status: tillBefore.status,
  cashPaisa: tillBefore.body?.data?.cashPaisa, live: tillBefore.body?.data?.liveExpectedCashPaisa });

await cash.locator("[data-testid=tender-row]").first().waitFor({ timeout: 20000 });
// method: CASH
await cash.locator('select[aria-label="Payment method"]').first().selectOption("CASH");
await cash.waitForTimeout(400);
await cash.locator("[data-testid=fill-full-amount-button]").first().click();
await cash.waitForTimeout(500);
const tipBox = cash.locator("[data-testid=tip-input]").first();
await tipBox.fill(String(tipRs));
await cash.waitForTimeout(500);
// tendered
const tenderedBox = cash.locator('input[aria-label="Tendered (Rs)"]').first();
if (await tenderedBox.count()) { await tenderedBox.fill(String(tenderedRs)); await cash.waitForTimeout(700); }
const preSubmit = await cash.evaluate(() => ({
  changeDue: document.querySelector("[data-testid=change-due-value]")?.getAttribute("data-paisa"),
  changeDueTotal: document.querySelector("[data-testid=change-due-total]")?.getAttribute("data-paisa"),
  tenderPlusTip: document.querySelector("[data-testid=tender-plus-tip-value]")?.getAttribute("data-paisa"),
  tipTotal: document.querySelector("[data-testid=tip-total-value]")?.getAttribute("data-paisa"),
  tenderTotal: document.querySelector("[data-testid=tender-total-value]")?.getAttribute("data-paisa"),
  balanceAfter: document.querySelector("[data-testid=balance-after-tender-value]")?.getAttribute("data-paisa"),
  short: !!document.querySelector("[data-testid=tender-short-message]"),
}));
record("E-pre-submit", { total, tipPaisa: tipRs * 100, tenderedPaisa: tenderedRs * 100, ...preSubmit,
  expectedChange: tenderedRs * 100 - total - tipRs * 100 });
await shot(cash, "r08-cash-tip-and-change");
await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(5000);
await clearDevOverlay(cash);
await shot(cash, "r09-after-cash-payment");
const payments = (await apiGet(cash, `/api/v1/pos/orders/${dine.orderId}/payments?branchId=${branchId}`)).body?.data ?? [];
record("E-server-payments", payments.map((p) => ({
  method: p.method, amountPaisa: p.amountPaisa, tipPaisa: p.tipPaisa,
  tenderedPaisa: p.tenderedPaisa, changePaisa: p.changePaisa,
  identity: p.tenderedPaisa === p.amountPaisa + (p.tipPaisa ?? 0) + p.changePaisa,
})));
const pay = payments[0];
if (pay && pay.tenderedPaisa !== pay.amountPaisa + (pay.tipPaisa ?? 0) + pay.changePaisa) {
  breakage("tendered != amount + tip + change on the persisted row", pay);
}
if (pay && String(preSubmit.changeDue) !== String(pay.changePaisa)) {
  breakage("change on screen != change persisted", { screen: preSubmit.changeDue, server: pay.changePaisa });
}
const afterPaid = await cash.evaluate(() => {
  const t = document.body.innerText;
  return {
    amountPaid: /Amount paid\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    remaining: /Remaining balance\s*\n?\s*(-?Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    tipLine: document.querySelector("[data-testid=payment-history-tip]")?.textContent?.trim() ?? null,
    tipPaisa: document.querySelector("[data-testid=payment-history-tip]")?.getAttribute("data-paisa") ?? null,
  };
});
record("E-after-payment-screen", afterPaid);
if (afterPaid.amountPaid !== money(total)) breakage("Amount paid is not the bill", { screen: afterPaid.amountPaid, want: money(total) });
save();

// the till must now expect the tip too
const tillAfter = openTill
  ? await apiGet(cash, `/api/v1/pos/tills/${openTill.id}/reconciliation?branchId=${branchId}`)
  : { status: null, body: null };
record("E-till-after", {
  status: tillAfter.status,
  cashPaisa: tillAfter.body?.data?.cashPaisa,
  liveExpectedCashPaisa: tillAfter.body?.data?.liveExpectedCashPaisa,
  deltaCash: (tillAfter.body?.data?.cashPaisa ?? 0) - (tillBefore.body?.data?.cashPaisa ?? 0),
  wantDelta: total + tipRs * 100 - (pay?.changePaisa ?? 0),
});
save();

// ── F. close it and read the ledger ─────────────────────────────────────────
log("\n=== F. close the check and read the journal entry ===");
await go(cash, `/app/pos/orders/${dine.orderId}/charge`, { waitMs: 5000 });
await clearDevOverlay(cash);
const closeBtn = cash.locator("[data-testid=close-order-button]");
let closeStatus = "no-button";
if (await closeBtn.count()) {
  await closeBtn.first().click();
  await cash.waitForTimeout(5000);
  await clearDevOverlay(cash);
  closeStatus = await cash.evaluate(() =>
    document.querySelector("[data-testid=charge-closed-chip]")?.textContent?.trim()
    ?? document.querySelector("[data-testid=close-order-error]")?.textContent?.trim() ?? "?");
}
const orderNow = (await apiGet(cash, `/api/v1/pos/orders/${dine.orderId}?branchId=${branchId}`)).body?.data;
record("F-close", { closeStatus, status: orderNow?.status });
await shot(cash, "r09b-closed");
await new Promise((r) => setTimeout(r, 9000));
const jes = await apiGet(own, `/api/v1/finance/journal-entries?sourceType=ORDER_REVENUE&sourceId=${dine.orderId}`);
const je = (jes.body?.data ?? [])[0];
record("F-journal", je ? {
  entryNo: je.entryNo, status: je.status, dr: je.totalDebitPaisa, cr: je.totalCreditPaisa,
  balanced: je.totalDebitPaisa === je.totalCreditPaisa,
  lines: je.lines.map((l) => ({ code: l.accountCode, d: l.debitPaisa, c: l.creditPaisa })),
} : { none: true, status: jes.status, body: jes.body });
if (!je) breakage("no journal entry for the closed, tipped, discounted, service-charged order", { status: jes.status });
else {
  const cr4910 = je.lines.filter((l) => l.accountCode === "4910").reduce((a, l) => a + l.creditPaisa, 0);
  const cr2330 = je.lines.filter((l) => l.accountCode === "2330").reduce((a, l) => a + l.creditPaisa, 0);
  record("F-attribution", { cr4910, wantSc: dServerAfter?.serviceChargePaisa, cr2330, wantTip: tipRs * 100 });
  if (cr4910 !== dServerAfter?.serviceChargePaisa) breakage("4910 credit != the order's service charge", { cr4910, want: dServerAfter?.serviceChargePaisa });
  if (cr2330 !== tipRs * 100) breakage("2330 credit != the tip", { cr2330, want: tipRs * 100 });
  if (je.totalDebitPaisa !== je.totalCreditPaisa) breakage("journal entry does not balance", je);
}
await shot(own, "r10-final");
save();

log("\n=== BREAKS ===", JSON.stringify(R.breaks, null, 2));
await browser.close();
