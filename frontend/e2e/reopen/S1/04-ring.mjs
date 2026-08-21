/*
 * S1 re-open, step 4: ring a check against MY OWN routes, fire it, then ADD MORE and fire AGAIN.
 *
 * The second fire is the adjacent path the claimant never drove. "Routing works on the first
 * send" and "routing works when a table orders a second round" are two different claims, and the
 * amend path is exactly where this codebase has broken before.
 *
 * Expected split, from the routes set in step 2 plus the ones already standing:
 *   Pinacolada     Drinks   -> category  -> BAR
 *   Chicken Karahi Mains    -> category  -> GRILL   (MY new category route)
 *   Mutton Biryani Mains    -> ITEM      -> BAR     (MY exception, must beat its category)
 *   Chicken Samosa Starters -> category  -> PANTRY1
 * second fire:
 *   Fresh Lime     Drinks   -> category  -> BAR
 *   Butter Naan    Starters -> ITEM      -> GRILL
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, log, writeJson,
} from "./lib.mjs";

const FIRST = ["Pinacolada", "Chicken Karahi", "Mutton Biryani", "Chicken Samosa"];
const SECOND = ["Fresh Lime", "Butter Naan"];

const browser = await newBrowser();
const page = await newPage(browser);

async function ring(name) {
  const search = page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i]');
  if (await search.count()) {
    await search.first().fill(name);
    await page.waitForTimeout(1600);
  }
  const tile = page
    .locator('[data-testid="menu-grid"] button[aria-pressed]')
    .filter({ hasText: name })
    .first();
  await tile.waitFor({ timeout: 15000 });
  await tile.click();
  await page.waitForTimeout(800);
  if (await search.count()) {
    await search.first().fill("");
    await page.waitForTimeout(1200);
  }
}

async function cartLines() {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]'),
    ).map((n) => n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, "")),
  );
}

try {
  await login(page, PEOPLE.cashier);
  const t = await go(page, "/app/pos", { waitMs: 9000 });
  log("  /app/pos:", JSON.stringify(t.bad), JSON.stringify(t.alerts));

  await page.locator("[data-testid=order-type-dine_in]").click().catch(() => {});
  await page.waitForTimeout(700);

  for (const n of FIRST) {
    await ring(n);
    log(`  rang ${n}`);
  }
  const c1 = await cartLines();
  log("  cart 1:", JSON.stringify(c1));
  await shot(page, "04a-cart-first");
  if (c1.length !== FIRST.length) throw new Error(`expected ${FIRST.length} lines, got ${c1.length}`);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(9000);
  await shot(page, "04b-fired-first");

  const list = await apiGet(page, "/api/v1/pos/orders?size=5");
  const rows = list.body?.data ?? list.body ?? [];
  const order = Array.isArray(rows) ? rows[0] : null;
  log("  order:", order?.orderNo, order?.status, order?.id);
  if (!order?.id) throw new Error("no order id after first fire");

  // ---- SECOND FIRE: same check, two more dishes ----
  const bodyAfter = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400));
  log("  screen after fire:", bodyAfter.slice(0, 220));

  let secondFired = false;
  let secondNote = "";
  try {
    for (const n of SECOND) {
      await ring(n);
      log(`  rang (2nd round) ${n}`);
    }
    const c2 = await cartLines();
    log("  cart 2:", JSON.stringify(c2));
    await shot(page, "04c-cart-second");
    const send = page.locator("[data-testid=send-to-kitchen-button]");
    if (await send.count()) {
      await send.click();
      await page.waitForTimeout(9000);
      secondFired = true;
      await shot(page, "04d-fired-second");
    } else {
      secondNote = "no send-to-kitchen button available for a second round";
    }
  } catch (e) {
    secondNote = `second round failed: ${e.message}`;
    log(`  ! ${secondNote}`);
    await shot(page, "04z-second-failed");
  }

  const list2 = await apiGet(page, "/api/v1/pos/orders?size=5");
  const rows2 = list2.body?.data ?? list2.body ?? [];
  log("  newest orders after 2nd fire:", JSON.stringify(rows2.slice(0, 3).map((o) => ({ no: o.orderNo, id: o.id, st: o.status }))));

  const detail = await apiGet(page, `/api/v1/pos/orders/${order.id}`);
  const d = detail.body?.data ?? detail.body;
  const lines = (d?.items ?? d?.lines ?? []).map((l) => ({
    name: l.itemName ?? l.name, qty: l.quantity ?? l.qty, status: l.status,
  }));
  log("  order lines:", JSON.stringify(lines));

  writeJson("04-ring.json", {
    orderNo: order.orderNo, orderId: order.id, cart1: c1, secondFired, secondNote,
    lines, newestOrders: rows2.slice(0, 3).map((o) => ({ no: o.orderNo, id: o.id, st: o.status })),
    consoleErrors: page.__console.slice(0, 8),
  });
  saveState({ ring: { orderNo: order.orderNo, orderId: order.id, secondFired, secondNote } });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "04z-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
