/*
 * RE-OPEN ATTEMPT — §3-3 "the bill prints at close, not at tender".
 *
 * Independent drive. Not the author's harness: this one takes the CORE path AND the three
 * adjacent paths the author's harness never touches —
 *
 *   A. cash, full amount, fired-but-not-served, STOP        (the brief's exact path)
 *   B. SPLIT tender: half now, half a moment later          (does the bill land on the LAST paisa?)
 *   C. CARD tender, no till in play                         (a different money seam entirely)
 *   D. cash OVER-tender with change handed back             (applied is capped; is it still "in full"?)
 *
 * and reloads the page after each, because a strip that vanishes on F5 is a strip that was
 * never really there.
 *
 * Usage: node e2e/floor/verify-3-3-reopen.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F7-reopen");
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const log = (...a) => console.log(...a);
const result = { startedAt: new Date().toISOString(), scenarios: {} };

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
}

async function trouble(page) {
  return page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean),
    bad: /Couldn.t load|Something went wrong|Access denied|You do not have permission|unavailable right now/i.test(
      document.body.innerText || "",
    ),
    url: location.href,
  }));
}

async function go(page, route, waitMs = 4500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  let t = await trouble(page);
  if (t.bad) {
    log(`    ! ${route} looked broken (${JSON.stringify(t.alerts)}) — retrying once`);
    await page.waitForTimeout(6000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 2000);
    t = await trouble(page);
  }
  return t;
}

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

/** Read the visible strip exactly as a cashier would see it. */
async function readStrip(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="bill-issued-strip"]');
    const err = document.querySelector('[data-testid="bill-issued-error"]');
    const loading = document.querySelector('[data-testid="bill-issued-loading"]');
    return {
      present: !!el,
      issued: el?.getAttribute("data-bill-issued") ?? null,
      issuedAt: el?.getAttribute("data-bill-issued-at") ?? null,
      target: el?.getAttribute("data-bill-target") ?? null,
      text: (el?.innerText || "").replace(/\s+/g, " ").trim() || null,
      errorState: !!err,
      loadingState: !!loading,
    };
  });
}

async function receiptsFor(page, orderId, token) {
  const jobs = await apiGet(page, `/api/v1/pos/orders/${orderId}/print-jobs`, token);
  const rows = Array.isArray(jobs.body?.data) ? jobs.body.data : [];
  return {
    status: jobs.status,
    all: rows,
    receipts: rows.filter((j) => j.documentType === "CUSTOMER_RECEIPT"),
  };
}

/** Ring a check on the POS and fire it. Returns { orderId, orderNo, totalText }. */
async function ringAndFire(page, tag, tileCount = 2) {
  let t = await go(page, "/app/pos", 9000);
  log(`  [${tag}] /app/pos:`, JSON.stringify(t.alerts));

  // till, if the bar says there is none
  const openTill = page.locator("[data-testid=open-till-button]");
  if (await openTill.count()) {
    log(`  [${tag}] no active till — opening one`);
    await openTill.click();
    await page.waitForTimeout(600);
    const float = page.locator('[data-testid=open-till-panel] input[type="number"]').first();
    await float.fill("5000.00");
    await page.locator("[data-testid=open-till-confirm-button]").click();
    await page.waitForTimeout(5000);
  }

  await page.locator("[data-testid=order-type-dine_in]").click();
  await page.waitForTimeout(500);

  let table = null;
  const trigger = page.locator("[data-testid=table-select-trigger]");
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(1400);
    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
        id: n.getAttribute("data-testid"),
        t: n.innerText.replace(/\s+/g, " ").trim(),
        disabled: n.getAttribute("aria-disabled") === "true",
      })),
    );
    const free = opts.find((o) => !o.disabled && /available/i.test(o.t)) ?? opts.find((o) => !o.disabled);
    if (free) {
      table = free.t;
      await page.locator(`[data-testid="${free.id}"]`).click();
      await page.waitForTimeout(900);
    } else {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await page.locator("[data-testid=order-type-takeaway]").click();
      await page.waitForTimeout(600);
      table = "TAKEAWAY (no table free)";
    }
  }
  log(`  [${tag}] table: ${table}`);

  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30000 });
  let added = 0;
  for (let i = 0; added < tileCount && i < 14; i++) {
    await tiles.nth(i).click();
    await page.waitForTimeout(700);
    // S6 landed a modifier dialog mid-session; a tile with required modifiers opens it and the
    // grid behind is then pointer-blocked. Take the dialog's own Add when it is satisfiable,
    // otherwise dismiss it and move to the next tile.
    const dlg = page.locator('[data-testid="modifier-dialog"]');
    if (await dlg.count()) {
      await page.waitForTimeout(900);
      const addBtn = page.locator('[data-testid="modifier-dialog-add"]');
      const enabled = (await addBtn.count()) && (await addBtn.first().isEnabled());
      if (enabled) {
        await addBtn.first().click();
        await page.waitForTimeout(900);
        added++;
      } else {
        // satisfy the first option of each group, then Add
        const opts = page.locator('[data-testid^="modifier-option-"]');
        const n = await opts.count();
        for (let k = 0; k < Math.min(n, 3); k++) {
          await opts.nth(k).click();
          await page.waitForTimeout(250);
          if ((await addBtn.count()) && (await addBtn.first().isEnabled())) break;
        }
        if ((await addBtn.count()) && (await addBtn.first().isEnabled())) {
          await addBtn.first().click();
          await page.waitForTimeout(900);
          added++;
        } else {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(600);
        }
      }
    } else {
      added++;
    }
  }
  await page.waitForTimeout(800);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);

  await page.locator("[data-testid=charge-now-button]").click();
  await page.waitForTimeout(7000);
  const orderId = /\/orders\/([0-9a-f-]{36})\/charge/.exec(page.url())?.[1];
  if (!orderId) throw new Error(`[${tag}] CHARGE NOW did not land on a charge page: ${page.url()}`);
  const meta = await page.evaluate(() => ({
    orderNo: /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null,
    balance:
      document.querySelector('[data-testid="remaining-balance-value"]')?.getAttribute("data-paisa") ?? null,
    body: document.body.innerText,
  }));
  log(`  [${tag}] order ${meta.orderNo} (${orderId}) table=${table}`);
  return { orderId, orderNo: meta.orderNo, table };
}

/** Fill the first tender row and record it. `amountText` in RUPEES; null = press Full amount. */
async function tender(page, tag, { method = "CASH", amountText = null, tenderedText = null }) {
  const methodSel = page.locator('select[aria-label="Payment method"]').first();
  await methodSel.selectOption(method);
  await page.waitForTimeout(400);

  const amountInput = page.locator('input[aria-label="Amount (Rs)"]').first();
  if (amountText === null) {
    await page.locator("[data-testid=fill-full-amount-button]").click();
  } else {
    await amountInput.fill(amountText);
  }
  await page.waitForTimeout(500);
  const filled = await amountInput.inputValue();

  if (method === "CASH") {
    if (tenderedText === null) {
      await page.locator("[data-testid=denom-exact]").first().click();
    } else {
      const tenderedInput = page.locator('input[aria-label="Tendered (Rs)"]').first();
      if (await tenderedInput.count()) await tenderedInput.fill(tenderedText);
      else log(`  [${tag}] ! no Tendered input found; falling back to Exact`);
    }
    await page.waitForTimeout(500);
  }

  const changeDue = await page.evaluate(
    () => document.querySelector('[data-testid="change-due-total"]')?.getAttribute("data-paisa") ?? null,
  );
  const clickedAt = new Date();
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(7000);

  for (let attempt = 0; attempt < 3; attempt++) {
    const failed = await page.evaluate(() =>
      /Failed to record payment|unavailable right now|503/i.test(
        document.querySelector('[data-testid="record-payment-error"]')?.innerText || "",
      ),
    );
    if (!failed) break;
    log(`  [${tag}] ! tender refused (attempt ${attempt + 1}) — waiting for the stack, retrying`);
    await page.waitForTimeout(18000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    if (await page.locator("[data-testid=fill-full-amount-button]").count()) {
      await page.locator('select[aria-label="Payment method"]').first().selectOption(method);
      if (amountText === null) await page.locator("[data-testid=fill-full-amount-button]").click();
      else await page.locator('input[aria-label="Amount (Rs)"]').first().fill(amountText);
      await page.waitForTimeout(400);
      if (method === "CASH") {
        await page.locator("[data-testid=denom-exact]").first().click();
        await page.waitForTimeout(400);
      }
      await page.locator("[data-testid=record-payment-button]").click();
      await page.waitForTimeout(8000);
    }
  }
  log(`  [${tag}] tendered ${method} ${filled} (changeDue paisa=${changeDue})`);
  return { clickedAt: clickedAt.toISOString(), filled, changeDue };
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await ctx.newPage();

try {
  // ── sign in ──────────────────────────────────────────────────────────────
  let signedIn = false;
  for (let attempt = 1; attempt <= 4 && !signedIn; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(CASHIER.slug);
    const emailIn = page.locator('input[name="email"], input#email').first();
    const pwIn = page.locator('input[name="password"], input#password').first();
    await emailIn.waitFor({ timeout: 30000 });
    await emailIn.fill(CASHIER.email);
    await pwIn.fill(CASHIER.password);
    await page.waitForTimeout(600);
    log(`  login attempt ${attempt}: form holds "${await emailIn.inputValue()}"`);
    await page.locator('button[type="submit"]').first().click();
    for (let w = 0; w < 12 && page.url().includes("/login"); w++) await page.waitForTimeout(2000);
    signedIn = !page.url().includes("/login");
    if (!signedIn) {
      const err = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()).join(" | "),
      );
      log(`  login attempt ${attempt} failed at ${page.url()} — ${err}`);
      await page.waitForTimeout(5000);
    }
  }
  if (!signedIn) throw new Error("cashier login failed");
  log(`✓ signed in as ${CASHIER.email}`);
  const token = await tokenOf(page);
  result.tokenMinted = !!token;

  // ══ A. THE BRIEF'S PATH: cash, full amount, fired-but-not-served, STOP ══
  log("\n═══ A. cash in full on a fired-but-unserved check, then STOP ═══");
  const A = {};
  const a = await ringAndFire(page, "A");
  A.order = a;
  const aTender = await tender(page, "A", { method: "CASH", amountText: null });
  A.tender = aTender;
  await shot(page, "A-01-after-payment-STOP");

  A.stripAtTender = await readStrip(page);
  log("  [A] strip at tender:", JSON.stringify(A.stripAtTender));

  const aPayments = await apiGet(page, `/api/v1/pos/orders/${a.orderId}/payments`, token);
  A.payments = aPayments.body?.data ?? [];
  A.recordedAt = A.payments[0]?.recordedAt ?? null;

  const aJobs = await receiptsFor(page, a.orderId, token);
  A.printJobsStatus = aJobs.status;
  A.receiptsAtTender = aJobs.receipts;
  A.orderState = (await apiGet(page, `/api/v1/pos/orders/${a.orderId}`, token)).body?.data ?? null;
  A.statusAtTender = A.orderState?.status ?? null;
  A.itemStatusesAtTender = (A.orderState?.items ?? []).map((i) => i.status);
  log(`  [A] order status at tender: ${A.statusAtTender}; items ${JSON.stringify(A.itemStatusesAtTender)}`);
  log(`  [A] receipts at tender: ${JSON.stringify(A.receiptsAtTender)}`);
  if (A.recordedAt && A.receiptsAtTender.length) {
    A.tenderToBillMs = new Date(A.receiptsAtTender[0].issuedAt) - new Date(A.recordedAt);
    log(`  [A] ⇒ bill issued ${A.tenderToBillMs} ms after the payment row`);
  }

  // does it PERSIST across a reload?
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  A.stripAfterReload = await readStrip(page);
  log("  [A] strip after F5:", JSON.stringify(A.stripAfterReload));
  await shot(page, "A-02-after-reload");

  // the bill the cashier can actually reach
  await page.locator("[data-testid=print-bill-button]").click();
  await page.waitForTimeout(6000);
  A.billAtTender = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      url: location.href,
      reprintBanner: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      cashLine: /CASH\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      changeLine: /CHANGE[^\n]*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    };
  });
  log("  [A] bill at tender:", JSON.stringify(A.billAtTender));
  await shot(page, "A-03-bill-at-tender");

  // NOW close
  await go(page, `/app/pos/orders/${a.orderId}/charge`, 6000);
  const closeBtn = page.locator("[data-testid=close-order-button]");
  A.closeCtaPresent = (await closeBtn.count()) > 0;
  if (A.closeCtaPresent) {
    await closeBtn.click();
    await page.waitForTimeout(8000);
  }
  await shot(page, "A-04-after-close");
  const aAfter = await receiptsFor(page, a.orderId, token);
  A.receiptsAfterClose = aAfter.receipts;
  log(`  [A] receipts after close: ${JSON.stringify(A.receiptsAfterClose)}`);
  A.originalUnchanged =
    A.receiptsAtTender.length > 0 &&
    A.receiptsAfterClose.length > 0 &&
    A.receiptsAfterClose.find((r) => r.issueSeq === 1)?.issuedAt === A.receiptsAtTender[0].issuedAt;

  await go(page, `/app/pos/orders/${a.orderId}/receipt`, 6000);
  A.billAfterClose = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      reprintBanner: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    };
  });
  log("  [A] bill after close:", JSON.stringify(A.billAfterClose));
  await shot(page, "A-05-bill-after-close");
  result.scenarios.A = A;

  // ══ B. SPLIT TENDER: half now, half a moment later ══
  log("\n═══ B. split tender — half now, the rest a moment later ═══");
  const B = {};
  const b = await ringAndFire(page, "B");
  B.order = b;
  const balanceRs = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="remaining-balance-value"]');
    return el ? Number(el.getAttribute("data-paisa")) : null;
  });
  B.balancePaisa = balanceRs;
  const half = balanceRs ? Math.floor(balanceRs / 2) : null;
  B.halfPaisa = half;
  if (half) {
    await tender(page, "B", { method: "CASH", amountText: (half / 100).toFixed(2) });
    await page.waitForTimeout(2500);
    B.stripAfterHalf = await readStrip(page);
    const bHalfJobs = await receiptsFor(page, b.orderId, token);
    B.receiptsAfterHalf = bHalfJobs.receipts;
    log(`  [B] after HALF: strip=${JSON.stringify(B.stripAfterHalf)} receipts=${B.receiptsAfterHalf.length}`);
    await shot(page, "B-01-after-half");

    // the rest
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const t2 = await tender(page, "B", { method: "CASH", amountText: null });
    B.secondTender = t2;
    await page.waitForTimeout(2500);
    B.stripAfterFull = await readStrip(page);
    const bFullJobs = await receiptsFor(page, b.orderId, token);
    B.receiptsAfterFull = bFullJobs.receipts;
    const bPayments = await apiGet(page, `/api/v1/pos/orders/${b.orderId}/payments`, token);
    B.payments = bPayments.body?.data ?? [];
    const last = B.payments[B.payments.length - 1];
    B.lastRecordedAt = last?.recordedAt ?? null;
    if (B.lastRecordedAt && B.receiptsAfterFull.length) {
      B.settleToBillMs = new Date(B.receiptsAfterFull[0].issuedAt) - new Date(B.lastRecordedAt);
    }
    log(`  [B] after FULL: strip=${JSON.stringify(B.stripAfterFull)} receipts=${B.receiptsAfterFull.length} gapMs=${B.settleToBillMs}`);
    await shot(page, "B-02-after-full");
  }
  result.scenarios.B = B;

  // ══ C. CARD tender in full — a different money seam, no till ══
  log("\n═══ C. CARD in full ═══");
  const C = {};
  const c = await ringAndFire(page, "C");
  C.order = c;
  const cT = await tender(page, "C", { method: "CARD", amountText: null });
  C.tender = cT;
  await page.waitForTimeout(2500);
  C.strip = await readStrip(page);
  const cJobs = await receiptsFor(page, c.orderId, token);
  C.receipts = cJobs.receipts;
  const cPayments = await apiGet(page, `/api/v1/pos/orders/${c.orderId}/payments`, token);
  C.payments = cPayments.body?.data ?? [];
  C.recordedAt = C.payments[0]?.recordedAt ?? null;
  if (C.recordedAt && C.receipts.length) {
    C.tenderToBillMs = new Date(C.receipts[0].issuedAt) - new Date(C.recordedAt);
  }
  log(`  [C] strip=${JSON.stringify(C.strip)} receipts=${C.receipts.length} gapMs=${C.tenderToBillMs}`);
  await shot(page, "C-01-card-after-payment");
  result.scenarios.C = C;

  // ══ D. cash OVER-tender — change handed back ══
  log("\n═══ D. cash over-tender, change handed back ═══");
  const D = {};
  const d = await ringAndFire(page, "D");
  D.order = d;
  // Full amount, then a bigger note: pick the largest denomination button available.
  await page.locator("[data-testid=fill-full-amount-button]").click();
  await page.waitForTimeout(400);
  const denoms = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="denom-"]'))
      .map((n) => n.getAttribute("data-testid"))
      .filter((x) => /^denom-\d+$/.test(x)),
  );
  D.denoms = denoms;
  const biggest = denoms[denoms.length - 1];
  if (biggest) {
    await page.locator(`[data-testid="${biggest}"]`).click();
    await page.waitForTimeout(400);
    await page.locator(`[data-testid="${biggest}"]`).click();
    await page.waitForTimeout(600);
  }
  D.changeDueBefore = await page.evaluate(
    () => document.querySelector('[data-testid="change-due-total"]')?.getAttribute("data-paisa") ?? null,
  );
  const dClickedAt = new Date();
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  D.clickedAt = dClickedAt.toISOString();
  D.strip = await readStrip(page);
  const dJobs = await receiptsFor(page, d.orderId, token);
  D.receipts = dJobs.receipts;
  const dPayments = await apiGet(page, `/api/v1/pos/orders/${d.orderId}/payments`, token);
  D.payments = dPayments.body?.data ?? [];
  D.recordedAt = D.payments[0]?.recordedAt ?? null;
  if (D.recordedAt && D.receipts.length) {
    D.tenderToBillMs = new Date(D.receipts[0].issuedAt) - new Date(D.recordedAt);
  }
  log(`  [D] changeDue=${D.changeDueBefore} strip=${JSON.stringify(D.strip)} receipts=${D.receipts.length} gapMs=${D.tenderToBillMs}`);
  log(`  [D] payment row: ${JSON.stringify(D.payments[0])}`);
  await shot(page, "D-01-overtender-after-payment");
  result.scenarios.D = D;

  result.tokenForApiProbes = token;
} catch (err) {
  result.error = String(err);
  log("\n!! " + err);
  await shot(page, "99-failure");
} finally {
  result.finishedAt = new Date().toISOString();
  writeFileSync(`${OUT}/verify-3-3-reopen.json`, JSON.stringify(result, null, 2));
  log(`\nwrote ${OUT}/verify-3-3-reopen.json`);
  await browser.close();
}
