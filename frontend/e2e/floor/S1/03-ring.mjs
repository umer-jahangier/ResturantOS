/*
 * S1 step 3 — the cashier rings ONE check holding a drink, a grilled dish and a curry, and fires it.
 *
 * Pinacolada   -> Drinks   -> category rule -> BAR
 * Seekh Kebab  -> Starters -> per-item rule -> GRILL
 * Chicken Karahi -> Mains  -> no rule       -> DEFAULT
 *
 * Then reads the kitchen's own view of what it was told, over the cashier's bearer, so a screen
 * that renders nothing can be told apart from a kitchen that received nothing.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, log,
} from "./lib.mjs";

const WANT = ["Pinacolada", "Seekh Kebab", "Chicken Karahi"];

const browser = await newBrowser();
const page = await newPage(browser);

async function tileNames() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]')).map(
      (b) => b.innerText.replace(/\s+/g, " ").trim(),
    ),
  );
}

async function ring(name) {
  // Search first — 40 items paginate, and a tile that is not on this page cannot be clicked.
  const search = page.locator(
    'input[placeholder*="Search" i], input[aria-label*="Search" i]',
  );
  if (await search.count()) {
    await search.first().fill(name);
    await page.waitForTimeout(1500);
  }
  const tile = page
    .locator('[data-testid="menu-grid"] button[aria-pressed]')
    .filter({ hasText: name })
    .first();
  await tile.waitFor({ timeout: 15000 });
  await tile.click();
  await page.waitForTimeout(700);
  if (await search.count()) {
    await search.first().fill("");
    await page.waitForTimeout(1200);
  }
}

try {
  await login(page, PEOPLE.cashier);
  const t = await go(page, "/app/pos", { waitMs: 8000 });
  log("  /app/pos:", JSON.stringify(t));

  await page.locator("[data-testid=order-type-dine_in]").click().catch(() => {});
  await page.waitForTimeout(600);

  log("  tiles on page 1:", JSON.stringify((await tileNames()).slice(0, 12)));

  for (const n of WANT) {
    await ring(n);
    log(`  rang ${n}`);
  }

  const cart = await page.evaluate(() => {
    const lines = Array.from(
      document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]'),
    ).map((n) => n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""));
    const txt = document.body.innerText;
    return {
      lines,
      total: /Total \(est\.\)\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(txt)?.[1] ?? null,
    };
  });
  log("  cart:", JSON.stringify(cart));
  await shot(page, "03a-cart");

  if (cart.lines.length !== 3) throw new Error(`expected 3 cart lines, got ${cart.lines.length}`);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(8000);
  await shot(page, "03b-fired");

  const list = await apiGet(page, "/api/v1/pos/orders?size=5");
  const rows = list.body?.data ?? list.body ?? [];
  const order = Array.isArray(rows) ? rows[0] : null;
  log("  newest order:", order?.orderNo, order?.status, order?.id);

  saveState({ ring: { cart, orderNo: order?.orderNo, orderId: order?.id, status: order?.status } });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "03z-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
