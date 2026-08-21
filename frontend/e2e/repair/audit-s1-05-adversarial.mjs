// INDEPENDENT ADVERSARIAL AUDIT of the S1-05 claim ("cash is typed in paisa").
//
// Reuses only the mechanical "be a cashier" navigation from s1-05-lib.mjs (sign in, open the
// till, tap tiles, press Charge Now). Every READ and every ASSERTION below is written fresh —
// the point is to measure the screen with an instrument the fixer did not build.
//
// Run: node e2e/repair/audit-s1-05-adversarial.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  BASE,
  API,
  CASHIER,
  login,
  ensureTillOpen,
  ringBill,
  chargeNow,
  apiToken,
  branchOf,
} from "./s1-05-lib.mjs";

const OUT =
  "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad/s1-05-audit";
mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
async function snap(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
}

/** Read the tender panel with my own selectors. */
async function readPanel(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const paisaOf = (s) => {
      const n = q(s);
      return n ? n.getAttribute("data-paisa") : null;
    };
    const amountInput = q('input[aria-label="Amount (Rs)"]');
    const tenderedInput = q('input[aria-label="Tendered (Rs)"]');
    const recordBtn = q('[data-testid="record-payment-button"]');
    return {
      bodyMentionsPaisa: /paisa/i.test(document.body.innerText),
      amountAria: amountInput ? amountInput.getAttribute("aria-label") : null,
      amountType: amountInput ? amountInput.getAttribute("type") : null,
      amountInputMode: amountInput ? amountInput.getAttribute("inputmode") : null,
      amountValue: amountInput ? amountInput.value : null,
      tenderedValue: tenderedInput ? tenderedInput.value : null,
      hasTendered: !!tenderedInput,
      tenderTotalPaisa: paisaOf('[data-testid="tender-total-value"]'),
      changeDuePaisa: paisaOf('[data-testid="change-due-value"]'),
      remainingPaisa: paisaOf('[data-testid="remaining-balance-value"]'),
      balanceAfterPaisa: paisaOf('[data-testid="balance-after-tender-value"]'),
      amountInvalid: !!q('[data-testid="amount-invalid-message"]'),
      tenderedInvalid: !!q('[data-testid="tendered-invalid-message"]'),
      shortMessage: !!q('[data-testid="tender-short-message"]'),
      recordDisabled: recordBtn ? recordBtn.disabled : null,
      historyRows: document.querySelectorAll('[data-testid="payment-history-row"]').length,
      alerts: Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent.trim())
        .filter(Boolean),
    };
  });
}

async function typeAmount(page, text) {
  const f = page.locator('input[aria-label="Amount (Rs)"]');
  await f.fill("");
  await f.click();
  // keystroke by keystroke — this is exactly how the old type="number" box lost a digit
  await f.pressSequentially(text, { delay: 45 });
  await page.waitForTimeout(350);
}
async function typeTendered(page, text) {
  const f = page.locator('input[aria-label="Tendered (Rs)"]');
  await f.fill("");
  await f.click();
  await f.pressSequentially(text, { delay: 45 });
  await page.waitForTimeout(350);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();

  const token = await apiToken();
  const branchId = branchOf(token);

  console.log("\n=== sign in as the cashier ===");
  await login(page, CASHIER);
  await ensureTillOpen(page);

  // Drawer state BEFORE — the money check nobody ran: giving change must not inflate the till.
  const tillList = await fetch(`${API}/api/v1/pos/tills?status=OPEN`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .catch(() => null);
  const tillId = (tillList?.data ?? []).find((t) => t.status === "OPEN")?.id ?? null;

  let recon0 = null;
  if (tillId) {
    recon0 = await fetch(`${API}/api/v1/pos/tills/${tillId}/reconciliation`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .catch(() => null);
  }
  console.log(
    `  drawer before: liveExpectedCash=${recon0?.data?.liveExpectedCashPaisa ?? "?"} tillId=${tillId}`,
  );

  console.log("\n=== ring the Rs 3,456.80 bill and press Charge Now ===");
  await ringBill(page);
  const orderId = await chargeNow(page);
  console.log(`  order ${orderId}`);

  let p = await readPanel(page);
  await snap(page, "01-charge-page");
  check("bill really is Rs 3,456.80", p.remainingPaisa === "345680", `remaining=${p.remainingPaisa}`);
  check('amount field is labelled in rupees', p.amountAria === "Amount (Rs)", `aria="${p.amountAria}"`);
  check('the word "paisa" appears nowhere on the page', p.bodyMentionsPaisa === false);
  check('field is type="text" not type="number"', p.amountType === "text", `type=${p.amountType}`);
  check('inputmode="decimal" for the till keypad', p.amountInputMode === "decimal");
  check("a Tendered field exists", p.hasTendered === true);
  check("no error state masquerading as content", p.alerts.length === 0, JSON.stringify(p.alerts));

  // ── PHASE 1: how the box reads what a human types ─────────────────────────
  console.log("\n=== PHASE 1: parser probes, typed keystroke by keystroke ===");
  const probes = [
    ["3456.80", "345680", "the bill exactly as printed"],
    ["3,456.80", "345680", "with the grouping comma the app's own display shows"],
    ["3456.8", "345680", "one decimal place"],
    [".80", "80", "leading point"],
    ["3456", "345600", "whole rupees"],
    ["3456.789", "345679", "HALF_UP at the third decimal"],
    ["3456.784", "345678", "HALF_DOWN side of the same"],
    ["0.29", "29", "the classic float-rounding vector"],
  ];
  for (const [typed, expected, why] of probes) {
    await typeAmount(page, typed);
    const r = await readPanel(page);
    check(
      `typed "${typed}" -> ${expected} paisa (${why})`,
      r.tenderTotalPaisa === expected && r.amountValue === typed,
      `field holds "${r.amountValue}", tender total ${r.tenderTotalPaisa}`,
    );
  }

  console.log("\n=== PHASE 1b: garbage must BLOCK, never quietly become zero ===");
  for (const bad of ["abc", "-100", "1e5", "3.4.5", "."]) {
    await typeAmount(page, bad);
    const r = await readPanel(page);
    check(
      `"${bad}" is refused and Record is disabled`,
      r.amountInvalid === true && r.recordDisabled === true,
      `invalid=${r.amountInvalid} disabled=${r.recordDisabled} total=${r.tenderTotalPaisa}`,
    );
  }

  // ── PHASE 2: partial payment WITH change — the adjacent path ──────────────
  console.log("\n=== PHASE 2: a PARTIAL cash payment that needs change ===");
  await typeAmount(page, "1000.00");
  await typeTendered(page, "2000");
  p = await readPanel(page);
  await snap(page, "02-partial-with-change");
  check(
    "change due on a PARTIAL tender is Rs 1,000.00",
    p.changeDuePaisa === "100000",
    `change=${p.changeDuePaisa}`,
  );
  check(
    "balance after this tender is Rs 2,456.80",
    p.balanceAfterPaisa === "245680",
    `balanceAfter=${p.balanceAfterPaisa}`,
  );
  check("Record is enabled for the partial tender", p.recordDisabled === false);

  console.log("\n  -- short tender guard --");
  await typeTendered(page, "500");
  p = await readPanel(page);
  check(
    "tendered BELOW the amount is refused, not clamped",
    p.shortMessage === true && p.recordDisabled === true,
    `short=${p.shortMessage} disabled=${p.recordDisabled}`,
  );

  console.log("\n  -- over-amount guard --");
  await typeAmount(page, "9999.00");
  p = await readPanel(page);
  check(
    "an amount above the remaining balance is refused",
    p.recordDisabled === true,
    `disabled=${p.recordDisabled} total=${p.tenderTotalPaisa} remaining=${p.remainingPaisa}`,
  );

  console.log("\n  -- record the partial tender --");
  await typeAmount(page, "1000.00");
  await typeTendered(page, "2000");
  await page.getByTestId("record-payment-button").click();
  await page.waitForTimeout(4000);
  p = await readPanel(page);
  await snap(page, "03-after-partial");
  check(
    "remaining balance drops to Rs 2,456.80 (applied, NOT tendered)",
    p.remainingPaisa === "245680",
    `remaining=${p.remainingPaisa}`,
  );

  console.log("\n  -- RELOAD: does it persist? --");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  p = await readPanel(page);
  await snap(page, "04-after-reload");
  check(
    "after F5 the remaining balance is still Rs 2,456.80",
    p.remainingPaisa === "245680",
    `remaining=${p.remainingPaisa}`,
  );
  check("after F5 the payment history shows the tender", p.historyRows === 1, `rows=${p.historyRows}`);
  check("after F5 the tender box is empty, not stale", p.amountValue === "", `value="${p.amountValue}"`);

  // ── PHASE 3: settle the rest ──────────────────────────────────────────────
  console.log("\n=== PHASE 3: settle the remainder with change ===");
  await page.getByTestId("fill-full-amount-button").click();
  await page.waitForTimeout(500);
  p = await readPanel(page);
  check(
    '"Full amount" prefills RUPEES (2456.80), not the raw integer',
    p.amountValue === "2456.80",
    `value="${p.amountValue}"`,
  );

  console.log("  -- denomination quick-keys, tapped like a stack of notes --");
  await page.getByTestId("denom-100000").click(); // +1,000
  await page.waitForTimeout(200);
  await page.getByTestId("denom-100000").click(); // +1,000
  await page.waitForTimeout(200);
  await page.getByTestId("denom-50000").click(); // +500
  await page.waitForTimeout(400);
  p = await readPanel(page);
  check(
    "quick-keys ADD: 1000+1000+500 = Rs 2,500.00 tendered",
    p.tenderedValue === "2500.00",
    `tendered="${p.tenderedValue}"`,
  );
  check(
    "change due Rs 43.20 rendered BEFORE the payment is taken",
    p.changeDuePaisa === "4320",
    `change=${p.changeDuePaisa}`,
  );
  await snap(page, "05-quick-keys");

  await typeTendered(page, "3000");
  p = await readPanel(page);
  check("change due Rs 543.20 on a Rs 3,000 tender", p.changeDuePaisa === "54320", `change=${p.changeDuePaisa}`);
  await page.getByTestId("record-payment-button").click();
  await page.waitForTimeout(5000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  p = await readPanel(page);
  await snap(page, "06-settled");
  check(
    "after settling and reloading, remaining balance is Rs 0.00",
    p.remainingPaisa === "0",
    `remaining=${p.remainingPaisa}`,
  );

  // ── PHASE 4: the persisted truth, read with an independent token ──────────
  console.log("\n=== PHASE 4: read the persisted rows over HTTP ===");
  const payRes = await fetch(`${API}/api/v1/pos/orders/${orderId}/payments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payments = (await payRes.json())?.data ?? [];
  console.log(
    "  " +
      JSON.stringify(
        payments.map((x) => ({
          m: x.method,
          amt: x.amountPaisa,
          tend: x.tenderedPaisa,
          chg: x.changePaisa,
        })),
      ),
  );
  const sumApplied = payments.reduce((a, x) => a + x.amountPaisa, 0);
  check("applied amounts sum to the bill exactly", sumApplied === 345680, `sum=${sumApplied}`);
  const r1 = payments.find((x) => x.amountPaisa === 100000);
  const r2 = payments.find((x) => x.amountPaisa === 245680);
  check(
    "partial row persisted tendered=200000 change=100000",
    !!r1 && r1.tenderedPaisa === 200000 && r1.changePaisa === 100000,
    JSON.stringify(r1),
  );
  check(
    "final row persisted tendered=300000 change=54320",
    !!r2 && r2.tenderedPaisa === 300000 && r2.changePaisa === 54320,
    JSON.stringify(r2),
  );

  // ── PHASE 5: the drawer must NOT be inflated by the change handed back ────
  console.log("\n=== PHASE 5: the cash drawer ===");
  if (tillId) {
    const recon1 = await fetch(`${API}/api/v1/pos/tills/${tillId}/reconciliation`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .catch(() => null);
    const before = recon0?.data?.liveExpectedCashPaisa;
    const after = recon1?.data?.liveExpectedCashPaisa;
    const delta = after - before;
    check(
      "drawer grew by the bill (345680), NOT by the Rs 5,000 handed across the counter",
      delta === 345680,
      `before=${before} after=${after} delta=${delta}`,
    );
  } else {
    console.log("  (no till id — skipped)");
  }

  // ── PHASE 6: the receipt ──────────────────────────────────────────────────
  console.log("\n=== PHASE 6: the printed receipt ===");
  await page.goto(`${BASE}/app/pos/orders/${orderId}/receipt`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const receipt = (await page.locator("body").innerText()).replace(/ /g, " ");
  await snap(page, "07-receipt");
  check("receipt shows TOTAL Rs 3,456.80", /3,456\.80/.test(receipt), "");
  check("receipt shows the Rs 3,000.00 tender", /3,000\.00/.test(receipt), "");
  check("receipt shows Rs 543.20 change", /543\.20/.test(receipt), "");
  check("receipt shows the Rs 1,000.00 change on the partial too", /1,000\.00/.test(receipt), "");

  await browser.close();

  console.log(`\n================ ${pass} passed, ${fail} failed ================`);
  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log(`orderId=${orderId}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
