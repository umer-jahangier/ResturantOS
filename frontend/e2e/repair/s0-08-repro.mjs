/*
 * S0 #7 reproduction / proof — offline Send to Kitchen.
 *
 * Drives the DONE MEANS click path exactly:
 *   1. cashier signs in, opens /app/pos
 *   2. rings the Rs 499.00 tile
 *   3. Chromium goes OFFLINE           -> read the connection badge
 *   4. presses Send to Kitchen         -> read the panel totals + any queued notice
 *   5. reload while still offline      -> is there an offline shell or a blank page?
 *   6. back ONLINE, wait for the sync pass
 *   7. Order Management: status + total of the synced order
 *   8. kitchen persona: does a card exist on /app/kitchen/DEFAULT ?
 *
 *   node e2e/repair/s0-08-repro.mjs before|after
 */
import { chromium } from "@playwright/test";
import {
  BASE,
  CASHIER,
  KITCHEN,
  ITEM_499,
  ensureTerminal,
  login,
  probe,
  readOutbox,
  ringItem,
  shot,
} from "./s0-08-lib.mjs";

const LABEL = process.argv[2] ?? "run";
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`console.error: ${m.text().slice(0, 200)}`);
});

try {
  log("1) sign in as cashier");
  await login(page, CASHIER);
  await ensureTerminal(page);
  await shot(page, LABEL, "01-terminal-online");

  log("2) ring", ITEM_499);
  await ringItem(page, ITEM_499);
  const afterRing = await probe(page);
  log("   totals in cart:", JSON.stringify(afterRing.totals));
  log("   connection badge:", afterRing.liveIndicator);

  log("3) go OFFLINE");
  await ctx.setOffline(true);
  await page.waitForTimeout(3000);
  const offlineProbe = await probe(page);
  log("   connection badge OFFLINE:", JSON.stringify(offlineProbe.liveIndicator));
  log("   banner:", JSON.stringify(offlineProbe.banner));
  await shot(page, LABEL, "02-offline-before-send");

  log("4) press Send to Kitchen (offline)");
  await page.locator('[data-testid="send-to-kitchen-button"]').first().click();
  await page.waitForTimeout(4000);
  const afterSend = await probe(page);
  log("   totals after send:", JSON.stringify(afterSend.totals));
  log("   toasts:", JSON.stringify(afterSend.toasts));
  log("   alerts:", JSON.stringify(afterSend.alerts));
  log("   sync badge:", JSON.stringify(afterSend.syncBadge));
  log("   queued strip:", JSON.stringify(afterSend.queuedStrip));
  log("   connection badge:", JSON.stringify(afterSend.liveIndicator));
  log("   queued wording anywhere on screen:", afterSend.queuedNotice);
  await page.waitForTimeout(3000);
  const settle = await probe(page);
  log("   [+3s] sync badge:", JSON.stringify(settle.syncBadge), "totals:", JSON.stringify(settle.totals));
  log("   outbox:", JSON.stringify(await readOutbox(page)));
  await shot(page, LABEL, "03-offline-after-send");

  log("5) reload while STILL offline");
  let reloadBody = "";
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (e) {
    reloadBody = `NAVIGATION THREW: ${String(e).split("\n")[0]}`;
  }
  await page.waitForTimeout(2500);
  const bodyText = await page.evaluate(() => document.body.innerText.trim()).catch(() => "");
  log("   reload result:", reloadBody || "(navigated)");
  log("   body length:", bodyText.length, "| head:", JSON.stringify(bodyText.slice(0, 240)));
  await shot(page, LABEL, "04-offline-reload");

  log("6) back ONLINE — the cashier stays at the till, no reload");
  await ctx.setOffline(false);
  await page.waitForTimeout(10000);
  log("   outbox after sync:", JSON.stringify(await readOutbox(page)));
  const afterSync = await probe(page);
  log("   connection badge:", JSON.stringify(afterSync.liveIndicator));
  log("   totals:", JSON.stringify(afterSync.totals));
  log("   order no on screen:", afterSync.orderNoOnScreen);
  log("   toasts:", JSON.stringify(afterSync.toasts));
  await shot(page, LABEL, "05-back-online");
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  log("7) Order Management");
  await page.locator('button:has-text("Order Management")').first().click();
  await page.waitForTimeout(4000);
  const rows = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll("tr")) {
      const t = tr.innerText.replace(/\s+/g, " ").trim();
      if (/ORD-\d{8}-\d+/.test(t)) out.push(t);
    }
    return out.slice(0, 12);
  });
  rows.forEach((r) => log("   row:", r));
  await shot(page, LABEL, "06-order-management");

  // The order this run created is the newest ORD- row.
  const newest = rows[0] ?? "";
  const orderNo = (newest.match(/ORD-\d{8}-\d+/) || [])[0] ?? null;
  log("   >>> THIS RUN'S ORDER:", orderNo, "|", newest);

  log("8) kitchen board — looking for", orderNo);
  const kctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const kpage = await kctx.newPage();
  await login(kpage, KITCHEN);
  await kpage.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await kpage.waitForTimeout(6000);
  const kds = await kpage.evaluate((wanted) => {
    const body = document.body.innerText;
    const orderNos = Array.from(new Set(body.match(/ORD-\d{8}-\d+/g) || []));
    return {
      found: wanted ? body.includes(wanted) : false,
      orderNosOnBoard: orderNos,
      counts: (body.match(/\b(NEW|STARTED|PREPARING|READY)\b[^\n]*/g) || []).slice(0, 6),
    };
  }, orderNo);
  log("   card for this order on /app/kitchen/DEFAULT:", kds.found);
  log("   order numbers on board:", JSON.stringify(kds.orderNosOnBoard.slice(0, 15)));
  log("   column headers:", JSON.stringify(kds.counts));
  await shot(kpage, LABEL, "07-kds-default");
  await kctx.close();

  log("\nconsole errors seen:", JSON.stringify(consoleErrors.slice(0, 12), null, 2));
} finally {
  await browser.close();
}
