/*
 * RE-OPEN ATTEMPT — §3-3, the ADJACENT paths.
 *
 * A bill fixed for a single full-cash tender is not a bill fixed for the register.
 *
 *  B1  SPLIT TENDER. Pay HALF, stop. There must be NO bill — a document saying less than the
 *      guest owes is worse than none. Pay the rest. NOW there must be exactly one, stamped at
 *      the settling tender, not at the first one.
 *  B2  The money on the bill must equal the money in order_payments and the money on the screen.
 *  B3  The new read — GET /orders/{id}/print-jobs — as the WRONG persona (kitchen: 2 perms).
 *  B4  The same read from ANOTHER TENANT, for a Floating Terrace order id. A row would be a leak.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F7-reopen";
mkdirSync(OUT, { recursive: true });

const R = { scenario: "B-adjacent", startedAt: new Date().toISOString(), checks: [] };
const log = (...a) => console.log(...a);
const check = (name, ok, detail) => {
  R.checks.push({ name, ok: !!ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};

async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}
async function api(page, path, token) {
  return page.evaluate(async ({ p, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      credentials: "include", headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    let body = null; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { p: path, tok: token });
}
async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${email}: ${page.url()}`);
  log(`  signed in as ${email}`);
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

try {
  // ══ B1/B2 — split tender as the cashier ═══════════════════════════════════
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await login(page, { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" });
  let token = await tokenOf(page);

  log("\n=== B1: ring, fire, and pay HALF ===");
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
    if (free) { R.table = free.t; await page.locator(`[data-testid="${free.id}"]`).click(); await page.waitForTimeout(900); }
    else { await page.keyboard.press("Escape"); await page.waitForTimeout(400);
           await page.locator("[data-testid=order-type-takeaway]").click(); await page.waitForTimeout(600); R.table = "TAKEAWAY"; }
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
  for (let i = 0; i < 12 && added < 2; i++) if (await addTile(i)) added++;
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  await page.locator("[data-testid=charge-now-button]").click();
  await page.waitForTimeout(7000);
  const orderId = /\/orders\/([0-9a-f-]{36})\/charge/.exec(page.url())?.[1];
  if (!orderId) throw new Error("no charge page: " + page.url());
  R.orderId = orderId;
  R.orderNo = await page.evaluate(() => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null);
  log(`  order ${R.orderNo} (${orderId})`);

  // full amount, then halve it by hand
  await page.locator("[data-testid=fill-full-amount-button]").click();
  await page.waitForTimeout(500);
  const amountInput = page.locator('input[aria-label="Amount (Rs)"]').first();
  const fullRupees = await amountInput.inputValue();
  R.fullRupees = fullRupees;
  const half = (Math.round(parseFloat(fullRupees) * 100 / 2) / 100).toFixed(2);
  R.halfRupees = half;
  await amountInput.fill("");
  await amountInput.fill(half);
  await page.waitForTimeout(400);
  await page.locator("[data-testid=denom-exact]").first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/b-01-half-typed.png` });
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/b-02-after-half.png` });

  R.afterHalf = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="bill-issued-strip"]');
    return {
      strip: s ? s.innerText.replace(/\s+/g, " ").trim() : null,
      billIssued: s?.getAttribute("data-bill-issued") ?? null,
      remaining: document.querySelector('[data-testid="remaining-balance-value"]')?.getAttribute("data-paisa") ?? null,
      errors: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    };
  });
  log("  after the half tender: " + JSON.stringify(R.afterHalf));
  token = (await tokenOf(page)) ?? token;
  const half1 = await api(page, `/api/v1/pos/orders/${orderId}/print-jobs`, token);
  R.receiptsAfterHalf = (half1.body?.data ?? []).filter((j) => j.documentType === "CUSTOMER_RECEIPT");
  check("a HALF-paid check produces no bill", R.receiptsAfterHalf.length === 0, R.receiptsAfterHalf);
  check("the screen says so too (no bill yet, on a check with money on it)",
    R.afterHalf.billIssued === "false", R.afterHalf.strip);
  check("a real balance is still outstanding", Number(R.afterHalf.remaining) > 0, R.afterHalf.remaining);

  log("\n=== B1b: settle the balance ===");
  await page.locator("[data-testid=fill-full-amount-button]").click();
  await page.waitForTimeout(500);
  R.balanceRupees = await amountInput.inputValue();
  await page.locator("[data-testid=denom-exact]").first().click();
  await page.waitForTimeout(600);
  const settleClickedAt = new Date().toISOString();
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/b-03-after-settle.png` });

  R.afterSettle = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="bill-issued-strip"]');
    return {
      strip: s ? s.innerText.replace(/\s+/g, " ").trim() : null,
      billIssued: s?.getAttribute("data-bill-issued") ?? null,
      billIssuedAt: s?.getAttribute("data-bill-issued-at") ?? null,
      remaining: document.querySelector('[data-testid="remaining-balance-value"]')?.getAttribute("data-paisa") ?? null,
      totalPaisa: Array.from(document.querySelectorAll("[data-paisa]"))
        .map((n) => ({ id: n.getAttribute("data-testid"), p: n.getAttribute("data-paisa") })),
      closeCta: document.querySelector('[data-testid="close-order-button"]')?.innerText?.trim() ?? null,
      errors: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    };
  });
  log("  after the settling tender: " + JSON.stringify({ strip: R.afterSettle.strip, remaining: R.afterSettle.remaining, closeCta: R.afterSettle.closeCta }));

  token = (await tokenOf(page)) ?? token;
  const pays = await api(page, `/api/v1/pos/orders/${orderId}/payments`, token);
  R.payments = (pays.body?.data ?? []).map((p) => ({ method: p.method, amountPaisa: p.amountPaisa,
    tenderedPaisa: p.tenderedPaisa, changePaisa: p.changePaisa, recordedAt: p.recordedAt }));
  const jobs = await api(page, `/api/v1/pos/orders/${orderId}/print-jobs`, token);
  R.receiptsAfterSettle = (jobs.body?.data ?? []).filter((j) => j.documentType === "CUSTOMER_RECEIPT");
  log("  payments: " + JSON.stringify(R.payments, null, 1));
  log("  receipts: " + JSON.stringify(R.receiptsAfterSettle, null, 1));

  check("the settling tender produces exactly one bill", R.receiptsAfterSettle.length === 1,
    { count: R.receiptsAfterSettle.length });
  const orig = R.receiptsAfterSettle[0];
  check("it is the original", orig && orig.issueSeq === 1 && !orig.originalIssuedAt, orig);
  const settlingPay = R.payments[R.payments.length - 1];
  if (orig && settlingPay) {
    R.settleGapMs = new Date(orig.issuedAt) - new Date(settlingPay.recordedAt);
    check("stamped at the SETTLING tender, not the first one", Math.abs(R.settleGapMs) < 10000,
      { firstPaymentAt: R.payments[0]?.recordedAt, settlingAt: settlingPay.recordedAt, billAt: orig.issuedAt, gapMs: R.settleGapMs });
  }
  check("the check is still open — no close has happened", R.afterSettle.closeCta !== null, R.afterSettle.closeCta);

  // ══ B2 — the money agrees, to the paisa ══════════════════════════════════
  log("\n=== B2: screen vs order_payments vs the printed bill ===");
  await page.locator("[data-testid=print-bill-button]").click();
  await page.waitForTimeout(6500);
  R.bill = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      reprint: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      cashLines: (t.match(/CASH\s*\n?\s*Rs [\d,]+\.\d\d/g) ?? []).map((s) => s.replace(/\s+/g, " ")),
      change: /CHANGE\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}/b-04-bill.png` });
  log("  bill: " + JSON.stringify(R.bill, null, 1));
  const paidPaisa = R.payments.reduce((a, p) => a + p.amountPaisa, 0);
  const billTotalPaisa = R.bill.total ? Math.round(parseFloat(R.bill.total.replace(/[^\d.]/g, "")) * 100) : null;
  R.paidPaisa = paidPaisa; R.billTotalPaisa = billTotalPaisa;
  check("the bill TOTAL equals the sum of order_payments, to the paisa",
    billTotalPaisa !== null && billTotalPaisa === paidPaisa, { billTotalPaisa, paidPaisa });
  check("the bill is a reprint of the tender-time original",
    orig && (R.bill.originallyIssued ?? "").includes(orig.issuedAt.replace(/Z$/, "").slice(0, 19)),
    { orig: orig?.issuedAt, banner: R.bill.originallyIssued });
  await page.close(); await ctx.close();

  // ══ B3 — the WRONG persona ════════════════════════════════════════════════
  log("\n=== B3: kitchen persona reading another department's paper trail ===");
  const kctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const kpage = await kctx.newPage();
  await login(kpage, { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" });
  const ktoken = await tokenOf(kpage);
  const kres = await api(kpage, `/api/v1/pos/orders/${orderId}/print-jobs`, ktoken);
  R.kitchenRead = { status: kres.status, body: JSON.stringify(kres.body).slice(0, 400) };
  log("  kitchen → " + JSON.stringify(R.kitchenRead));
  check("KITCHEN_STAFF (2 permissions) is refused the bill history",
    kres.status === 403 || kres.status === 401, R.kitchenRead);
  await kpage.close(); await kctx.close();

  // ── waiter, who does hold order-view: allowed is the correct answer here ──
  const wctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wpage = await wctx.newPage();
  await login(wpage, { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" });
  const wtoken = await tokenOf(wpage);
  const wres = await api(wpage, `/api/v1/pos/orders/${orderId}/print-jobs`, wtoken);
  R.waiterRead = { status: wres.status, rows: Array.isArray(wres.body?.data) ? wres.body.data.length : null };
  log("  waiter → " + JSON.stringify(R.waiterRead));
  await wpage.close(); await wctx.close();

  // ══ B4 — another TENANT ═══════════════════════════════════════════════════
  log("\n=== B4: Control Bistro asking for a Floating Terrace order's paper ===");
  const cctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cpage = await cctx.newPage();
  await login(cpage, { slug: "control-bistro-isolation-test-tenant", email: "cashier@control.local", password: "Control#Cashier1" });
  const ctoken = await tokenOf(cpage);
  const cres = await api(cpage, `/api/v1/pos/orders/${orderId}/print-jobs`, ctoken);
  R.crossTenantRead = { status: cres.status, body: JSON.stringify(cres.body).slice(0, 400) };
  log("  control-bistro → " + JSON.stringify(R.crossTenantRead));
  const leaked = Array.isArray(cres.body?.data) && cres.body.data.length > 0;
  check("another tenant gets NO rows for a Floating Terrace order", !leaked, R.crossTenantRead);
  await cpage.close(); await cctx.close();
} catch (err) {
  R.error = String(err);
  log("\n!! " + err);
} finally {
  R.finishedAt = new Date().toISOString();
  R.failed = R.checks.filter((c) => !c.ok).map((c) => c.name);
  writeFileSync(`${OUT}/b-result.json`, JSON.stringify(R, null, 2));
  log(`\n${R.checks.filter((c) => c.ok).length}/${R.checks.length} checks passed`);
  if (R.failed.length) log("FAILED: " + JSON.stringify(R.failed, null, 1));
  await browser.close();
}
