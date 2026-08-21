/*
 * RE-OPEN ATTEMPT — §3-3 "the bill prints at close, not at tender".
 *
 * Independent drive, written from the brief and not from the other agent's harness. The claim
 * under test is that the ORIGINAL customer receipt is now anchored to the TENDER, and that the
 * later close cannot claim to be it.
 *
 * Scenario A — the exact path DONE MEANS names:
 *   ring a dine-in check, fire it, take CASH for the full amount, and STOP.
 *   Then: is there a bill? Does the SCREEN say so? Does it survive a RELOAD?
 *   Then close, and check the close did not re-stamp or duplicate the original.
 *
 * Every assertion is recorded as pass/fail in the JSON so a reader can disagree with me.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F7-reopen";
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const R = { scenario: "A-tender", startedAt: new Date().toISOString(), checks: [] };
const log = (...a) => console.log(...a);
const check = (name, ok, detail) => {
  R.checks.push({ name, ok: !!ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};
const shot = async (page, n) => {
  await page.screenshot({ path: `${OUT}/a-${n}.png` });
  log(`    shot a-${n}.png`);
};

async function trouble(page) {
  return page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.innerText || "").trim()).filter(Boolean),
    bad: /Couldn.t load|Something went wrong|Access denied|You do not have permission|unavailable right now/i.test(document.body.innerText || ""),
  }));
}

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

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

try {
  // ── sign in ────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(CASHIER.slug);
  await page.locator('input[name="email"], input#email').first().fill(CASHIER.email);
  await page.locator('input[name="password"], input#password').first().fill(CASHIER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) throw new Error("cashier login failed: " + page.url());
  log(`signed in as ${CASHIER.email}`);
  let token = await tokenOf(page);

  // ── ring + fire ────────────────────────────────────────────────────────────
  log("\n=== ring a dine-in check and fire it ===");
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  let t = await trouble(page);
  if (t.bad) {
    log("  ! POS looked broken, retrying: " + JSON.stringify(t));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    t = await trouble(page);
  }
  R.posLoad = t;
  if (t.bad) throw new Error("POS terminal is in an error state: " + JSON.stringify(t));

  await page.locator("[data-testid=order-type-dine_in]").click();
  await page.waitForTimeout(500);
  const trigger = page.locator("[data-testid=table-select-trigger]");
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(1500);
    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
        id: n.getAttribute("data-testid"),
        t: n.innerText.replace(/\s+/g, " ").trim(),
        disabled: n.getAttribute("aria-disabled") === "true",
      })));
    const free = opts.find((o) => !o.disabled && /available/i.test(o.t)) ?? opts.find((o) => !o.disabled);
    if (free) { R.table = free.t; await page.locator(`[data-testid="${free.id}"]`).click(); await page.waitForTimeout(900); }
    else { await page.keyboard.press("Escape"); await page.waitForTimeout(400);
           await page.locator("[data-testid=order-type-takeaway]").click(); await page.waitForTimeout(600);
           R.table = "TAKEAWAY (no free table)"; }
  }
  log("  table: " + R.table);

  // Some dishes now open a modifier dialog (S6). Add it as-is and move on; a required group
  // that blocks the add means this dish is not usable for the tender path, so skip to the next.
  const addTile = async (i) => {
    const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
    await tiles.first().waitFor({ timeout: 30000 });
    await tiles.nth(i).click({ timeout: 15000 });
    await page.waitForTimeout(900);
    const dlg = page.locator('[data-testid="modifier-dialog"]');
    if (await dlg.count()) {
      const add = page.locator('[data-testid="modifier-dialog-add"]');
      if ((await add.count()) && (await add.first().isEnabled())) {
        await add.first().click();
        await page.waitForTimeout(900);
        return true;
      }
      // required choice — pick the first option of each group, then add
      const opts = page.locator('[data-testid^="modifier-option-"]');
      const n = Math.min(await opts.count(), 1);
      for (let k = 0; k < n; k++) { await opts.nth(k).click(); await page.waitForTimeout(300); }
      if ((await add.count()) && (await add.first().isEnabled())) {
        await add.first().click(); await page.waitForTimeout(900); return true;
      }
      await page.keyboard.press("Escape"); await page.waitForTimeout(600);
      return false;
    }
    return true;
  };
  let added = 0;
  for (let i = 0; i < 12 && added < 2; i++) {
    if (await addTile(i)) added++;
  }
  if (added === 0) throw new Error("could not add any menu item to the cart");
  R.itemsAdded = added;
  await shot(page, "01-cart");
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(7000);
  await shot(page, "02-fired");

  // ── charge: cash, full amount, then STOP ───────────────────────────────────
  log("\n=== CHARGE NOW → full cash → STOP ===");
  await page.locator("[data-testid=charge-now-button]").click();
  await page.waitForTimeout(7000);
  const orderId = /\/orders\/([0-9a-f-]{36})\/charge/.exec(page.url())?.[1];
  if (!orderId) throw new Error("no charge page: " + page.url());
  R.orderId = orderId;
  R.orderNo = await page.evaluate(() => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null);
  log(`  order ${R.orderNo} (${orderId})`);
  await shot(page, "03-charge-before-payment");

  // the strip BEFORE any payment: it must say no bill exists yet
  R.stripBeforePayment = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="bill-issued-strip"]');
    return n ? { text: n.innerText.replace(/\s+/g, " ").trim(), issued: n.getAttribute("data-bill-issued") } : null;
  });
  check("before any tender the screen says NO bill exists",
    R.stripBeforePayment && R.stripBeforePayment.issued === "false", R.stripBeforePayment);

  const jobsBefore = await api(page, `/api/v1/pos/orders/${orderId}/print-jobs`, token);
  R.receiptsBeforePayment = (jobsBefore.body?.data ?? []).filter((j) => j.documentType === "CUSTOMER_RECEIPT");
  check("no CUSTOMER_RECEIPT row before the tender", R.receiptsBeforePayment.length === 0, R.receiptsBeforePayment);

  await page.locator("[data-testid=fill-full-amount-button]").click();
  await page.waitForTimeout(500);
  R.amountFilled = await page.locator('input[aria-label="Amount (Rs)"]').first().inputValue();
  await page.locator("[data-testid=denom-exact]").first().click();
  await page.waitForTimeout(600);
  await shot(page, "04-tender-typed");

  R.clickedPayAt = new Date().toISOString();
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  for (let i = 0; i < 3; i++) {
    const failed = await page.evaluate(() => /Failed to record payment|unavailable right now/i.test(document.body.innerText));
    if (!failed) break;
    log(`  ! tender refused (attempt ${i + 1}) — stack settling, retrying`);
    R.tenderRetries = (R.tenderRetries ?? 0) + 1;
    await page.waitForTimeout(15000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    if (await page.locator("[data-testid=fill-full-amount-button]").count()) {
      await page.locator("[data-testid=fill-full-amount-button]").click(); await page.waitForTimeout(400);
      await page.locator("[data-testid=denom-exact]").first().click(); await page.waitForTimeout(400);
      R.clickedPayAt = new Date().toISOString();
      await page.locator("[data-testid=record-payment-button]").click(); await page.waitForTimeout(8000);
    }
  }
  await shot(page, "05-after-payment-STOPPED-HERE");

  // ── the state we are scoring ───────────────────────────────────────────────
  R.screenAtTender = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="bill-issued-strip"]');
    return {
      strip: strip ? strip.innerText.replace(/\s+/g, " ").trim() : null,
      billIssued: strip?.getAttribute("data-bill-issued") ?? null,
      billIssuedAt: strip?.getAttribute("data-bill-issued-at") ?? null,
      billTarget: strip?.getAttribute("data-bill-target") ?? null,
      closeCta: document.querySelector('[data-testid="close-order-button"]')?.innerText?.trim() ?? null,
      closedChip: document.querySelector('[data-testid="charge-closed-chip"]')?.innerText?.trim() ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
      bodyHasSent: /\bSent\b/.test(document.body.innerText),
      bodyHasServed: /\bServed\b/.test(document.body.innerText),
    };
  });
  log("  screen at tender: " + JSON.stringify(R.screenAtTender, null, 1));

  token = (await tokenOf(page)) ?? token;
  const orderNow = await api(page, `/api/v1/pos/orders/${orderId}`, token);
  R.orderAtTender = {
    status: orderNow.body?.data?.status ?? null,
    paymentStatus: orderNow.body?.data?.paymentStatus ?? null,
    closedAt: orderNow.body?.data?.closedAt ?? null,
    totalPaisa: orderNow.body?.data?.totalPaisa ?? null,
    items: (orderNow.body?.data?.items ?? []).map((i) => i.status),
  };
  log("  order at tender: " + JSON.stringify(R.orderAtTender));
  check("the check is NOT closed at this moment (we never marked served)",
    R.orderAtTender.status !== "CLOSED" && !R.orderAtTender.closedAt, R.orderAtTender);

  const pays = await api(page, `/api/v1/pos/orders/${orderId}/payments`, token);
  R.payments = pays.body?.data ?? [];
  const recordedAt = R.payments[0]?.recordedAt ?? null;

  const jobs = await api(page, `/api/v1/pos/orders/${orderId}/print-jobs`, token);
  R.printJobsStatus = jobs.status;
  R.receiptsAtTender = (jobs.body?.data ?? []).filter((j) => j.documentType === "CUSTOMER_RECEIPT");
  log("  receipts at tender: " + JSON.stringify(R.receiptsAtTender, null, 1));

  check("a CUSTOMER_RECEIPT exists the moment the money is taken", R.receiptsAtTender.length === 1,
    { count: R.receiptsAtTender.length });
  const orig = R.receiptsAtTender[0];
  check("that receipt is the ORIGINAL (issueSeq 1, no originalIssuedAt)",
    orig && orig.issueSeq === 1 && !orig.originalIssuedAt, orig);
  if (recordedAt && orig) {
    R.tenderToBillMs = new Date(orig.issuedAt) - new Date(recordedAt);
    check("the original is stamped within 10s of the payment", Math.abs(R.tenderToBillMs) < 10000,
      { recordedAt, issuedAt: orig.issuedAt, gapMs: R.tenderToBillMs });
  }
  check("the SCREEN tells the cashier the bill exists",
    R.screenAtTender.billIssued === "true" && /Bill issued/i.test(R.screenAtTender.strip ?? ""),
    R.screenAtTender.strip);

  // ── does it PERSIST across a reload? ───────────────────────────────────────
  log("\n=== reload the charge page ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  R.stripAfterReload = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="bill-issued-strip"]');
    return n ? { text: n.innerText.replace(/\s+/g, " ").trim(), issued: n.getAttribute("data-bill-issued"),
                 at: n.getAttribute("data-bill-issued-at") } : null;
  });
  await shot(page, "06-after-reload");
  check("the bill strip survives a reload with the same issue time",
    R.stripAfterReload?.issued === "true" && R.stripAfterReload?.at === R.screenAtTender.billIssuedAt,
    R.stripAfterReload);

  // ── the bill itself, reached from the charge page ──────────────────────────
  log("\n=== Print bill, at tender ===");
  await page.locator("[data-testid=print-bill-button]").click();
  await page.waitForTimeout(6000);
  R.billAtTender = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      url: location.href,
      reprint: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      cash: /CASH\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    };
  });
  log("  bill at tender: " + JSON.stringify(R.billAtTender, null, 1));
  await shot(page, "07-bill-at-tender");
  check("the bill reachable at tender carries the tender-time original stamp",
    orig && R.billAtTender.originallyIssued?.includes(orig.issuedAt.replace(/Z$/, "").slice(0, 19)),
    { orig: orig?.issuedAt, banner: R.billAtTender.originallyIssued });

  // ── NOW close ──────────────────────────────────────────────────────────────
  log("\n=== mark served & close ===");
  await page.goto(`${BASE}/app/pos/orders/${orderId}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const closeBtn = page.locator("[data-testid=close-order-button]");
  R.closeCtaPresent = (await closeBtn.count()) > 0;
  if (R.closeCtaPresent) { await closeBtn.click(); await page.waitForTimeout(8000); }
  await shot(page, "08-after-close");

  token = (await tokenOf(page)) ?? token;
  const orderClosed = await api(page, `/api/v1/pos/orders/${orderId}`, token);
  R.orderAfterClose = { status: orderClosed.body?.data?.status ?? null, closedAt: orderClosed.body?.data?.closedAt ?? null };
  log("  order after close: " + JSON.stringify(R.orderAfterClose));

  const jobs2 = await api(page, `/api/v1/pos/orders/${orderId}/print-jobs`, token);
  R.receiptsAfterClose = (jobs2.body?.data ?? []).filter((j) => j.documentType === "CUSTOMER_RECEIPT");
  log("  receipts after close: " + JSON.stringify(R.receiptsAfterClose, null, 1));
  const origAfter = R.receiptsAfterClose.find((j) => j.issueSeq === 1);
  check("the close did NOT re-stamp the original",
    orig && origAfter && origAfter.issuedAt === orig.issuedAt, { before: orig?.issuedAt, after: origAfter?.issuedAt });
  check("the close produced no SECOND original (nothing claims seq 1 twice)",
    R.receiptsAfterClose.filter((j) => j.issueSeq === 1).length === 1, R.receiptsAfterClose.map((j) => j.issueSeq));
  if (R.orderAfterClose.closedAt && orig) {
    R.billBeforeCloseByMs = new Date(R.orderAfterClose.closedAt) - new Date(orig.issuedAt);
    check("the bill predates the close", R.billBeforeCloseByMs > 0,
      { closedAt: R.orderAfterClose.closedAt, billAt: orig.issuedAt, ms: R.billBeforeCloseByMs });
  }

  await page.goto(`${BASE}/app/pos/orders/${orderId}/receipt`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  R.billAfterClose = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      reprint: /\*\*\* REPRINT #\d+ \*\*\*[^\n]*/.exec(t)?.[0] ?? null,
      originallyIssued: /Originally issued[^\n]*/.exec(t)?.[0] ?? null,
      total: /TOTAL\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    };
  });
  await shot(page, "09-bill-after-close");
  log("  bill after close: " + JSON.stringify(R.billAfterClose, null, 1));
  check("a bill taken AFTER the close is a REPRINT of the tender-time original",
    /REPRINT/.test(R.billAfterClose.reprint ?? "") &&
      orig && (R.billAfterClose.originallyIssued ?? "").includes(orig.issuedAt.replace(/Z$/, "").slice(0, 19)),
    R.billAfterClose);
} catch (err) {
  R.error = String(err);
  log("\n!! " + err);
  try { await shot(page, "99-failure"); } catch {}
} finally {
  R.finishedAt = new Date().toISOString();
  R.failed = R.checks.filter((c) => !c.ok).map((c) => c.name);
  writeFileSync(`${OUT}/a-result.json`, JSON.stringify(R, null, 2));
  log(`\n${R.checks.filter((c) => c.ok).length}/${R.checks.length} checks passed`);
  if (R.failed.length) log("FAILED: " + JSON.stringify(R.failed, null, 1));
  await browser.close();
}
