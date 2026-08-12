/*
 * Step 8 — the same shift, with the agent STOPPED.
 *
 * Nothing about the product changed between step 7 and this one except that the machine in the back
 * office is off. The bill screen must notice, say the bill has NOT reached paper, and name the
 * machine — instead of the sentence it used to print regardless: "the branch print agent will put
 * it on paper".
 *
 * NOTE ON TIMING: the connected window is 15 s. This script waits past it before reading the
 * notice, because a screen that flips the moment the process dies would be reading a socket rather
 * than a poll, and the product deliberately reads the poll.
 */
import { newBrowser, newPage, login, go, shot, PEOPLE } from "./lib.mjs";

const WHO = PEOPLE.cashier;

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, WHO);

  await go(page, "/app/pos", { waitMs: 8000, allowTrouble: true });
  await page.locator("[data-testid=order-type-takeaway]").click();
  await page.waitForTimeout(700);

  const search = page.getByLabel(/search menu/i);
  if (await search.count()) {
    await search.first().fill("Butter Naan");
    await page.waitForTimeout(2000);
  }
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30_000 });
  const names = await tiles.allTextContents();
  const idx = names.findIndex((n) => /Butter Naan/i.test(n));
  await tiles.nth(idx < 0 ? 0 : idx).click();
  await page.waitForTimeout(900);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(8000);
  const fired = await page.evaluate(() =>
    Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
  );
  const orderNo = fired[0];
  console.log("fired:", orderNo);

  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4000);
  await page.locator("[data-testid=order-management-search]").first().fill(orderNo);
  await page.waitForTimeout(4000);
  const orderId = await page.evaluate(
    () =>
      document.querySelector('[data-testid^="open-order-"]')?.getAttribute("data-testid")?.replace("open-order-", "") ?? null,
  );
  console.log("orderId:", orderId);

  await go(page, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
  const fill = page.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await page.waitForTimeout(700);
  }
  const tendered = page.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    await tendered.fill("500");
    await page.waitForTimeout(800);
  }
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(7000);
  await shot(page, "08a-paid-agent-down");

  // Past the connected window, then read the bill.
  await page.waitForTimeout(16_000);
  await go(page, `/app/pos/orders/${orderId}/receipt`, { waitMs: 7000, allowTrouble: true });

  const notice = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="delivery-notice"]');
    return n
      ? {
          state: n.getAttribute("data-delivery-state"),
          printer: n.getAttribute("data-target-printer"),
          role: n.getAttribute("role"),
          text: n.innerText.replace(/\s+/g, " ").trim(),
        }
      : null;
  });
  console.log("NOTICE:", JSON.stringify(notice, null, 1));

  const button = await page.locator('[data-testid="print-again-button"]').textContent();
  console.log("print button label:", button?.trim());

  const stillPromises = await page.evaluate(() =>
    /will put it on paper|Sent to the receipt printer/i.test(document.body.innerText),
  );
  console.log("page still promises paper:", stillPromises);

  await shot(page, "08b-receipt-agent-stopped");
  console.log("orderNo:", orderNo, "orderId:", orderId);
} finally {
  await browser.close();
}
