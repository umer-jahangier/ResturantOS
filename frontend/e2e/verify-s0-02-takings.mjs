/*
 * S0-02 — "Cash taken against an open order never reaches the Takings screen".
 *
 * Controlled before/after, driven through the real UI as the branch manager:
 *   1. read /app/finance/takings for today  (baseline)
 *   2. in a second tab: /app/pos -> ring an item -> Send to Kitchen -> Charge CASH Rs 77.00,
 *      leaving every line UNSERVED so the order stays open (maybeCloseOrder will not fire)
 *   3. re-read /app/finance/takings  (after)
 *   4. optionally serve + close that same order and read a THIRD time, to prove the cash is
 *      not counted twice once the order closes.
 *
 * Run:  cd frontend && node e2e/verify-s0-02-takings.mjs <label>
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "run";
const CLOSE_TOO = process.argv.includes("--close");
const AMOUNT_PAISA = 7700;
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-02", LABEL);
const BASE = "http://localhost:3000";
const PERSONA = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};

mkdirSync(OUT, { recursive: true });
const log = [];
const PAGES = [];
function say(...parts) {
  const line = parts.join(" ");
  console.log(line);
  log.push(line);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  say("  shot:", `${name}.png`);
}

async function login(page) {
  await page.goto(`${BASE}/login?tenant=${PERSONA.slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(PERSONA.slug);
  await page.locator('input[name="email"], input#email').first().fill(PERSONA.email);
  await page.locator('input[name="password"], input#password').first().fill(PERSONA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/app\//, { timeout: 25_000 });
  say("signed in as", PERSONA.email);
}

/** Reads the Takings screen into a plain object. Refuses to read an error state as data. */
async function readTakings(page, tag) {
  await page.goto(`${BASE}/app/finance/takings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const alert = page.locator('[role="alert"]');
  if (await alert.count()) {
    const txt = (await alert.first().innerText().catch(() => "")).trim();
    if (txt) {
      say(`!! [${tag}] the screen is showing an alert, retrying once: ${JSON.stringify(txt)}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
    }
  }

  const data = await page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const tenders = {};
    document.querySelectorAll('[data-testid^="tender-row-"]').forEach((tr) => {
      const method = tr.getAttribute("data-testid").replace("tender-row-", "");
      const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
      tenders[method] = { count: cells[1], amount: cells[2] };
    });
    return {
      gross: text('[data-testid="figure-tile-gross-sales"]'),
      net: text('[data-testid="figure-tile-net-sales"]'),
      ordersLine: [...document.querySelectorAll("p")]
        .map((p) => p.textContent.trim())
        .find((t) => /orders? closed on this trading day/.test(t)) ?? null,
      unclosed: text('[data-testid="unclosed-tender-panel"]'),
      tenders,
      bodyHasAlert: !!document.querySelector('[role="alert"]'),
    };
  });
  // Ten agents share this stack. The reading is stamped so any payment that appears in the delta
  // can be attributed to a specific order by `recorded_at`, rather than assumed to be this test's.
  data.readAt = new Date().toISOString();
  say(`[${tag}] ${JSON.stringify(data, null, 2)}`);
  await shot(page, `${tag}-takings`);
  return data;
}

async function ringAndChargeCash(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  // ── till ────────────────────────────────────────────────────────────────
  if (await page.getByText("No active till").isVisible({ timeout: 3000 }).catch(() => false)) {
    say("no active till — opening one with a 5000.00 float");
    await page.getByTestId("open-till-button").click();
    await page.getByPlaceholder("e.g. 5000.00").fill("5000");
    await page.getByTestId("open-till-confirm-button").click();
    await page.getByText("Till OPEN").waitFor({ state: "visible", timeout: 20_000 });
  }
  say("till is OPEN");

  // ── ring an item ────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "POS Terminal", exact: true }).click().catch(() => {});
  const firstItem = page.getByTestId("menu-item-first");
  await firstItem.waitFor({ state: "visible", timeout: 25_000 });
  const itemLabel = (await firstItem.textContent())?.trim();
  await firstItem.click();
  // Ring it up enough times that the bill comfortably exceeds Rs 77.00, so the
  // payment is applied in full rather than capped at the outstanding balance.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(400);
    await firstItem.click();
  }
  say("rang up 4 x", JSON.stringify(itemLabel));

  // ── send to kitchen ─────────────────────────────────────────────────────
  const sendBtn = page.getByRole("button", { name: /^Send to Kitchen$/ });
  await sendBtn.waitFor({ state: "visible", timeout: 20_000 });
  const [kdsResp] = await Promise.all([
    page
      .waitForResponse((r) => /orders\/[^/]+\/(send-to-kds|fire)/.test(r.url()), { timeout: 25_000 })
      .catch(() => null),
    sendBtn.click(),
  ]);
  say("send-to-kds ->", kdsResp ? `${kdsResp.status()} ${kdsResp.url()}` : "no matching response");
  await page.waitForTimeout(2500);
  say("sent to kitchen");
  await shot(page, "pos-after-send");

  // ── charge CASH 7700 paisa, leave every line unserved ───────────────────
  await page.getByTestId("charge-now-button").click();
  await page.waitForURL(/\/app\/pos\/orders\/.+\/charge$/, { timeout: 20_000 });
  const orderId = page.url().match(/\/app\/pos\/orders\/([^/]+)\/charge$/)?.[1];
  say("charge page for order", orderId);

  const remaining = await page.getByTestId("remaining-balance-value").getAttribute("data-paisa");
  say("remaining balance (paisa):", remaining);
  if (Number(remaining) < AMOUNT_PAISA) {
    throw new Error(`bill ${remaining}p is smaller than the ${AMOUNT_PAISA}p test payment`);
  }

  await page.getByLabel("Payment method").first().selectOption("CASH");
  await page.getByLabel("Amount in paisa").first().fill(String(AMOUNT_PAISA));
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/payments") && r.request().method() === "POST",
      { timeout: 20_000 },
    ),
    page.getByTestId("record-payment-button").click(),
  ]);
  say("POST /payments ->", resp.status());
  if (!resp.ok()) {
    const body = await resp.text().catch(() => "");
    throw new Error(`recordPayment failed: HTTP ${resp.status()} ${body}`);
  }
  await page.waitForTimeout(2500);
  await shot(page, "pos-after-charge");

  const closedChip = await page
    .getByTestId("charge-closed-chip")
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  say("order shows as CLOSED after payment?", closedChip, "(must be false — nothing was served)");
  return orderId;
}

/** Serve every line then let maybeCloseOrder close the order. */
async function serveAndClose(page, orderId) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "Order Management", exact: true }).click();
  const row = page.getByTestId(`open-order-${orderId}`);
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click();
  await page.getByTestId("order-table-detail-drawer").waitFor({ state: "visible", timeout: 15_000 });
  // The drawer's frame renders before its LINES do. Waiting only on the drawer testid found no
  // "Mark …" button, reported "0 lines served" and read exactly like an order with nothing on it —
  // an empty state that was really a race. Wait for the control itself.
  const served0 = page.getByRole("button", { name: /^Mark .+ served$/i }).first();
  await served0.waitFor({ state: "visible", timeout: 20_000 });

  let served = 0;
  for (let i = 0; i < 12; i++) {
    const btn = page.getByRole("button", { name: /^Mark .+ served$/i }).first();
    if (!(await btn.isVisible({ timeout: 4000 }).catch(() => false))) break;
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/serve") && r.request().method() === "POST", {
        timeout: 20_000,
      }),
      btn.click(),
    ]);
    served++;
    await page.waitForTimeout(900);
  }
  say("marked", served, "line(s) served on order", orderId);
  await page.waitForTimeout(2000);
  await shot(page, "pos-after-serve");

  // Served is not enough: POS-23 closes only on paid AND served, and only Rs 77.00 of the bill
  // has been paid. Settle the remainder so the order actually reaches CLOSED.
  await page.goto(`${BASE}/app/pos/orders/${orderId}/charge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const remaining = await page.getByTestId("remaining-balance-value").getAttribute("data-paisa");
  say("remaining before final settlement (paisa):", remaining);
  await page.getByLabel("Payment method").first().selectOption("CASH");
  await page.getByTestId("fill-full-amount-button").click();
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/payments") && r.request().method() === "POST",
      { timeout: 20_000 },
    ),
    page.getByTestId("record-payment-button").click(),
  ]);
  say("final POST /payments ->", resp.status());
  await page.waitForTimeout(3000);
  const closed = await page
    .getByTestId("charge-closed-chip")
    .isVisible({ timeout: 4000 })
    .catch(() => false);
  say("order now shows CLOSED?", closed, "(must be true)");
  await shot(page, "pos-after-close");
  if (!closed) throw new Error("the order did not reach CLOSED — cannot test the double-count leg");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const takingsTab = await ctx.newPage();
  PAGES.push(takingsTab);
  takingsTab.on("console", (m) => {
    if (m.type() === "error") say("  [console:takings]", m.text().slice(0, 300));
  });
  await login(takingsTab);

  const before = await readTakings(takingsTab, "1-before");

  const posTab = await ctx.newPage();
  PAGES.push(posTab);
  posTab.on("console", (m) => {
    if (m.type() === "error") say("  [console:pos]", m.text().slice(0, 300));
  });
  const orderId = await ringAndChargeCash(posTab);

  const after = await readTakings(takingsTab, "2-after-open-order");

  let afterClose = null;
  if (CLOSE_TOO) {
    await serveAndClose(posTab, orderId);
    afterClose = await readTakings(takingsTab, "3-after-close");
  }

  const cashBefore = before.tenders.CASH ?? { count: "-", amount: "-" };
  const cashAfter = after.tenders.CASH ?? { count: "-", amount: "-" };
  say("");
  say("════════ VERDICT ════════");
  say(`CASH before : ${cashBefore.count} payments / ${cashBefore.amount}`);
  say(`CASH after  : ${cashAfter.count} payments / ${cashAfter.amount}`);
  if (afterClose) {
    const c = afterClose.tenders.CASH ?? { count: "-", amount: "-" };
    say(`CASH closed : ${c.count} payments / ${c.amount}`);
  }
  say(`unclosed panel before: ${JSON.stringify(before.unclosed)}`);
  say(`unclosed panel after : ${JSON.stringify(after.unclosed)}`);
  if (afterClose) say(`unclosed panel closed: ${JSON.stringify(afterClose.unclosed)}`);
  say(`order used: ${orderId}`);

  writeFileSync(`${OUT}/log.txt`, log.join("\n"));
  writeFileSync(
    `${OUT}/result.json`,
    JSON.stringify({ orderId, amountPaisa: AMOUNT_PAISA, before, after, afterClose }, null, 2),
  );
  await browser.close();
}

main().catch(async (e) => {
  say("FAILED:", e?.stack ?? String(e));
  for (const [i, p] of PAGES.entries()) {
    await p.screenshot({ path: `${OUT}/FAILED-page${i}.png`, fullPage: true }).catch(() => {});
  }
  writeFileSync(`${OUT}/log.txt`, log.join("\n"));
  process.exit(1);
});
