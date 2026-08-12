/*
 * S8 step 3 — the cashier's half.
 *
 * A grilled dish is rung and fired: its ticket must arrive at the GRILL printer the owner bound by
 * host and port. The check is settled: the bill must go to the USB printer chosen from the agent's
 * list, and NO browser print dialog may appear at any point — asserted by a `window.print` spy
 * installed before the first navigation, not by looking at a screenshot.
 */
import { newBrowser, newPage, login, go, shot, apiGet, branchOf, printCount, PEOPLE, OUT } from "./lib.mjs";
import { statSync, writeFileSync, readFileSync } from "node:fs";

const GRILL_CAPTURE = process.env.S8_GRILL_CAPTURE;
if (!GRILL_CAPTURE) throw new Error("set S8_GRILL_CAPTURE to the fake GRILL printer's capture file");

function captureSize() {
  try {
    return statSync(GRILL_CAPTURE).size;
  } catch {
    return 0;
  }
}

const evidence = { grillBytesBefore: captureSize() };
const browser = await newBrowser();
const page = await newPage(browser);

try {
  await login(page, PEOPLE.cashier);
  const branchId = await branchOf(page);

  // ── till ──────────────────────────────────────────────────────────────────────────────────
  await go(page, "/app/pos", { waitMs: 9000, allowTrouble: true });
  const tillText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  if (/No active till|Open till|open a till/i.test(tillText)) {
    const openBtn = page.getByRole("button", { name: /open till/i });
    if (await openBtn.count()) {
      await openBtn.first().click();
      await page.waitForTimeout(1500);
      const float = page.locator('input[type="text"], input[type="number"]').last();
      if (await float.count()) await float.fill("5000");
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /open till|confirm|start/i }).last().click();
      await page.waitForTimeout(4500);
    }
  }

  // ── ring the grilled dish ─────────────────────────────────────────────────────────────────
  await go(page, "/app/pos", { waitMs: 9000, allowTrouble: true });
  await page.locator("[data-testid=order-type-takeaway]").click();
  await page.waitForTimeout(700);

  const search = page.getByLabel(/search menu/i);
  if (await search.count()) {
    await search.first().fill("Butter Naan");
    await page.waitForTimeout(2200);
  }
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30_000 });
  const names = await tiles.allTextContents();
  const idx = names.findIndex((n) => /Butter Naan/i.test(n));
  if (idx < 0) throw new Error(`Butter Naan not on the grid; saw ${JSON.stringify(names.slice(0, 10))}`);
  await tiles.nth(idx).click();
  await page.waitForTimeout(900);
  await shot(page, "03a-cart");

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(9000);
  const fired = await page.evaluate(() => ({
    nos: Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
  }));
  const orderNo = fired.nos[0];
  if (!orderNo) throw new Error("no order number after firing");
  evidence.orderNo = orderNo;
  console.log("  fired:", orderNo);
  await shot(page, "03b-fired");

  // Give the agent a poll or two to claim and deliver the kitchen ticket.
  for (let i = 0; i < 10; i += 1) {
    if (captureSize() > evidence.grillBytesBefore) break;
    await page.waitForTimeout(1500);
  }
  evidence.grillBytesAfterFire = captureSize();
  console.log(`  GRILL capture: ${evidence.grillBytesBefore} → ${evidence.grillBytesAfterFire} bytes`);

  // ── charge it ─────────────────────────────────────────────────────────────────────────────
  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4500);
  await page.locator("[data-testid=order-management-search]").first().fill(orderNo);
  await page.waitForTimeout(4500);
  const orderId = await page.evaluate(
    () =>
      document.querySelector('[data-testid^="open-order-"]')?.getAttribute("data-testid")?.replace("open-order-", "") ??
      null,
  );
  if (!orderId) throw new Error("could not resolve the order id");
  evidence.orderId = orderId;

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
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  await shot(page, "03c-paid");

  // ── the bill ──────────────────────────────────────────────────────────────────────────────
  await go(page, `/app/pos/orders/${orderId}/receipt`, { waitMs: 6000, allowTrouble: true });
  for (let i = 0; i < 15; i += 1) {
    const state = await page.evaluate(
      () => document.querySelector('[data-testid="delivery-notice"]')?.getAttribute("data-delivery-state") ?? null,
    );
    if (i % 3 === 0) console.log(`  t+${i * 2}s delivery-state=${state}`);
    if (state === "ON_PAPER" || state === "NO_AGENT" || state === "REFUSED") break;
    await page.waitForTimeout(2000);
  }
  evidence.receipt = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="delivery-notice"]');
    return n
      ? {
          state: n.getAttribute("data-delivery-state"),
          printer: n.getAttribute("data-target-printer"),
          text: n.innerText.replace(/\s+/g, " ").trim().slice(0, 300),
        }
      : { state: null, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 300) };
  });
  console.log("  receipt notice:", JSON.stringify(evidence.receipt));
  await shot(page, "03d-receipt");

  // ── the claim that matters: no browser dialog, anywhere in this journey ────────────────────
  evidence.windowPrint = await printCount(page);
  console.log("  window.print calls:", JSON.stringify(evidence.windowPrint));

  // ── what the SERVER says happened to the paper ─────────────────────────────────────────────
  const health = await apiGet(page, `/api/v1/pos/printers/health?branchId=${branchId}`);
  evidence.healthStatus = health.status;
  evidence.health = health.body?.data ?? health.body;
  console.log("  printer health:", JSON.stringify(evidence.health));
} finally {
  writeFileSync(`${OUT}/03-cashier-settles.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}

// What actually landed on the GRILL printer's socket, with the ESC/POS control bytes stripped.
if (evidence.grillBytesAfterFire > evidence.grillBytesBefore) {
  const bytes = readFileSync(GRILL_CAPTURE);
  const text = bytes
    .subarray(evidence.grillBytesBefore)
    .toString("latin1")
    .replace(/\x1b.|\x1d./g, "");
  console.log("\n──── bytes at the GRILL printer ────\n" + text.slice(0, 600));
}
