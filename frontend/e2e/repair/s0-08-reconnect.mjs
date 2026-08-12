/*
 * S0 #7, the path the main harness does NOT cover: the cashier who stays at the till.
 *
 * ring Rs 499 → offline → Send to Kitchen → back online WITHOUT reloading. What does the
 * order panel show once the outbox drains? The order was created under a client-side stub
 * id; the server assigned a different one. If nothing rebinds, the panel keeps rendering a
 * ghost that no longer exists anywhere.
 *
 *   node e2e/repair/s0-08-reconnect.mjs after
 */
import { chromium } from "@playwright/test";
import { BASE, CASHIER, ITEM_499, ensureTerminal, login, probe, readOutbox, ringItem, shot } from "./s0-08-lib.mjs";

const LABEL = process.argv[2] ?? "reconnect";
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  await login(page, CASHIER);
  await ensureTerminal(page);
  await ringItem(page, ITEM_499);

  await ctx.setOffline(true);
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="send-to-kitchen-button"]').first().click();
  await page.waitForTimeout(3500);
  const offline = await probe(page);
  log("OFFLINE  badge:", JSON.stringify(offline.liveIndicator));
  log("OFFLINE  totals:", JSON.stringify(offline.totals));
  log("OFFLINE  strip:", JSON.stringify(offline.queuedStrip));
  await shot(page, LABEL, "10-offline-queued");

  log("\n-- back online, staying on the till (no reload) --");
  await ctx.setOffline(false);
  await page.waitForTimeout(12000);
  const online = await probe(page);
  log("ONLINE   outbox:", JSON.stringify(await readOutbox(page)));
  log("ONLINE   badge:", JSON.stringify(online.liveIndicator));
  log("ONLINE   totals:", JSON.stringify(online.totals));
  log("ONLINE   strip:", JSON.stringify(online.queuedStrip));
  log("ONLINE   order no on screen:", online.orderNoOnScreen);
  log("ONLINE   panel head:", JSON.stringify(online.bodyHead.slice(0, 200)));
  await shot(page, LABEL, "11-online-rebound");
} finally {
  await browser.close();
}
