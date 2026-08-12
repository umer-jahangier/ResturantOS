/*
 * Step 9 — the bill that was held while the machine was off must print when it comes back, and the
 * SAME screen must change its own answer. "The bill is held, not lost" is a promise the screen made
 * in step 8; this is the screen keeping it.
 */
import { newBrowser, newPage, login, go, shot, PEOPLE } from "./lib.mjs";

const ORDER_ID = process.argv[2];
if (!ORDER_ID) throw new Error("usage: node 09-held-bill-prints.mjs <orderId>");

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.cashier);
  await go(page, `/app/pos/orders/${ORDER_ID}/receipt`, { waitMs: 6000, allowTrouble: true });

  for (let i = 0; i < 15; i += 1) {
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
          role: n.getAttribute("role"),
          text: n.innerText.replace(/\s+/g, " ").trim(),
        }
      : null;
  });
  console.log("NOTICE:", JSON.stringify(notice, null, 1));
  await shot(page, "09-held-bill-printed-after-restart");
} finally {
  await browser.close();
}
