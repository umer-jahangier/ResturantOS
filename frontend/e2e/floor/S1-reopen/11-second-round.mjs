/*
 * S1 RE-OPEN 11 — the adjacent path nobody drove: a SECOND ROUND on an already-fired check.
 *
 * Real service is not one fire per check. Ring a curry, fire it; then add a drink to the SAME
 * check and fire again. The drink must reach BAR on round two — a routing that only works on
 * the first fire is a routing that fails every table that orders a second drink.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const browser = await newBrowser();
const out = {};

async function ring(page, name) {
  const search = page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i]');
  if (await search.count()) { await search.first().fill(name); await page.waitForTimeout(1800); }
  const tile = page.locator('[data-testid="menu-grid"] button[aria-pressed]').filter({ hasText: name }).first();
  await tile.waitFor({ timeout: 20000 });
  await tile.click();
  await page.waitForTimeout(900);
  if (await search.count()) { await search.first().fill(""); await page.waitForTimeout(1400); }
}

try {
  const p = await newPage(browser);
  await login(p, PEOPLE.cashier);
  await go(p, "/app/pos", { waitMs: 9000 });
  await p.locator("[data-testid=order-type-dine_in]").click().catch(() => {});
  await p.waitForTimeout(700);

  // round 1 — a curry only
  await ring(p, "Chicken Karahi");
  await p.locator("[data-testid=send-to-kitchen-button]").click();
  await p.waitForTimeout(9000);
  await shot(p, "11a-round1-fired");

  const list1 = await apiGet(p, `/api/v1/pos/orders?branchId=${BRANCH}&page=0&size=3`);
  const order = (list1.body?.data?.content ?? list1.body?.data ?? [])[0];
  log("round 1 order:", order?.orderNo, order?.id);
  out.orderNo = order?.orderNo;

  // round 2 — add a drink to the SAME check and fire again
  await ring(p, "Pinacolada");
  const cart = await p.evaluate(() =>
    Array.from(document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]')).map((n) =>
      n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""),
    ),
  );
  log("cart before round 2 fire:", JSON.stringify(cart));
  await shot(p, "11b-round2-cart");
  await p.locator("[data-testid=send-to-kitchen-button]").click();
  await p.waitForTimeout(10000);
  await shot(p, "11c-round2-fired");

  const detail = await apiGet(p, `/api/v1/pos/orders/${order?.id}?branchId=${BRANCH}`);
  const dd = detail.body?.data ?? detail.body;
  out.lines = (dd?.items ?? []).map((i) => ({
    name: i.itemNameSnapshot ?? i.itemName,
    status: i.itemStatus,
    revisionNo: i.revisionNo,
    kdsStation: i.kdsStation,
    stationCode: i.stationCode,
  }));
  log("order lines after round 2:", JSON.stringify(out.lines, null, 1));
  await p.close();

  // the boards
  const kp = await newPage(browser);
  await login(kp, PEOPLE.kitchen);
  const boards = {};
  for (const code of ["BAR", "GRILL"]) {
    await go(kp, `/app/kitchen/${code}`, { waitMs: 8000, allowTrouble: true });
    boards[code] = await kp.evaluate((ord) => {
      const txt = document.body.innerText || "";
      const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
      return {
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 120)),
        mine: cards.filter((c) => (c.innerText || "").includes(ord)).map((c) => (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200)),
        hasOrder: txt.includes(ord),
      };
    }, out.orderNo ?? "@@@");
    log(`/app/kitchen/${code}:`, JSON.stringify(boards[code], null, 1));
    await shot(kp, `11d-${code.toLowerCase()}`);
  }
  out.boards = boards;
  writeFileSync(`${OUT}/11-second-round.json`, JSON.stringify(out, null, 2));
} catch (e) {
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/11-second-round.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
