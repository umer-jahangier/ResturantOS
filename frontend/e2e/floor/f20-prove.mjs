/*
 * F20 — PROOF.
 *
 * DONE MEANS, driven end to end in real Chromium as the people who do these jobs:
 *
 *   A. OWNER configures a 5% service charge for the branch.
 *   B. CASHIER rings a dine-in check and SEES the charge computed on the charge page
 *      before any payment.
 *   C. CASHIER settles it on a CARD with a Rs 100.00 tip.
 *   D. The guest's printed bill carries the same service charge, and the tip on its own line.
 *   E. OWNER opens the journal entry: the service charge is credited to its OWN account and the
 *      tip to the Tips Payable liability — the same figures, to the paisa.
 *   F. OWNER switches the charge OFF; a new dine-in check shows NO service-charge line at all.
 *   G. The settings screen at 390/768/1440, light and dark.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, apiGet, log,
} from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20");
mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
};

const RESULT = { steps: {} };
const record = (k, v) => {
  RESULT.steps[k] = v;
  log(`  [${k}]`, JSON.stringify(v));
};

/**
 * Tap a tile and get the line onto the cart, whatever the dish demands.
 *
 * S6 shipped modifier groups while this was being written: a dish with a REQUIRED group opens a
 * configure dialog and the tap alone adds nothing. This satisfies the REQUIRED groups only —
 * clicking the first option of any group still showing its "choose exactly N" error — and
 * deliberately leaves the OPTIONAL ones alone, because a paid add-on would move the subtotal and
 * this proof's arithmetic has to stay checkable by hand off the screenshot.
 *
 * Tolerant of a dish with no dialog at all: both kinds are on this menu.
 */
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
    // The groups that are still refusing, in DOM order.
    const groupIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-testid^=modifier-group-error-]"))
        .map((n) => n.getAttribute("data-testid").replace("modifier-group-error-", "")),
    );
    if (groupIds.length === 0) break;
    for (const gid of groupIds) {
      const option = page
        .locator(`[data-testid="modifier-group-${gid}"] [data-testid^="modifier-option-"][aria-checked="false"]`)
        .first();
      if (await option.count()) {
        await option.click();
        await page.waitForTimeout(300);
      }
    }
  }
  await add.click({ timeout: 15000 });
  await page.waitForTimeout(900);
}

/**
 * `login` with a retry, because a TOTP code minted at second 29 of its window is invalid by the
 * time the form is submitted. That is a flake in the harness, not a finding about the product,
 * and a proof run that dies on it teaches nothing.
 */
async function signIn(page, who, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await login(page, who);
    } catch (err) {
      if (i >= attempts) throw err;
      log(`  ! sign-in attempt ${i} for ${who.email} failed (${err.message}); retrying`);
      await page.waitForTimeout(4000);
    }
  }
}

/**
 * Get Next's dev-overlay out of the way.
 *
 * Ten agents share this stack and services restart under each other; a single 503 raises an
 * unhandled rejection, and Next's dev overlay then mounts a `<nextjs-portal>` that intercepts
 * every pointer event on the page. Playwright reports that as "element intercepts pointer
 * events", which reads exactly like a broken control. The overlay is a DEV-SERVER artifact and
 * nothing a user of a built app ever sees, so removing it measures the product rather than the
 * harness's own weather.
 */
async function clearDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
  });
}

/**
 * Fire the cart and return the check that was just created — BY ITS NUMBER.
 *
 * Reading `GET /orders?size=3` and taking row 0 is not the same question. Ten agents ring orders
 * on this branch concurrently and the listing is not ordered by creation, so "the newest row"
 * silently became somebody else's check — which is how the first run of this proof "measured" a
 * service charge on an order it had not rung. The terminal prints the number it just allocated;
 * this reads that, then finds exactly that row by search.
 */
async function fireAndFindCheck(page, branchId) {
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(6000);
  const orderNo = await page.evaluate(
    () => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null,
  );
  if (!orderNo) throw new Error("the terminal never showed an order number after Send to Kitchen");
  const found = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branchId}&q=${encodeURIComponent(orderNo)}&size=5`,
  );
  const row = (found.body?.data ?? []).find((r) => r.orderNo === orderNo);
  if (!row) throw new Error(`the server does not have ${orderNo}`);
  return { orderNo, orderId: row.orderId ?? row.id, totalPaisa: row.totalPaisa };
}

const browser = await newBrowser();

// ── A. the owner sets 5% ──────────────────────────────────────────────────────
log("\n=== A. OWNER configures a 5% service charge ===");
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);

/**
 * Open the settings screen and WAIT for the form, not for a clock.
 *
 * The screen renders a loading skeleton while the policy read is in flight; a fixed pause
 * screenshots the skeleton and then fails on a control that has not mounted, which reads exactly
 * like a missing feature. This waits for the control and re-reads the trouble probe afterwards.
 */
async function openServiceChargeScreen(page) {
  const t = await go(page, "/app/settings/service-charge", { waitMs: 2500, allowTrouble: true });
  await clearDevOverlay(page);
  await page.locator("[data-testid=service-charge-enabled]").waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  return t;
}

let tr = await openServiceChargeScreen(own);
log("  /app/settings/service-charge:", JSON.stringify(tr));
if (tr.bad.length) throw new Error(`settings page is broken: ${tr.bad.join(",")}`);
await shot(own, "p01-service-charge-screen");

const before = await own.evaluate(() => ({
  enabled: document.querySelector("[data-testid=service-charge-enabled]")?.checked ?? null,
  rate: document.querySelector("[data-testid=service-charge-rate]")?.value ?? null,
  label: document.querySelector("[data-testid=service-charge-label]")?.value ?? null,
  preview: document.querySelector("[data-testid=service-charge-preview]")?.getAttribute("data-paisa"),
  readOnlyNotice: !!document.querySelector("[data-testid=service-charge-read-only-notice]"),
  saveDisabled: document.querySelector("[data-testid=service-charge-save]")?.disabled ?? null,
  inNav: Array.from(document.querySelectorAll("a")).some(
    (a) => a.getAttribute("href") === "/app/settings/service-charge",
  ),
}));
record("A-before", before);

// Type it the way a person does.
await own.locator("[data-testid=service-charge-enabled]").check();
await own.locator("[data-testid=service-charge-rate]").fill("");
await own.locator("[data-testid=service-charge-rate]").type("5");
await own.locator("[data-testid=service-charge-label]").fill("Service charge");
await own.waitForTimeout(500);
const preview = await own.evaluate(() =>
  document.querySelector("[data-testid=service-charge-preview]")?.getAttribute("data-paisa"),
);
record("A-preview-on-a-2000-check", { paisa: preview });
await shot(own, "p02-service-charge-filled");

await own.locator("[data-testid=service-charge-save]").click();
await own.waitForTimeout(3500);
await shot(own, "p03-service-charge-saved");

const branchesOwner = await apiGet(own, "/api/v1/branches/mine");
const branchId = (branchesOwner.body?.data ?? [])[0]?.id;
const saved = await apiGet(own, `/api/v1/pos/branches/${branchId}/service-charge`);
record("A-persisted", { branchId, status: saved.status, body: saved.body?.data });

// ── B. the cashier rings a dine-in check ──────────────────────────────────────
log("\n=== B. CASHIER rings a dine-in check ===");
const cash = await newPage(browser);
await signIn(cash, PEOPLE.cashier);
tr = await go(cash, "/app/pos", { waitMs: 8000 });
await clearDevOverlay(cash);
if (tr.bad.length) throw new Error(`/app/pos is broken: ${tr.bad.join(",")}`);

await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(400);
// Two of the same dish, so the arithmetic is checkable by hand from the screenshot.
await tapTile(cash, 0);
await tapTile(cash, 0);
await shot(cash, "p04-cart");

const check = await fireAndFindCheck(cash, branchId);
const orderId = check.orderId;
record("B-order", check);

tr = await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
await clearDevOverlay(cash);
if (tr.bad.length) throw new Error(`charge page is broken: ${tr.bad.join(",")}`);
await shot(cash, "p05-charge-page-with-service-charge");

const chargeProbe = await cash.evaluate(() => {
  // Scoped to the BILL section. The sidebar now carries a "Service Charge" nav entry, so a
  // whole-document text match would answer this question with the navigation rather than the bill
  // — the shape of mistake that lets a screen be scored on the chrome around it.
  const bill = Array.from(document.querySelectorAll("section")).find((s) =>
    /^Bill/.test((s.innerText || "").trim()),
  );
  const t = bill?.innerText ?? "";
  const rows = Object.fromEntries(
    t
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .reduce((acc, line, i, all) => {
        const m = /^(-?Rs [\d,]+\.\d\d)$/.exec(line);
        if (m && i > 0) acc.push([all[i - 1], m[1]]);
        return acc;
      }, []),
  );
  return {
    billRows: rows,
    serviceChargeCaption: Object.keys(rows).find((k) => /service charge/i.test(k)) ?? null,
    serviceChargeValue:
      rows[Object.keys(rows).find((k) => /service charge/i.test(k)) ?? ""] ?? null,
    tipInputPresent: !!document.querySelector("[data-testid=tip-input]"),
  };
});
record("B-charge-page", chargeProbe);

const orderDto = await apiGet(cash, `/api/v1/pos/orders/${orderId}?branchId=${branchId}`);
const o = orderDto.body?.data;
record("B-server-order", {
  subtotalPaisa: o?.subtotalPaisa,
  serviceChargePaisa: o?.serviceChargePaisa,
  serviceChargePct: o?.serviceChargePct,
  serviceChargeLabel: o?.serviceChargeLabel,
  taxPaisa: o?.taxPaisa,
  totalPaisa: o?.totalPaisa,
  invariantHolds:
    o?.subtotalPaisa - o?.discountPaisa + o?.taxPaisa + o?.serviceChargePaisa === o?.totalPaisa,
});

// ── C. settle on a card, with a tip ───────────────────────────────────────────
log("\n=== C. CASHIER settles on a CARD with a Rs 100.00 tip ===");
await cash.selectOption("select[aria-label='Payment method']", "CARD");
await cash.waitForTimeout(400);
await cash.locator("[data-testid=fill-full-amount-button]").click();
await cash.waitForTimeout(300);
await cash.locator("[data-testid=tip-input]").fill("100");
await cash.waitForTimeout(600);
const tipPreview = await cash.evaluate(() => ({
  offTheCard: document.querySelector("[data-testid=tender-plus-tip-value]")?.getAttribute("data-paisa"),
  tipTotal: document.querySelector("[data-testid=tip-total-value]")?.getAttribute("data-paisa"),
  caption:
    document.querySelector("[data-testid=tender-plus-tip-value]")?.previousElementSibling
      ?.textContent ?? null,
}));
record("C-before-submit", tipPreview);
await shot(cash, "p06-tip-entered");

await cash.locator("[data-testid=record-payment-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "p07-after-card-payment-with-tip");

const afterPay = await cash.evaluate(() => {
  const t = document.body.innerText;
  const row = (label) =>
    new RegExp(label + "\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)").exec(t)?.[1] ?? null;
  return {
    amountPaid: row("Amount paid"),
    remaining: row("Remaining balance"),
    tipLine: document.querySelector("[data-testid=payment-history-tip]")?.textContent?.trim() ?? null,
    tipPaisa: document.querySelector("[data-testid=payment-history-tip]")?.getAttribute("data-paisa"),
  };
});
record("C-after-payment", afterPay);

const payments = await apiGet(cash, `/api/v1/pos/orders/${orderId}/payments`);
record("C-server-payments", (payments.body?.data ?? []).map((p) => ({
  method: p.method,
  amountPaisa: p.amountPaisa,
  tipPaisa: p.tipPaisa,
  tenderedPaisa: p.tenderedPaisa,
  changePaisa: p.changePaisa,
})));

// ── D. the guest's bill ───────────────────────────────────────────────────────
log("\n=== D. the printed bill ===");
tr = await go(cash, `/app/pos/orders/${orderId}/receipt`, { waitMs: 7000 });
log("  receipt route:", JSON.stringify(tr));
await shot(cash, "p08-printed-bill");
const bill = await cash.evaluate(() => {
  const root = document.querySelector("[data-testid=receipt-root]");
  const rowText = (testid) => document.querySelector(`[data-testid=${testid}]`)?.textContent?.trim() ?? null;
  return {
    rendered: !!root,
    serviceChargeRow: rowText("receipt-service-charge-row"),
    tipRow: rowText("receipt-tip-row"),
    text: (root?.textContent ?? "").replace(/\s+/g, " ").slice(0, 900),
  };
});
record("D-bill", bill);

// ── E. the journal entry ──────────────────────────────────────────────────────
log("\n=== E. OWNER reads the journal entry ===");
// Serve the lines so the order CLOSES and ORDER_CLOSED is published — the ledger only sees a
// closed check. Done from the charge page's own control, as a cashier would.
await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 4000 });
await clearDevOverlay(cash);
const closeBtn = cash.locator("[data-testid=close-order-button], button", { hasText: /Close order|Mark served/i }).first();
if (await closeBtn.count()) {
  await closeBtn.click();
  await cash.waitForTimeout(6000);
}
await shot(cash, "p09-order-closed");
const closed = await apiGet(cash, `/api/v1/pos/orders/${orderId}?branchId=${branchId}`);
record("E-order-status", { status: closed.body?.data?.status });

// The ledger is asynchronous — ORDER_CLOSED crosses a broker. Poll for it rather than sleeping a
// guessed interval and reporting "no entry" for a consumer that simply had not run yet.
let je = null;
for (let i = 0; i < 20; i += 1) {
  je = await apiGet(own, `/api/v1/finance/journal-entries/by-source/${orderId}?resolveSource=true`);
  const rows = je.body?.data ?? je.body;
  if (Array.isArray(rows) && rows.length > 0) break;
  await own.waitForTimeout(3000);
}
record("E-journal-entries", { status: je?.status, body: JSON.parse(JSON.stringify(je?.body ?? null)) });

tr = await go(own, "/app/finance/transactions", { waitMs: 6000 });
log("  /app/finance/transactions:", JSON.stringify(tr));
await shot(own, "p10-transactions");

// ── F. switch it off; a new check carries no line at all ──────────────────────
log("\n=== F. charge switched OFF -> no zero line anywhere ===");
await openServiceChargeScreen(own);
await own.locator("[data-testid=service-charge-enabled]").uncheck();
await own.waitForTimeout(300);
await own.locator("[data-testid=service-charge-save]").click();
await own.waitForTimeout(3500);
await shot(own, "p11-service-charge-off");

await go(cash, "/app/pos", { waitMs: 7000 });
await clearDevOverlay(cash);
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(400);
await tapTile(cash, 0);
const check2 = await fireAndFindCheck(cash, branchId);
const orderId2 = check2.orderId;
await go(cash, `/app/pos/orders/${orderId2}/charge`, { waitMs: 5000 });
await shot(cash, "p12-charge-page-no-service-charge");
const noCharge = await cash.evaluate(() => {
  // Scoped to the BILL section, NOT the document: the sidebar's own "Service Charge" nav entry
  // would otherwise answer this question and hide the very thing it is asking about.
  const bill = Array.from(document.querySelectorAll("section")).find((s) =>
    /^Bill/.test((s.innerText || "").trim()),
  );
  return {
    billSectionFound: !!bill,
    anyServiceChargeTextInBill: /service charge/i.test(bill?.innerText ?? ""),
    bill: (bill?.innerText ?? "").replace(/\s+/g, " ").slice(0, 400),
  };
});
record("F-no-service-charge-line", { orderNo: check2.orderNo, ...noCharge });

// The receipt too — the other half of the finding.
await go(cash, `/app/pos/orders/${orderId2}/receipt`, { waitMs: 6000, allowTrouble: true });
const bill2 = await cash.evaluate(() => {
  const root = document.querySelector("[data-testid=receipt-root]");
  return {
    rendered: !!root,
    serviceChargeRow: !!document.querySelector("[data-testid=receipt-service-charge-row]"),
    anyServiceChargeText: /service charge/i.test(root?.textContent ?? ""),
  };
});
record("F-bill-no-service-charge", bill2);
await shot(cash, "p13-bill-no-service-charge");

// ── G. the screen at three widths, both themes ────────────────────────────────
log("\n=== G. responsive + themes ===");
// Put the charge back on, so the screenshots show a configured branch.
await openServiceChargeScreen(own);
await own.locator("[data-testid=service-charge-enabled]").check();
await own.locator("[data-testid=service-charge-rate]").fill("5");
await own.locator("[data-testid=service-charge-save]").click();
await own.waitForTimeout(3000);

for (const [w, h] of [[390, 844], [768, 1024], [1440, 950]]) {
  for (const scheme of ["light", "dark"]) {
    await own.setViewportSize({ width: w, height: h });
    await own.emulateMedia({ colorScheme: scheme });
    await go(own, "/app/settings/service-charge", { waitMs: 3000 });
    await own.waitForTimeout(800);
    await shot(own, `p14-settings-${w}-${scheme}`);
  }
}
await own.setViewportSize({ width: 1440, height: 950 });
await own.emulateMedia({ colorScheme: "light" });

// ── the MANAGER's read-only view ──────────────────────────────────────────────
log("\n=== H. a branch MANAGER can read the rate and not change it ===");
const mgr = await newPage(browser);
await signIn(mgr, PEOPLE.manager);
tr = await go(mgr, "/app/settings/service-charge", { waitMs: 4000, allowTrouble: true });
const mgrView = await mgr.evaluate(() => ({
  bodyHead: document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
  readOnlyNotice:
    document.querySelector("[data-testid=service-charge-read-only-notice]")?.textContent?.trim() ?? null,
  rate: document.querySelector("[data-testid=service-charge-rate]")?.value ?? null,
  rateDisabled: document.querySelector("[data-testid=service-charge-rate]")?.disabled ?? null,
  saveDisabled: document.querySelector("[data-testid=service-charge-save]")?.disabled ?? null,
}));
record("H-manager", { trouble: tr.bad, ...mgrView });
await shot(mgr, "p15-manager-read-only");

writeFileSync(`${OUT}/prove.json`, JSON.stringify(RESULT, null, 2));
await browser.close();
log("\nF20 proof done ->", `${OUT}/prove.json`);
