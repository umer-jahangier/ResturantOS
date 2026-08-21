/*
 * S1 re-open, step 8 — the two claims that were not cleanly proved:
 *
 *  (a) a PER-ITEM exception that CONTRADICTS its category actually moves the TICKET, not just the
 *      admin screen. Mutton Biryani lives in Mains, Mains fires to GRILL, and I route the dish
 *      itself to BAR. If routing is real, the kebab-shaped case holds: Karahi -> GRILL and
 *      Biryani -> BAR off the same check.
 *
 *  (b) the SECOND FIRE. A table orders a second round on the same check. The claimant only ever
 *      drove the first send. "Routing works when the check is created" and "routing works when
 *      the check is amended" are different claims and this codebase has broken exactly there.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log, writeJson, loadState,
} from "./lib.mjs";

const st = loadState();
const BRANCH = st.branchId;
const out = {};

const browser = await newBrowser();
try {
  // ---------- (1) owner sets the conflicting per-item exception, through the control ----------
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  await go(owner, "/app/menu/routing", { waitMs: 4500 });

  const bar = st.stations.find((s) => s.code === "BAR");
  const before = owner.__requests.length;
  await owner
    .locator('[data-testid="routing-item"][data-item-name="Mutton Biryani"] [data-testid="item-station-select"]')
    .first()
    .selectOption(bar.id);
  await owner.waitForTimeout(3500);
  const puts = owner.__requests.slice(before).filter((r) => r.m === "PUT");
  const toasts = await owner.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => (n.textContent || "").trim()),
  );
  log(`  set Mutton Biryani -> BAR: PUTs=${puts.length} ${JSON.stringify(puts.map((p) => p.s))} toasts=${JSON.stringify(toasts)}`);
  await shot(owner, "08a-biryani-exception");

  const wire0 = await apiGet(owner, `/api/v1/pos/menu/routing?branchId=${BRANCH}`);
  const w0 = (wire0.body?.data ?? wire0.body)?.items ?? [];
  const pick = (n) => w0.find((i) => i.itemName === n);
  out.routesBeforeRing = ["Pinacolada", "Chicken Karahi", "Mutton Biryani", "Chicken Samosa", "Fresh Lime"].map((n) => {
    const i = pick(n);
    return i ? { name: n, cat: i.categoryName, eff: i.effectiveStationCode, src: i.source } : { name: n, missing: true };
  });
  log(`  routes before the ring: ${JSON.stringify(out.routesBeforeRing)}`);
  await owner.close();

  // ---------- (2) the cashier rings and fires ----------
  const page = await newPage(browser);
  await login(page, PEOPLE.cashier);
  await go(page, "/app/pos", { waitMs: 9000 });
  await page.locator("[data-testid=order-type-dine_in]").click().catch(() => {});
  await page.waitForTimeout(700);

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
  const cartLines = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]')).map((n) =>
        n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""),
      ),
    );

  const ROUND1 = ["Pinacolada", "Chicken Karahi", "Mutton Biryani"];
  for (const n of ROUND1) await ring(n);
  out.cart1 = await cartLines();
  log(`  cart round 1: ${JSON.stringify(out.cart1)}`);
  await shot(page, "08b-cart-round1");
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(9000);
  await shot(page, "08c-fired-round1");

  const orderNo = await page.evaluate(() => {
    const m = /ORD-\d{8}-\d{4}/.exec(document.body.innerText || "");
    return m ? m[0] : null;
  });
  out.orderNo = orderNo;
  log(`  order: ${orderNo}`);
  if (!orderNo) throw new Error("no order number on screen after the first fire");

  // ---------- (3) SECOND ROUND on the same check ----------
  const ROUND2 = ["Chicken Samosa", "Fresh Lime"];
  out.round2 = { attempted: true };
  try {
    for (const n of ROUND2) await ring(n);
    out.cart2 = await cartLines();
    log(`  cart round 2: ${JSON.stringify(out.cart2)}`);
    await shot(page, "08d-cart-round2");
    const send = page.locator("[data-testid=send-to-kitchen-button]");
    out.round2.sendButtonPresent = (await send.count()) > 0;
    if (out.round2.sendButtonPresent) {
      await send.first().click();
      await page.waitForTimeout(10000);
      out.round2.fired = true;
      await shot(page, "08e-fired-round2");
      const stillSame = await page.evaluate(() => {
        const m = /ORD-\d{8}-\d{4}/.exec(document.body.innerText || "");
        return m ? m[0] : null;
      });
      out.round2.orderNoAfter = stillSame;
      log(`  round 2 fired; order number on screen is now ${stillSame}`);
    } else {
      log("  ! no Send to Kitchen control for a second round");
    }
  } catch (e) {
    out.round2.error = e.message;
    log(`  ! round 2 failed: ${e.message}`);
    await shot(page, "08z-round2-failed");
  }
  await page.close();

  // ---------- (4) what the kitchen received ----------
  const kds = await newPage(browser);
  await login(kds, PEOPLE.kitchen);
  const tickets = await apiGet(
    kds,
    `/api/v1/kitchen/kds/tickets?branchId=${BRANCH}&status=PENDING,COOKING,READY&size=300`,
  );
  const tb = tickets.body?.content ?? tickets.body?.data?.content ?? tickets.body?.data ?? [];
  const mine = (Array.isArray(tb) ? tb : []).filter((t) => (t.orderNo ?? t.orderNumber) === orderNo);
  out.kitchen = mine.map((t) => ({
    station: t.stationCode ?? t.station,
    status: t.status,
    createdAt: t.createdAt ?? t.firedAt,
    items: (t.items ?? []).map((i) => `${i.quantity ?? i.qty}× ${i.itemName ?? i.name}`),
  }));
  log(`  kitchen tickets for ${orderNo}: ${mine.length}`);
  for (const t of out.kitchen) log(`    ${String(t.station).padEnd(9)} ${JSON.stringify(t.items)}`);

  // Boards in the browser, so the API answer is not the only witness.
  out.boardsDom = {};
  for (const code of ["BAR", "GRILL", "PANTRY1", "DEFAULT"]) {
    await go(kds, `/app/kitchen/${code}`, { waitMs: 6000, allowTrouble: true });
    const dom = await kds.evaluate((no) => {
      const cards = Array.from(document.querySelectorAll("[data-ticket-id], article"))
        .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim())
        .filter((s) => s.includes(no));
      return {
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        cards,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
      };
    }, orderNo);
    out.boardsDom[code] = dom;
    await shot(kds, `08f-board-${code}`);
    log(`  [${code}] ${JSON.stringify(dom.h1)} -> ${JSON.stringify(dom.cards.map((c) => c.slice(0, 130)))} alerts=${JSON.stringify(dom.alerts)}`);
  }
  await kds.close();

  // ---------- (5) verdict ----------
  const expected = {
    Pinacolada: "BAR",
    "Chicken Karahi": "GRILL",
    "Mutton Biryani": "BAR",
    "Chicken Samosa": "PANTRY1",
    "Fresh Lime": "BAR",
  };
  out.verdict = [];
  for (const [name, want] of Object.entries(expected)) {
    const t = out.kitchen.find((k) => k.items.some((i) => i.endsWith(`× ${name}`)));
    const got = t?.station ?? "(no ticket)";
    out.verdict.push({ name, want, got, ok: got === want });
    log(`  ${got === want ? "OK      " : "MISMATCH"} ${name.padEnd(16)} expected ${String(want).padEnd(8)} got ${got}`);
  }
  writeJson("08-exception-second-fire.json", out);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
  writeJson("08-exception-second-fire.json", { ...out, fatal: e.message });
} finally {
  await browser.close();
}
