/*
 * RE-OPEN ATTEMPT — §3-3, the remaining TENDER SHAPES.
 *
 * The finding's headline sentence is "the cashier hands over change with no paper". Scenario A
 * used the Exact quick-tender, so no change was ever counted out. This drives the two shapes
 * left:
 *
 *   C1  CASH OVER-TENDER — a note bigger than the bill, change due. The bill must exist before
 *       the change leaves the drawer, and the change on the paper must equal the change on the
 *       screen and the change in order_payments.
 *   C2  CARD in full — a tender that needs no till at all, and therefore takes a different route
 *       into recordPayment.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F7-reopen";
mkdirSync(OUT, { recursive: true });

const R = { scenario: "C-tender-shapes", startedAt: new Date().toISOString(), checks: [] };
const log = (...a) => console.log(...a);
const check = (name, ok, detail) => {
  R.checks.push({ name, ok: !!ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};

async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}
async function api(page, path, token) {
  return page.evaluate(async ({ p, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      credentials: "include", headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, { p: path, tok: token });
}

async function ringAndFire(page, tag) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await page.locator("[data-testid=order-type-dine_in]").click();
  await page.waitForTimeout(500);
  const trigger = page.locator("[data-testid=table-select-trigger]");
  if (await trigger.count()) {
    await trigger.click(); await page.waitForTimeout(1500);
    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
        id: n.getAttribute("data-testid"), t: n.innerText.replace(/\s+/g, " ").trim(),
        disabled: n.getAttribute("aria-disabled") === "true" })));
    const free = opts.find((o) => !o.disabled && /available/i.test(o.t)) ?? opts.find((o) => !o.disabled);
    if (free) { await page.locator(`[data-testid="${free.id}"]`).click(); await page.waitForTimeout(900); }
    else { await page.keyboard.press("Escape"); await page.waitForTimeout(400);
           await page.locator("[data-testid=order-type-takeaway]").click(); await page.waitForTimeout(600); }
  }
  const addTile = async (i) => {
    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 30000 });
    await tiles.nth(i).click({ timeout: 15000 }); await page.waitForTimeout(900);
    const dlg = page.locator('[data-testid="modifier-dialog"]');
    if (await dlg.count()) {
      const add = page.locator('[data-testid="modifier-dialog-add"]');
      if ((await add.count()) && (await add.first().isEnabled())) { await add.first().click(); await page.waitForTimeout(900); return true; }
      await page.keyboard.press("Escape"); await page.waitForTimeout(600); return false;
    }
    return true;
  };
  let added = 0;
  for (let i = 0; i < 12 && added < 1; i++) if (await addTile(i)) added++;
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  await page.locator("[data-testid=charge-now-button]").click();
  await page.waitForTimeout(7000);
  const id = /\/orders\/([0-9a-f-]{36})\/charge/.exec(page.url())?.[1];
  if (!id) throw new Error(`${tag}: no charge page: ` + page.url());
  return id;
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace");
  await page.locator('input[name="email"], input#email').first().fill("cashier@terrace.local");
  await page.locator('input[name="password"], input#password').first().fill("Terrace#Cashier1");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6500);
  if (page.url().includes("/login")) throw new Error("login failed");
  log("signed in as cashier@terrace.local");
  let token = await tokenOf(page);

  // ══ C1 — cash over-tender, change due ═════════════════════════════════════
  log("\n=== C1: CASH over-tender — change is counted out ===");
  const o1 = await ringAndFire(page, "C1");
  R.overTenderOrderId = o1;
  R.overTenderOrderNo = await page.evaluate(() => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null);
  await page.locator("[data-testid=fill-full-amount-button]").click();
  await page.waitForTimeout(500);
  const amountInput = page.locator('input[aria-label="Amount (Rs)"]').first();
  R.billRupees = await amountInput.inputValue();
  // hand over a note comfortably bigger than the bill
  const note = (Math.ceil(parseFloat(R.billRupees) / 500) * 500 + 500).toFixed(2);
  R.noteRupees = note;
  const tenderedInput = page.locator('input[aria-label="Tendered (Rs)"], input[aria-label="Cash tendered (Rs)"]').first();
  if (await tenderedInput.count()) { await tenderedInput.fill(""); await tenderedInput.fill(note); }
  else {
    // fall back to the denomination pad
    const denoms = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="denom-"]'))
      .map((n) => n.getAttribute("data-testid")).filter((d) => d && /^denom-\d+$/.test(d)));
    R.denomsSeen = denoms;
    if (denoms.length) await page.locator(`[data-testid="${denoms[denoms.length - 1]}"]`).click();
  }
  await page.waitForTimeout(800);
  R.screenChange = await page.evaluate(() => ({
    changeDue: document.querySelector('[data-testid="change-due-value"]')?.getAttribute("data-paisa")
      ?? document.querySelector('[data-testid="change-due-total"]')?.getAttribute("data-paisa") ?? null,
    tenderTotal: document.querySelector('[data-testid="tender-total-value"]')?.getAttribute("data-paisa") ?? null,
  }));
  await page.screenshot({ path: `${OUT}/c-01-over-tender-typed.png` });
  log("  screen before recording: " + JSON.stringify(R.screenChange));
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/c-02-over-tender-paid.png` });

  token = (await tokenOf(page)) ?? token;
  const pays1 = await api(page, `/api/v1/pos/orders/${o1}/payments`, token);
  R.overTenderPayments = (pays1.body?.data ?? []).map((p) => ({ method: p.method, amountPaisa: p.amountPaisa,
    tenderedPaisa: p.tenderedPaisa, changePaisa: p.changePaisa, recordedAt: p.recordedAt }));
  const jobs1 = await api(page, `/api/v1/pos/orders/${o1}/print-jobs`, token);
  R.overTenderReceipts = (jobs1.body?.data ?? []).filter((j) => j.documentType === "CUSTOMER_RECEIPT");
  log("  payments: " + JSON.stringify(R.overTenderPayments));
  log("  receipts: " + JSON.stringify(R.overTenderReceipts));
  R.stripOverTender = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="bill-issued-strip"]');
    return n ? { text: n.innerText.replace(/\s+/g, " ").trim(), issued: n.getAttribute("data-bill-issued") } : null;
  });
  check("an over-tendered check has its bill before the change is handed over",
    R.overTenderReceipts.length === 1 && R.overTenderReceipts[0].issueSeq === 1, R.overTenderReceipts);
  const p1 = R.overTenderPayments[0];
  if (p1 && R.overTenderReceipts[0]) {
    R.overTenderGapMs = new Date(R.overTenderReceipts[0].issuedAt) - new Date(p1.recordedAt);
    check("stamped at the tender", Math.abs(R.overTenderGapMs) < 10000,
      { paidAt: p1.recordedAt, billAt: R.overTenderReceipts[0].issuedAt, gapMs: R.overTenderGapMs });
    check("change really was due on this tender", p1.changePaisa > 0, p1);
    check("tendered = applied + change, to the paisa",
      p1.tenderedPaisa === p1.amountPaisa + p1.changePaisa + (p1.tipPaisa ?? 0), p1);
  }
  check("the screen announces the bill", R.stripOverTender?.issued === "true", R.stripOverTender?.text);

  await page.locator("[data-testid=print-bill-button]").click();
  await page.waitForTimeout(6500);
  R.overTenderBill = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      cash: /CASH\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      change: /CHANGE\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}/c-03-over-tender-bill.png` });
  log("  bill: " + JSON.stringify(R.overTenderBill));
  const billChangePaisa = R.overTenderBill.change ? Math.round(parseFloat(R.overTenderBill.change.replace(/[^\d.]/g, "")) * 100) : null;
  check("the CHANGE printed on the bill equals order_payments.change_paisa",
    p1 && billChangePaisa === p1.changePaisa, { printed: billChangePaisa, persisted: p1?.changePaisa });

  // ══ C2 — card in full, no till involved ═══════════════════════════════════
  log("\n=== C2: CARD in full ===");
  const o2 = await ringAndFire(page, "C2");
  R.cardOrderId = o2;
  R.cardOrderNo = await page.evaluate(() => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null);
  await page.locator('select[aria-label="Payment method"]').first().selectOption("CARD");
  await page.waitForTimeout(700);
  await page.locator("[data-testid=fill-full-amount-button]").click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/c-04-card-typed.png` });
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/c-05-card-paid.png` });

  token = (await tokenOf(page)) ?? token;
  const pays2 = await api(page, `/api/v1/pos/orders/${o2}/payments`, token);
  R.cardPayments = (pays2.body?.data ?? []).map((p) => ({ method: p.method, amountPaisa: p.amountPaisa, recordedAt: p.recordedAt }));
  const jobs2 = await api(page, `/api/v1/pos/orders/${o2}/print-jobs`, token);
  R.cardReceipts = (jobs2.body?.data ?? []).filter((j) => j.documentType === "CUSTOMER_RECEIPT");
  R.stripCard = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="bill-issued-strip"]');
    return n ? { text: n.innerText.replace(/\s+/g, " ").trim(), issued: n.getAttribute("data-bill-issued") } : null;
  });
  log("  payments: " + JSON.stringify(R.cardPayments));
  log("  receipts: " + JSON.stringify(R.cardReceipts));
  check("a CARD tender produces the bill at the tender too",
    R.cardReceipts.length === 1 && R.cardReceipts[0].issueSeq === 1, R.cardReceipts);
  if (R.cardPayments[0] && R.cardReceipts[0]) {
    R.cardGapMs = new Date(R.cardReceipts[0].issuedAt) - new Date(R.cardPayments[0].recordedAt);
    check("card: stamped at the tender", Math.abs(R.cardGapMs) < 10000,
      { paidAt: R.cardPayments[0].recordedAt, billAt: R.cardReceipts[0].issuedAt, gapMs: R.cardGapMs });
  }
  check("card: the screen announces the bill", R.stripCard?.issued === "true", R.stripCard?.text);
} catch (err) {
  R.error = String(err);
  log("\n!! " + err);
} finally {
  R.finishedAt = new Date().toISOString();
  R.failed = R.checks.filter((c) => !c.ok).map((c) => c.name);
  writeFileSync(`${OUT}/c-result.json`, JSON.stringify(R, null, 2));
  log(`\n${R.checks.filter((c) => c.ok).length}/${R.checks.length} checks passed`);
  if (R.failed.length) log("FAILED: " + JSON.stringify(R.failed, null, 1));
  await browser.close();
}
