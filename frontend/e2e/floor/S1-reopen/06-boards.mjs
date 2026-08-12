/*
 * S1 RE-OPEN 06 — where did my three lines actually land?
 * Reads the order back over HTTP, then drives the four KDS boards as the kitchen persona.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, saveState, log, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const browser = await newBrowser();
const out = {};

try {
  // 1 — the order, as POS stored it
  const cp = await newPage(browser);
  await login(cp, PEOPLE.cashier);
  const list = await apiGet(cp, `/api/v1/pos/orders?branchId=${BRANCH}&page=0&size=5`);
  const rows = list.body?.data?.content ?? list.body?.data ?? [];
  const order = Array.isArray(rows) ? rows[0] : null;
  log("newest order:", order?.orderNo, order?.status, order?.id);
  const detail = await apiGet(cp, `/api/v1/pos/orders/${order?.id}?branchId=${BRANCH}`);
  const dd = detail.body?.data ?? detail.body;
  const lines = (dd?.items ?? []).map((i) => ({
    name: i.itemNameSnapshot ?? i.itemName,
    status: i.itemStatus,
    kdsStation: i.kdsStation,
    stationCode: i.stationCode,
    stationName: i.stationName,
  }));
  log("order lines:", JSON.stringify(lines, null, 1));
  out.order = { orderNo: order?.orderNo, orderId: order?.id, lines };
  await cp.close();

  // 2 — the boards, as the kitchen sees them
  const kp = await newPage(browser);
  await login(kp, PEOPLE.kitchen);

  const idx = await go(kp, "/app/kitchen", { waitMs: 6000 });
  const idxText = await kp.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900));
  log("station index:", kp.url(), JSON.stringify(idx), "\n  text:", idxText);
  out.stationIndex = { url: kp.url(), trouble: idx, text: idxText };
  await shot(kp, "06a-station-index");

  const boards = {};
  for (const code of ["BAR", "GRILL", "DEFAULT", "PANTRY1"]) {
    const t = await go(kp, `/app/kitchen/${code}`, { waitMs: 7000 });
    const info = await kp.evaluate((want) => {
      const txt = document.body.innerText || "";
      const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket"], [data-testid="ticket-card"], article'));
      return {
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
        cardCount: cards.length,
        hasOrder: txt.includes(want.orderNo ?? "@@@"),
        mentions: {
          Pinacolada: /Pinacolada/.test(txt),
          "Chicken Samosa": /Chicken Samosa/.test(txt),
          "RX Beta 582578": /RX Beta 582578/.test(txt),
        },
        noStations: /No active stations configured/i.test(txt),
        excerpt: txt.replace(/\s+/g, " ").slice(0, 500),
      };
    }, { orderNo: out.order.orderNo });
    boards[code] = { trouble: t, ...info };
    log(`\n/app/kitchen/${code}:`, JSON.stringify(info, null, 1));
    await shot(kp, `06b-${code.toLowerCase()}`);
  }
  out.boards = boards;
  writeFileSync(`${OUT}/06-boards.json`, JSON.stringify(out, null, 2));
  saveState({ boards: out });
} catch (e) {
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/06-boards.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
