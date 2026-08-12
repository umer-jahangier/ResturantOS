/*
 * S1-01 PROOF — the DONE MEANS click path, driven end to end in real Chromium.
 *
 *  1. Sign in as admin@terrace.local (TOTP).
 *  2. Reach the routing screen FROM THE SIDEBAR — never by typing a URL.
 *  3. Route the category "Drinks" to the BAR station, and reload: it is still there.
 *  4. Sign in as cashier@terrace.local, ring ONE food item and ONE drink on the same check,
 *     Send to Kitchen.
 *  5. /app/kitchen/DEFAULT shows the food and NOT the drink; /app/kitchen/BAR shows the drink.
 *  6. Override ONE item's station from the same screen and prove the item route beats the
 *     category route — on the screen AND on a second fired check.
 *
 * Every step asserts. A step that cannot be asserted is reported as a failure, not skipped.
 *
 * Run: node e2e/repair/s1-01-proof.mjs
 */
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./s1-01-lib.mjs";

const FOOD = "Chicken Karahi";
const DRINK = "Fresh Lime";
const OTHER_DRINK = "Pinacolada";
const BAR_LABEL = /Main bar \(BAR\)/;
const GRILL_LABEL = /Hot line \(GRILL\)/;

const failures = [];
function check(ok, what) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
  return ok;
}

const browser = await chromium.launch({ headless: true });

// ── admin context ─────────────────────────────────────────────────────────────────────────
const adminCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const admin = await adminCtx.newPage();
admin.on("response", (res) => {
  const u = res.url();
  if (/\/station\b|\/menu\/routing/.test(u) && res.request().method() !== "OPTIONS") {
    console.log(`    NET ${res.request().method()} ${res.status()} ${u.replace("http://localhost:8080", "")}`);
  }
});

/** Read the routing screen's own DOM back — what a human would see, not what an API says. */
async function readBoard(page) {
  return page.evaluate(() => {
    const cats = [...document.querySelectorAll('[data-testid="routing-category"]')].map((el) => ({
      name: el.getAttribute("data-category-name"),
      selected:
        el.querySelector('[data-testid="category-station-select"]')?.selectedOptions?.[0]
          ?.textContent ?? null,
    }));
    const items = [...document.querySelectorAll('[data-testid="routing-item"]')].map((el) => ({
      name: el.getAttribute("data-item-name"),
      effective: el.getAttribute("data-effective-station"),
      source: el.getAttribute("data-route-source"),
      destinationText:
        el.querySelector('[data-testid="routing-item-destination"]')?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    }));
    return { cats, items, summary: document.querySelector('[data-testid="routing-summary"]')?.textContent ?? null };
  });
}

try {
  // ── 1. sign in as the tenant admin ──────────────────────────────────────────────────────
  console.log("\n== 1. sign in as admin@terrace.local ==");
  await login(admin, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  console.log("  landed:", admin.url());
  await openAndCheck(admin, "/app/dashboard");

  // ── 2. reach the screen FROM THE SIDEBAR ────────────────────────────────────────────────
  console.log("\n== 2. navigate from the sidebar (no URL typing) ==");
  const navLink = admin.getByRole("link", { name: "Station Routing", exact: true }).first();
  check(await navLink.isVisible().catch(() => false), 'sidebar offers a "Station Routing" entry');
  await shot(admin, "after-01-sidebar-entry");
  await navLink.click();
  // 90s, not 20: the Next DEV server compiles a route on its first request, and a compile is not
  // a product behaviour. The assertion is the sidebar click and where it lands, not the clock.
  await admin.waitForURL(/\/app\/menu\/routing/, { timeout: 90000 });
  await admin.waitForTimeout(5000);

  const h1 = await admin.locator("h1").first().innerText().catch(() => "(none)");
  const body = await admin.locator("body").innerText();
  check(h1 === "Station Routing", `h1 is "Station Routing" (was "${h1}")`);
  check(!/This page doesn'?t exist/i.test(body), "the route exists (not the 404 page)");
  check(!/Access denied|do not have permission/i.test(body), "not an access-denied page");
  // Next.js's own route announcer is a `role="alert"` carrying the page TITLE — it is on every
  // route in the app and is not an error. Excluding it by ancestor, and ignoring empty nodes,
  // leaves exactly the thing that must not be here: an application alert that says something.
  const alerts = await admin.evaluate(() =>
    [...document.querySelectorAll('[role="alert"]')]
      .filter((el) => !el.closest("next-route-announcer"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean),
  );
  check(alerts.length === 0, `no error alert on the screen (saw ${JSON.stringify(alerts)})`);
  await shot(admin, "after-02-routing-screen");

  let board = await readBoard(admin);
  console.log("  summary:", board.summary);
  const drinksBefore = board.cats.find((c) => c.name === "Drinks");
  check(!!drinksBefore, "the Drinks category is on the screen");
  check(
    /Not routed/i.test(drinksBefore?.selected ?? ""),
    `Drinks starts UNROUTED (select reads "${drinksBefore?.selected}")`,
  );

  // ── 3. route Drinks → BAR, then reload ──────────────────────────────────────────────────
  console.log("\n== 3. set Drinks -> BAR and reload ==");
  const drinksSelect = admin
    .locator('[data-testid="routing-category"][data-category-name="Drinks"]')
    .locator('[data-testid="category-station-select"]');
  await drinksSelect.selectOption({ label: "Main bar (BAR)" });
  await admin.waitForTimeout(3500);
  const toast = await admin.locator("[data-sonner-toast], [role='status']").allInnerTexts().catch(() => []);
  console.log("  toast:", JSON.stringify(toast));
  check(
    toast.some((t) => /Drinks now fires to Main bar/i.test(t)),
    "a toast confirms the save in the operator's words",
  );
  await shot(admin, "after-03-drinks-routed");

  await admin.reload({ waitUntil: "domcontentloaded" });
  await admin.waitForTimeout(4000);
  board = await readBoard(admin);
  const drinksAfter = board.cats.find((c) => c.name === "Drinks");
  check(
    BAR_LABEL.test(drinksAfter?.selected ?? ""),
    `after a FULL RELOAD Drinks still reads "${drinksAfter?.selected}"`,
  );
  const lime = board.items.find((i) => i.name === DRINK);
  const karahi = board.items.find((i) => i.name === FOOD);
  check(lime?.effective === "BAR" && lime?.source === "CATEGORY", `${DRINK} inherits BAR from the category`);
  check(karahi?.effective === "DEFAULT" && karahi?.source === "NONE", `${FOOD} is still unrouted (DEFAULT)`);
  console.log("  summary after:", board.summary);
  await shot(admin, "after-04-persisted-after-reload");

  // ── 4. cashier rings a mixed check ──────────────────────────────────────────────────────
  console.log("\n== 4. cashier rings one food + one drink on ONE check ==");
  const cashierCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const cashier = await cashierCtx.newPage();
  let orderNo = null;
  /**
   * Read the order number off the till's own order panel. Scoping the board assertions to THE
   * check just rung is not pedantry: this tenant has 50+ historical tickets on DEFAULT, many of
   * them containing a drink, because routing is snapshotted per LINE at add-item time and those
   * lines were added before any route existed. "DEFAULT contains no drink anywhere, ever" is a
   * false claim; "this check's DEFAULT ticket contains no drink" is the real one.
   */
  async function currentOrderNumber(page) {
    const text = await page.locator("body").innerText();
    const m = text.match(/ORD-\d{8}-\d{4}/);
    return m ? m[0] : null;
  }
  await login(cashier, { email: "cashier@terrace.local", password: "Terrace#Cashier1" });
  await openAndCheck(cashier, "/app/pos", { settle: 5000 });

  async function ring(page, name) {
    const tile = page.getByRole("button").filter({ hasText: new RegExp(name, "i") }).first();
    if (!(await tile.isVisible().catch(() => false))) {
      const tab = page.getByRole("tab").filter({ hasText: /drink/i }).first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(1500);
      }
    }
    const again = page.getByRole("button").filter({ hasText: new RegExp(name, "i") }).first();
    const ok = await again.isVisible().catch(() => false);
    if (ok) {
      await again.click();
      await page.waitForTimeout(1200);
    }
    return check(ok, `rang "${name}" on the till`);
  }

  await ring(cashier, FOOD);
  await ring(cashier, DRINK);
  await shot(cashier, "after-05-mixed-cart");

  const send = cashier.getByRole("button", { name: /send to kitchen/i }).first();
  check(await send.isVisible().catch(() => false), '"Send to Kitchen" is available');
  await send.click();
  await cashier.waitForTimeout(7000);
  orderNo = await currentOrderNumber(cashier);
  console.log("  the check just fired:", orderNo);
  check(!!orderNo, "the till shows the order number of the check just fired");
  await shot(cashier, "after-06-sent-to-kitchen");

  // ── 5. the two boards ───────────────────────────────────────────────────────────────────
  console.log("\n== 5. the DEFAULT board and the BAR board ==");
  /**
   * Cards for ONE order, walking the board's pages. The board pages at 16 fragments (register
   * S1 #11) and PageDown is the only control, so a single-page read would silently miss a ticket
   * that is simply on page 3 — and "not found" would read as "correctly absent".
   */
  async function cardsForOrder(page, code, wantedOrderNo) {
    await openAndCheck(page, `/app/kitchen/${code}`, { settle: 6000 });
    const count = await page.locator('[data-testid="kds-ticket-count"]').innerText().catch(() => "(none)");
    const seen = [];
    let pages = 1;
    for (let i = 0; i < 12; i += 1) {
      const cards = await page.locator('[data-testid="kds-ticket-card"]').allInnerTexts().catch(() => []);
      seen.push(...cards.filter((c) => !wantedOrderNo || c.includes(wantedOrderNo)));
      const indicator = await page
        .locator('[data-testid="kds-page-indicator"]')
        .innerText()
        .catch(() => "");
      const [cur, total] = indicator.split("/").map((s) => Number(s.trim()));
      pages = Number.isFinite(total) ? total : 1;
      if (!Number.isFinite(total) || cur >= total) break;
      await page.locator('[data-testid="kds-board"]').click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(900);
    }
    console.log(
      `  /app/kitchen/${code}: badge "${count}", ${pages} page(s), ${seen.length} card(s) for ${wantedOrderNo}`,
    );
    return seen;
  }

  const defaultForOrder = await cardsForOrder(admin, "DEFAULT", orderNo);
  await shot(admin, "after-07-kitchen-DEFAULT");
  const barForOrder = await cardsForOrder(admin, "BAR", orderNo);
  await shot(admin, "after-08-kitchen-BAR");

  check(defaultForOrder.length > 0, `DEFAULT board has a card for ${orderNo}`);
  check(
    defaultForOrder.some((c) => c.includes(FOOD)),
    `that DEFAULT card carries "${FOOD}"`,
  );
  check(
    !defaultForOrder.some((c) => c.includes(DRINK)),
    `that DEFAULT card does NOT carry "${DRINK}"`,
  );
  check(barForOrder.length > 0, `BAR board has a card for ${orderNo}`);
  check(barForOrder.some((c) => c.includes(DRINK)), `that BAR card carries "${DRINK}"`);
  check(
    !barForOrder.some((c) => c.includes(FOOD)),
    `that BAR card does NOT carry "${FOOD}"`,
  );

  // ── 6. an ITEM override beats the CATEGORY route ────────────────────────────────────────
  console.log(`\n== 6. override ${OTHER_DRINK} -> GRILL from the same screen ==`);
  const overrideSelect = admin
    .locator(`[data-testid="routing-item"][data-item-name="${OTHER_DRINK}"]`)
    .locator('[data-testid="item-station-select"]');
  // pos-service is restarted by other agents in this shared tree; a 503 here is infrastructure,
  // not the feature. Reload until the row is on screen rather than filing a transient as a verdict.
  let overrideVisible = false;
  for (let attempt = 0; attempt < 6 && !overrideVisible; attempt += 1) {
    await openAndCheck(admin, "/app/menu/routing", { settle: 4000 });
    overrideVisible = await overrideSelect.isVisible().catch(() => false);
    if (!overrideVisible) {
      console.log(`  [retry ${attempt + 1}] routing screen has not rendered ${OTHER_DRINK} yet`);
      await admin.waitForTimeout(6000);
    }
  }
  check(overrideVisible, `${OTHER_DRINK} has its own station control`);
  const inheritOption = await overrideSelect
    .locator("option")
    .first()
    .innerText()
    .catch(() => "");
  check(
    /Follow category — Main bar \(BAR\)/.test(inheritOption),
    `its default option names what it inherits ("${inheritOption}")`,
  );
  await overrideSelect.selectOption({ label: "Hot line (GRILL)" });
  await admin.waitForTimeout(3500);
  await admin.reload({ waitUntil: "domcontentloaded" });
  await admin.waitForTimeout(4000);
  board = await readBoard(admin);
  const overridden = board.items.find((i) => i.name === OTHER_DRINK);
  const sibling = board.items.find((i) => i.name === DRINK);
  check(
    overridden?.effective === "GRILL" && overridden?.source === "ITEM",
    `${OTHER_DRINK} now fires to GRILL, labelled as the item's own route (was ${overridden?.effective}/${overridden?.source})`,
  );
  check(
    sibling?.effective === "BAR" && sibling?.source === "CATEGORY",
    `${DRINK} is untouched and still inherits BAR`,
  );
  check(
    BAR_LABEL.test(board.cats.find((c) => c.name === "Drinks")?.selected ?? ""),
    "the category rule itself is unchanged",
  );
  await shot(admin, "after-09-item-override-beats-category");

  // ── 6b. prove it on a real ticket, not only on the screen ────────────────────────────────
  console.log("\n== 6b. a second check proves the override on the boards ==");
  await openAndCheck(cashier, "/app/pos", { settle: 5000 });
  const clear = cashier.getByRole("button", { name: /clear \/ new order/i }).first();
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
    await cashier.waitForTimeout(2500);
  }
  await ring(cashier, OTHER_DRINK);
  const send2 = cashier.getByRole("button", { name: /send to kitchen/i }).first();
  check(await send2.isVisible().catch(() => false), '"Send to Kitchen" is available for the second check');
  await send2.click();
  await cashier.waitForTimeout(7000);
  const orderNo2 = await currentOrderNumber(cashier);
  console.log("  second check:", orderNo2);
  check(!!orderNo2 && orderNo2 !== orderNo, `the second check is a new order (${orderNo2})`);

  const grillForOrder = await cardsForOrder(admin, "GRILL", orderNo2);
  await shot(admin, "after-10-kitchen-GRILL");
  const barForOrder2 = await cardsForOrder(admin, "BAR", orderNo2);
  check(
    grillForOrder.some((c) => c.includes(OTHER_DRINK)),
    `the overridden drink "${OTHER_DRINK}" fired to the GRILL board`,
  );
  check(barForOrder2.length === 0, `that same check put nothing on BAR`);

  await cashierCtx.close();
} catch (err) {
  console.error("\nDRIVE FAILED:", err.message);
  failures.push(`exception: ${err.message}`);
  await shot(admin, "zz-proof-failure").catch(() => {});
} finally {
  await browser.close();
}

console.log("\n────────────────────────────────────────────");
if (failures.length === 0) {
  console.log("ALL CHECKS PASSED");
} else {
  console.log(`${failures.length} CHECK(S) FAILED:`);
  for (const f of failures) console.log("  ·", f);
  process.exitCode = 1;
}
console.log("BASE:", BASE);
