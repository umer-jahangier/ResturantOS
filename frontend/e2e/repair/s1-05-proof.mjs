/*
 * S1-05 AFTER proof — cash in rupees, with a tendered amount and a change due.
 *
 * Same instrument as s1-05-repro.mjs (both import s1-05-lib.mjs), same persona, same bill.
 * It walks the DONE MEANS click path exactly:
 *
 *   A. cashier signs in, drawer open, rings Rs 3,456.80, Charge
 *      -> the amount field is labelled in RUPEES and nothing on the page says "paisa"
 *      -> typing 3456.80 is accepted verbatim
 *      -> Tendered 4000 shows "Change due Rs 543.20" BEFORE the payment is taken
 *      -> record; receipt shows the same three figures; the API row carries
 *         tenderedPaisa=400000 / changePaisa=54320
 *   B. a second identical bill settled as a split CASH + CARD tender
 *      -> remaining balance lands on Rs 0.00 and both rows persist correctly
 *
 * The API reads are made with an independently-minted cashier token, not with anything the page
 * handed us, so "the screen says so" and "the server says so" are two separate measurements.
 *
 *   node e2e/repair/s1-05-proof.mjs
 */
import { chromium } from "@playwright/test";
import {
  login,
  ensureTillOpen,
  ringBill,
  chargeNow,
  probeTenderRow,
  shot,
  shotDir,
  apiToken,
  fetchPayments,
  EXPECTED_TOTAL_PAISA,
  BASE,
} from "./s1-05-lib.mjs";

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const amountBox = (page) => page.getByLabel("Amount (Rs)").first();
const tenderedBox = (page) => page.getByLabel("Tendered (Rs)").first();

async function paisaOf(page, testid) {
  const el = page.getByTestId(testid).first();
  if (!(await el.count())) return null;
  return Number(await el.getAttribute("data-paisa"));
}

async function settleOrderA(page, token) {
  console.log("\n[A] single CASH tender, over-tendered");
  await ringBill(page);
  const orderId = await chargeNow(page);
  console.log("    order:", orderId);

  const probe = await probeTenderRow(page);
  const amountInput = probe.inputs.find((i) => /amount/i.test(i.ariaLabel || ""));
  check(
    "the amount field is labelled in rupees",
    amountInput?.ariaLabel === "Amount (Rs)",
    `aria-label=${JSON.stringify(amountInput?.ariaLabel)} placeholder=${JSON.stringify(amountInput?.placeholder)}`,
  );
  check("no field anywhere asks for paisa", !probe.mentionsPaisa);
  check(
    "the bill is the one the register names",
    Number(probe.remainingPaisa) === EXPECTED_TOTAL_PAISA,
    `${probe.remainingText} (${probe.remainingPaisa} paisa)`,
  );
  check("denomination quick-keys are offered", probe.denominationKeys.length >= 5,
    probe.denominationKeys.join(" "));
  await shot(page, "after-01-charge-page", { fullPage: true });

  // "Full amount" — the control the register singled out for prefilling 9280 on a Rs 92.80 bill.
  await page.getByTestId("fill-full-amount-button").click();
  await page.waitForTimeout(400);
  const prefilled = await amountBox(page).inputValue();
  check("'Full amount' prefills a rupee figure", prefilled === "3456.80", `box reads ${JSON.stringify(prefilled)}`);

  // Retype it by hand — the exact keystrokes that produced 34560 before the fix.
  await amountBox(page).fill("");
  await amountBox(page).type("3456.80", { delay: 70 });
  await page.waitForTimeout(400);
  const typed = await amountBox(page).inputValue();
  check("typing 3456.80 is accepted verbatim", typed === "3456.80", `box reads ${JSON.stringify(typed)}`);
  check(
    "the tender total reads the bill, not a tenth of it",
    (await paisaOf(page, "tender-total-value")) === 345680,
    `tender total = ${await paisaOf(page, "tender-total-value")} paisa`,
  );

  await tenderedBox(page).fill("4000");
  await page.waitForTimeout(400);
  const changePaisa = await paisaOf(page, "change-due-value");
  const changeText = (await page.getByTestId("change-due-value").first().innerText()).trim();
  check(
    "Change due Rs 543.20 appears BEFORE the payment is taken",
    changePaisa === 54320 && /543\.20/.test(changeText),
    `${changeText} (${changePaisa} paisa)`,
  );
  await shot(page, "after-02-tendered-and-change-due", { fullPage: true });

  await page.getByTestId("record-payment-button").click();
  await page.waitForTimeout(4000);
  const settled = await probeTenderRow(page);
  check(
    "remaining balance lands on Rs 0.00",
    Number(settled.remainingPaisa) === 0,
    settled.remainingText,
  );
  await shot(page, "after-03-settled", { fullPage: true });

  const api = await fetchPayments(token, orderId);
  const rows = (api.body?.data ?? []).filter((r) => r.kind !== "REFUND");
  const cash = rows.find((r) => r.method === "CASH");
  check(
    "the persisted payment row carries tenderedPaisa=400000 and changePaisa=54320",
    cash?.tenderedPaisa === 400000 && cash?.changePaisa === 54320 && cash?.amountPaisa === 345680,
    JSON.stringify(cash),
  );

  // The receipt: the same three figures, rendered by the JVM's own money formatter.
  await page.goto(`${BASE}/app/pos/orders/${orderId}/receipt`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const receipt = await page.locator("body").innerText();
  check(
    "the receipt prints TOTAL Rs 3,456.80",
    /Rs 3,456\.80/.test(receipt),
    receipt.match(/TOTAL[^\n]*\n?[^\n]*/)?.[0]?.replace(/\n/g, " ") ?? "",
  );
  check("the receipt prints Tendered Rs 4,000.00", /Tendered[\s\S]{0,40}Rs 4,000\.00/.test(receipt));
  check("the receipt prints Change Rs 543.20", /Change[\s\S]{0,40}Rs 543\.20/.test(receipt));
  await shot(page, "after-04-receipt", { fullPage: true });

  return orderId;
}

async function settleOrderB(page, token) {
  console.log("\n[B] split CASH + CARD tender");
  await ringBill(page);
  const orderId = await chargeNow(page);
  console.log("    order:", orderId);

  // Row 1: Rs 2,000.00 cash, Rs 2,500.00 handed over -> Rs 500.00 change.
  await amountBox(page).fill("2000.00");
  await tenderedBox(page).fill("2500");
  await page.waitForTimeout(300);
  check(
    "the cash row shows Rs 500.00 change",
    (await paisaOf(page, "change-due-value")) === 50000,
  );

  await page.getByTestId("add-tender-button").click();
  await page.waitForTimeout(400);
  const methods = page.getByLabel("Payment method");
  await methods.nth(1).selectOption("CARD");
  await page.waitForTimeout(300);
  await page.getByLabel("Amount (Rs)").nth(1).fill("1456.80");
  await page.waitForTimeout(400);

  check(
    "the two rows add up to the bill",
    (await paisaOf(page, "tender-total-value")) === EXPECTED_TOTAL_PAISA,
    `tender total = ${await paisaOf(page, "tender-total-value")} paisa`,
  );
  check(
    "balance after this tender reads Rs 0.00",
    (await paisaOf(page, "balance-after-tender-value")) === 0,
  );
  await shot(page, "after-05-split-tender", { fullPage: true });

  await page.getByTestId("record-payment-button").click();
  await page.waitForTimeout(5000);
  const settled = await probeTenderRow(page);
  check(
    "split tender lands the remaining balance on Rs 0.00",
    Number(settled.remainingPaisa) === 0,
    settled.remainingText,
  );
  await shot(page, "after-06-split-settled", { fullPage: true });

  const api = await fetchPayments(token, orderId);
  const rows = (api.body?.data ?? []).filter((r) => r.kind !== "REFUND");
  const cash = rows.find((r) => r.method === "CASH");
  const card = rows.find((r) => r.method === "CARD");
  check(
    "the CASH row persisted 200000 applied / 250000 tendered / 50000 change",
    cash?.amountPaisa === 200000 && cash?.tenderedPaisa === 250000 && cash?.changePaisa === 50000,
    JSON.stringify(cash),
  );
  check(
    "the CARD row persisted exact tender with no change",
    card?.amountPaisa === 145680 && card?.tenderedPaisa === 145680 && card?.changePaisa === 0,
    JSON.stringify(card),
  );
  check(
    "applied amounts sum to the bill to the paisa",
    rows.reduce((a, r) => a + r.amountPaisa, 0) === EXPECTED_TOTAL_PAISA,
  );

  return orderId;
}

async function main() {
  shotDir();
  const token = await apiToken();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  await login(page);
  console.log("  signed in as cashier@terrace.local ->", page.url());
  await ensureTillOpen(page);

  const a = await settleOrderA(page, token);
  const b = await settleOrderB(page, token);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  orders: A=${a}  B=${b}`);
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
  console.log("  evidence ->", shotDir());
  if (failed.length) {
    console.log("\n  FAILED:");
    for (const f of failed) console.log("   -", f.label, f.detail ?? "");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
