/*
 * S1-05 BEFORE probe — "Cash is typed in paisa, with no tendered amount and no change due".
 *
 * Drives the exact path the register describes, as the cashier who would walk it:
 *   sign in -> open the drawer -> ring 2x Chicken Karahi + 1x Butter Naan (Rs 3,456.80)
 *   -> Charge Now -> read the tender row.
 *
 * It asserts nothing about the source. It reads the DOM: what the amount field's accessible name
 * actually is, what its placeholder actually says, and what "Full amount" actually puts in it.
 *
 *   node e2e/repair/s1-05-repro.mjs
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
  EXPECTED_TOTAL_PAISA,
} from "./s1-05-lib.mjs";

async function main() {
  shotDir();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await ctx.newPage();

  await login(page);
  console.log("  signed in as cashier@terrace.local ->", page.url());

  await ensureTillOpen(page);
  await ringBill(page);
  await shot(page, "before-01-cart");

  const orderId = await chargeNow(page);
  console.log("  order:", orderId);
  await shot(page, "before-02-charge-page", { fullPage: true });

  const probe = await probeTenderRow(page);
  console.log("\n  --- tender row, as rendered ---");
  for (const i of probe.inputs) {
    console.log(
      `    <${i.tag} type=${i.type}> aria-label=${JSON.stringify(i.ariaLabel)} placeholder=${JSON.stringify(i.placeholder)} inputmode=${JSON.stringify(i.inputMode)} value=${JSON.stringify(i.value)}`,
    );
  }
  console.log("    remaining balance:", probe.remainingText, `(data-paisa=${probe.remainingPaisa})`);
  console.log("    mentions 'paisa' anywhere:", probe.mentionsPaisa);
  console.log("    has a Tendered field:", probe.hasTenderedField);
  console.log("    has 'Change due':", probe.hasChangeDue);
  console.log("    denomination quick-keys:", probe.denominationKeys.length);
  console.log("    alerts:", JSON.stringify(probe.alerts));

  if (Number(probe.remainingPaisa) !== EXPECTED_TOTAL_PAISA) {
    console.log(
      `\n  !! the bill is ${probe.remainingPaisa} paisa, not the ${EXPECTED_TOTAL_PAISA} the register names — the reading below is still valid, but the figures will differ`,
    );
  }

  // What does "Full amount" actually put in the box?
  const fullBtn = page.getByTestId("fill-full-amount-button");
  if (await fullBtn.isVisible().catch(() => false)) {
    await fullBtn.click();
    await page.waitForTimeout(500);
    const after = await probeTenderRow(page);
    const amountField = after.inputs.find((i) => /amount/i.test(i.ariaLabel || ""));
    console.log(
      `\n  Full amount -> the amount box now literally reads ${JSON.stringify(amountField?.value)}`,
    );
    await shot(page, "before-03-full-amount-prefilled");
  } else {
    console.log("\n  (no Full amount button on screen)");
  }

  // Can a cashier type rupees? Type what the guest's bill says and see what the box holds.
  const amountInput = page
    .locator('section input[aria-label="Amount in paisa"], section input[aria-label="Amount"]')
    .first();
  if (await amountInput.count()) {
    await amountInput.fill("");
    await amountInput.type("3456.80", { delay: 60 });
    await page.waitForTimeout(400);
    const typed = await amountInput.inputValue();
    const tenderTotal = await page
      .locator("text=Tender total")
      .locator("xpath=..")
      .innerText()
      .catch(() => "(not found)");
    console.log(`  typed "3456.80" -> field holds ${JSON.stringify(typed)}; ${tenderTotal.replace(/\n/g, " ")}`);
    await shot(page, "before-04-typed-rupees");
  }

  await browser.close();
  console.log("\n  evidence ->", shotDir());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
