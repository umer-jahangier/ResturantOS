/*
 * S1 RE-OPEN 05 — the cashier rings ONE check that must split three ways, using MY routes.
 *
 *   Pinacolada      Drinks   -> category rule -> BAR
 *   Chicken Samosa  Starters -> per-item rule -> GRILL   (its category says PANTRY1)
 *   RX Beta 582578  RX Cat   -> no rule       -> DEFAULT
 *
 * PANTRY1 must carry NONE of them — that is the per-item exception actually working.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, log, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const WANT = ["Pinacolada", "Chicken Samosa", "RX Beta 582578"];
const browser = await newBrowser();
const page = await newPage(browser);
const out = {};

async function ring(name) {
  const search = page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i]');
  if (await search.count()) {
    await search.first().fill(name);
    await page.waitForTimeout(1800);
  }
  const tile = page.locator('[data-testid="menu-grid"] button[aria-pressed]').filter({ hasText: name }).first();
  await tile.waitFor({ timeout: 20000 });
  await tile.click();
  await page.waitForTimeout(900);
  if (await search.count()) {
    await search.first().fill("");
    await page.waitForTimeout(1400);
  }
}

try {
  await login(page, PEOPLE.cashier);
  const t = await go(page, "/app/pos", { waitMs: 9000 });
  log("/app/pos:", JSON.stringify(t));
  await page.locator("[data-testid=order-type-dine_in]").click().catch(() => {});
  await page.waitForTimeout(700);

  for (const n of WANT) {
    await ring(n);
    log("rang", n);
  }

  const cart = await page.evaluate(() => {
    const lines = Array.from(
      document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]'),
    ).map((n) => n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""));
    return { lines, total: /Total \(est\.\)\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(document.body.innerText)?.[1] ?? null };
  });
  log("cart:", JSON.stringify(cart));
  await shot(page, "05a-cart");
  if (cart.lines.length !== 3) throw new Error(`expected 3 cart lines, got ${cart.lines.length}`);

  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(9000);
  await shot(page, "05b-fired");

  const list = await apiGet(page, "/api/v1/pos/orders?size=5");
  const rows = list.body?.data?.content ?? list.body?.data ?? list.body ?? [];
  const order = Array.isArray(rows) ? rows[0] : null;
  log("newest order:", order?.orderNo, order?.status, order?.id);

  // What did POS actually snapshot per line?
  const detail = await apiGet(page, `/api/v1/pos/orders/${order?.id}`);
  const items = (detail.body?.data ?? detail.body)?.items ?? [];
  const lines = items.map((i) => ({
    name: i.itemNameSnapshot ?? i.itemName,
    status: i.itemStatus,
    stationCode: i.stationCode ?? i.kdsStation,
    stationName: i.stationName,
  }));
  log("order lines:", JSON.stringify(lines, null, 1));
  out.order = { orderNo: order?.orderNo, orderId: order?.id, cart, lines };
  writeFileSync(`${OUT}/05-ring.json`, JSON.stringify(out, null, 2));
  saveState({ ring: out.order });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "05z-failure");
  writeFileSync(`${OUT}/05-ring.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
