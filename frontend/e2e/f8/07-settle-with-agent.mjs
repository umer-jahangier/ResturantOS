/*
 * Step 7 — the whole chain, with the agent RUNNING.
 *
 * A cashier rings a Butter Naan (now routed to GRILL), fires it, takes the cash, closes the check
 * and opens the bill. What must be true afterwards:
 *   · the kitchen ticket left the queue and arrived at the GRILL printer, not the DEFAULT one;
 *   · the bill screen reports what actually happened to the paper, not what it hopes will.
 */
import { newBrowser, newPage, login, go, shot, PEOPLE, apiGet } from "./lib.mjs";

const WHO = PEOPLE.cashier;

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, WHO);

  // ── till ────────────────────────────────────────────────────────────────────────────────────
  await go(page, "/app/pos", { waitMs: 8000, allowTrouble: true });
  const tillText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  const needsTill = /No active till|Open till|open a till/i.test(tillText);
  console.log("till strip mentions opening a till:", needsTill);
  if (needsTill) {
    const openBtn = page.getByRole("button", { name: /open till/i });
    if (await openBtn.count()) {
      await openBtn.first().click();
      await page.waitForTimeout(1500);
      const float = page.locator('input[type="text"], input[type="number"]').last();
      if (await float.count()) await float.fill("5000");
      await page.waitForTimeout(400);
      const confirm = page.getByRole("button", { name: /open till|confirm|start/i }).last();
      await confirm.click();
      await page.waitForTimeout(4000);
    }
    await shot(page, "07a-till");
  }

  // ── ring the naan ───────────────────────────────────────────────────────────────────────────
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
  console.log("tiles:", JSON.stringify(names.slice(0, 6)));
  const idx = names.findIndex((n) => /Butter Naan/i.test(n));
  if (idx < 0) throw new Error(`Butter Naan not on the grid; saw ${JSON.stringify(names.slice(0, 10))}`);
  await tiles.nth(idx).click();
  await page.waitForTimeout(900);
  await shot(page, "07b-cart");

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(8000);
  const fired = await page.evaluate(() => ({
    nos: Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim().slice(0, 200)),
  }));
  console.log("fired:", JSON.stringify(fired));
  await shot(page, "07c-fired");
  const orderNo = fired.nos[0];
  if (!orderNo) throw new Error("no order number after firing");

  // ── find it, charge it ──────────────────────────────────────────────────────────────────────
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
  if (!orderId) throw new Error("could not resolve the order id");

  await go(page, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
  const fill = page.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await page.waitForTimeout(700);
  }
  const tendered = page.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    await tendered.fill("2000");
    await page.waitForTimeout(800);
  }
  await shot(page, "07d-charge");
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(7000);
  await shot(page, "07e-paid");
  console.log(
    "after payment:",
    (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 400),
  );

  // ── the bill ────────────────────────────────────────────────────────────────────────────────
  await go(page, `/app/pos/orders/${orderId}/receipt`, { waitMs: 6000, allowTrouble: true });
  for (let i = 0; i < 12; i += 1) {
    const state = await page.evaluate(
      () => document.querySelector('[data-testid="delivery-notice"]')?.getAttribute("data-delivery-state") ?? null,
    );
    console.log(`  t+${i * 2}s delivery-state=${state}`);
    if (state === "ON_PAPER") break;
    await page.waitForTimeout(2000);
  }
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
  await shot(page, "07f-receipt-agent-running");

  console.log("orderNo:", orderNo, "orderId:", orderId);
} finally {
  await browser.close();
}
