/*
 * THE BILL MUST EXIST AT TENDER, NOT AT CLOSE.
 *
 * Walkthrough §3 #3: a receipt was stamped `*** REPRINT #2 *** Originally issued
 * 2026-08-12T03:15:24.754Z` — the instant "Mark served & close order" was pressed — while the
 * payment had been taken at 02:59:24, sixteen minutes earlier. A cashier who takes the cash and
 * hands over the change has produced no paper, and a guest who pays and leaves before the kitchen
 * bumps the last line never gets a bill at all.
 *
 * This harness drives the exact path in the brief, as the CASHIER, and stops where the brief says
 * to stop:
 *
 *   1. Ring a dine-in check on a real table and fire it.
 *   2. Take CASH for the full amount on the charge page.
 *   3. STOP. Nothing is marked served; the order stays open.
 *   4. Read the order's print jobs back over HTTP on the cashier's own bearer, and read the bill
 *      itself from the charge page's "Print bill" control.
 *   5. Only then mark served & close, and read the print jobs again.
 *
 * The measurement that decides it is one subtraction: issuedAt(first CUSTOMER_RECEIPT) minus
 * recordedAt(payment). Before the fix that is the close-to-payment gap. After it, seconds.
 *
 * Usage:  node e2e/floor/receipt-at-tender.mjs [before|after]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PHASE = process.argv[2] ?? "after";
const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F7");
mkdirSync(OUT, { recursive: true });

const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};

const log = (...a) => console.log(...a);

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${PHASE}-${name}.png`, fullPage: false });
  log(`    shot: ${PHASE}-${name}.png`);
}

/** Never score a screen while it is failing — an error state photographs as an empty state. */
async function trouble(page) {
  return page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean),
    bad: /Couldn.t load|Something went wrong|Access denied|You do not have permission/i.test(
      document.body.innerText || "",
    ),
    url: location.href,
  }));
}

async function go(page, route, waitMs = 4000) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  let t = await trouble(page);
  if (t.bad) {
    log(`    ! ${route} looked broken, retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
    t = await trouble(page);
  }
  return t;
}

/** The persona's OWN bearer, minted by spending the HttpOnly refresh cookie the tab holds. */
async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}

async function apiGet(page, path, token) {
  return page.evaluate(
    async ({ p, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        credentials: "include",
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { p: path, tok: token },
  );
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const result = { phase: PHASE, startedAt: new Date().toISOString() };

try {
  // ── sign in for real ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(CASHIER.slug);
  const emailInput = page.locator('input[name="email"], input#email').first();
  const pwInput = page.locator('input[name="password"], input#password').first();
  await emailInput.click();
  await emailInput.fill(CASHIER.email);
  await pwInput.click();
  await pwInput.fill(CASHIER.password);
  await page.waitForTimeout(500);
  log(`  form holds: "${await emailInput.inputValue()}"`);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) throw new Error("cashier login failed");
  log(`  ✓ signed in as ${CASHIER.email}`);
  const token = await tokenOf(page);

  // ── 1. ring a dine-in check and fire it ─────────────────────────────────────
  log("\n=== 1. ring a dine-in check ===");
  let t = await go(page, "/app/pos", 8000);
  log("  /app/pos:", JSON.stringify(t));

  await page.locator("[data-testid=order-type-dine_in]").click();
  await page.waitForTimeout(400);

  // Prefer a real dine-in table. The seeded branch's tables are all held by the 133 inherited open
  // checks, so fall back to TAKEAWAY rather than fabricating floor state — and takeaway is the
  // sharper case anyway: the guest pays and walks out before anything is marked served.
  let usedTakeaway = false;
  const tableTrigger = page.locator("[data-testid=table-select-trigger]");
  if (await tableTrigger.count()) {
    await tableTrigger.click();
    await page.waitForTimeout(1200);
    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
        id: n.getAttribute("data-testid"),
        t: n.innerText.replace(/\s+/g, " ").trim(),
        disabled: n.getAttribute("aria-disabled") === "true",
      })),
    );
    const free = opts.find((o) => !o.disabled && /available/i.test(o.t)) ?? opts.find((o) => !o.disabled);
    if (free) {
      log("  table:", JSON.stringify(free));
      result.table = free.t;
      await page.locator(`[data-testid="${free.id}"]`).click();
      await page.waitForTimeout(900);
    } else {
      log("  ! every table is occupied:", JSON.stringify(opts.map((o) => o.t)));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      usedTakeaway = true;
    }
  }
  if (usedTakeaway) {
    await page.locator("[data-testid=order-type-takeaway]").click();
    await page.waitForTimeout(600);
    result.table = "TAKEAWAY (no table free)";
  }

  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(0).click();
  await page.waitForTimeout(250);
  await tiles.nth(1).click();
  await page.waitForTimeout(700);
  await shot(page, "01-cart");

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(6000);
  await shot(page, "02-fired");

  // ── 2. take CASH for the full amount, and stop ──────────────────────────────
  log("\n=== 2. CHARGE NOW, take cash for the full amount, then STOP ===");
  await page.locator("[data-testid=charge-now-button]").click();
  await page.waitForTimeout(6000);
  const orderId = /\/orders\/([0-9a-f-]{36})\/charge/.exec(page.url())?.[1];
  if (!orderId) throw new Error("CHARGE NOW did not land on a charge page: " + page.url());
  const branchId = await page.evaluate(() => localStorage.getItem("__probe") ?? null);
  log(`  charge page for order ${orderId}`);
  result.orderId = orderId;
  const order = { id: orderId, branchId };
  t = await trouble(page);
  log("  charge page:", JSON.stringify(t));
  result.orderNo = await page.evaluate(
    () => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null,
  );
  log("  order no:", result.orderNo);
  await shot(page, "03-charge-before-payment");

  await page.locator("[data-testid=fill-full-amount-button]").click();
  await page.waitForTimeout(400);
  const amount = await page.locator('input[aria-label="Amount (Rs)"]').first().inputValue();
  log("  full amount filled:", amount);
  await page.locator("[data-testid=denom-exact]").first().click();
  await page.waitForTimeout(500);
  await shot(page, "04-tender-typed");

  let paidAt = new Date();
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(6000);
  // Ten agents share this stack and pos-service is restarted under us; a 503 mid-tender is the
  // dev environment, not the product. Retry ONCE and say so, rather than scoring a broken moment.
  for (let attempt = 0; attempt < 3; attempt++) {
    const failed = await page.evaluate(
      () => document.body.innerText.includes("Failed to record payment"),
    );
    if (!failed) break;
    log(`  ! tender refused (attempt ${attempt + 1}) — retrying after the stack settles`);
    await page.waitForTimeout(15000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    if (await page.locator("[data-testid=fill-full-amount-button]").count()) {
      await page.locator("[data-testid=fill-full-amount-button]").click();
      await page.waitForTimeout(400);
      await page.locator("[data-testid=denom-exact]").first().click();
      await page.waitForTimeout(400);
      paidAt = new Date();
      await page.locator("[data-testid=record-payment-button]").click();
      await page.waitForTimeout(7000);
    }
  }
  result.paymentClickedAt = paidAt.toISOString();
  await shot(page, "05-after-payment-STOP-HERE");

  const afterPay = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      blocked: document.querySelector('[data-testid="payment-blocked-message"]')?.textContent ?? null,
      closeCta: document.querySelector('[data-testid="close-order-button"]')?.textContent ?? null,
      printBill: document.querySelector('[data-testid="print-bill-button"]')?.textContent ?? null,
      billIssued:
        document.querySelector('[data-testid="bill-issued-strip"]')?.innerText?.replace(/\s+/g, " ") ??
        null,
      status: /Order #\S+\s*\n?\s*(\S[^\n]*)/.exec(t)?.[1] ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    };
  });
  log("  charge page after payment:", JSON.stringify(afterPay, null, 1));
  result.afterPay = afterPay;

  const payments = await apiGet(page, `/api/v1/pos/orders/${order.id}/payments`, token);
  const payRows = payments.body?.data ?? [];
  result.payments = payRows;
  const recordedAt = payRows[0]?.recordedAt ?? null;
  log("  payment recorded at:", recordedAt);

  const orderNow = await apiGet(page, `/api/v1/pos/orders/${order.id}?branchId=${order.branchId}`, token);
  result.orderStatusAtTender = orderNow.body?.data?.status ?? null;
  result.derivedStatusAtTender = orderNow.body?.data?.derivedStatus ?? null;
  log(`  order status at tender: ${result.orderStatusAtTender} / ${result.derivedStatusAtTender}`);

  // ── 3. is there a bill? ─────────────────────────────────────────────────────
  log("\n=== 3. is there a print job for this order, right now? ===");
  const jobs = await apiGet(page, `/api/v1/pos/orders/${order.id}/print-jobs`, token);
  log("  GET /orders/{id}/print-jobs →", jobs.status);
  const jobRows = jobs.body?.data ?? [];
  const receipts = Array.isArray(jobRows)
    ? jobRows.filter((j) => j.documentType === "CUSTOMER_RECEIPT")
    : [];
  log("  receipts at tender:", JSON.stringify(receipts, null, 1));
  result.printJobsEndpointStatus = jobs.status;
  result.receiptsAtTender = receipts;

  if (recordedAt && receipts.length) {
    const gapMs = new Date(receipts[0].issuedAt) - new Date(recordedAt);
    result.tenderToBillMs = gapMs;
    log(`  ⇒ bill issued ${(gapMs / 1000).toFixed(1)}s after the payment was recorded`);
  } else {
    log("  ⇒ NO BILL EXISTS. The cashier has taken the money and produced no paper.");
  }

  // the bill as the cashier reaches it
  await page.locator("[data-testid=print-bill-button]").click();
  await page.waitForTimeout(5000);
  const bill = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      url: location.href,
      reprintBanner: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      thermalNotice:
        document.querySelector('[data-testid="thermal-print-notice"]')?.getAttribute("data-target-printer") ??
        null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    };
  });
  log("  bill reached from the charge page:", JSON.stringify(bill, null, 1));
  result.billAtTender = bill;
  await shot(page, "06-bill-at-tender");

  // ── 4. only NOW mark served & close ─────────────────────────────────────────
  log("\n=== 4. now mark served & close ===");
  await go(page, `/app/pos/orders/${order.id}/charge`, 5000);
  const closeBtn = page.locator("[data-testid=close-order-button]");
  if (await closeBtn.count()) {
    await closeBtn.click();
    await page.waitForTimeout(7000);
  } else {
    log("  ! no close CTA on the charge page");
  }
  await shot(page, "07-after-close");

  const jobsAfter = await apiGet(page, `/api/v1/pos/orders/${order.id}/print-jobs`, token);
  const afterRows = jobsAfter.body?.data ?? [];
  const receiptsAfter = Array.isArray(afterRows)
    ? afterRows.filter((j) => j.documentType === "CUSTOMER_RECEIPT")
    : [];
  log("  receipts after close:", JSON.stringify(receiptsAfter, null, 1));
  result.receiptsAfterClose = receiptsAfter;

  // and the bill reached after the close must be a REPRINT of the tender-time original
  await go(page, `/app/pos/orders/${order.id}/receipt`, 5500);
  const billAfter = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      reprintBanner: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    };
  });
  log("  bill after close:", JSON.stringify(billAfter, null, 1));
  result.billAfterClose = billAfter;
  await shot(page, "08-bill-after-close");
} catch (err) {
  result.error = String(err);
  log("\n!! " + err);
  await shot(page, "99-failure");
} finally {
  result.finishedAt = new Date().toISOString();
  writeFileSync(`${OUT}/${PHASE}-receipt-at-tender.json`, JSON.stringify(result, null, 2));
  log(`\nwrote ${OUT}/${PHASE}-receipt-at-tender.json`);
  await browser.close();
}
