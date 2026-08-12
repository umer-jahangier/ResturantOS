/*
 * F18 step 1 — THE FAILURE, reproduced.
 *
 * Ring one check whose lines route to two different stations, finish one station's work,
 * and then look everywhere a cook can look for something that says the TABLE is half-ready.
 *
 * Writes the order number to _f18.json so the "after" run works the same check.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, apiSend, log, OUT } from "./lib.mjs";

const STATE = resolve(OUT, "_f18.json");
const browser = await newBrowser();

// ── the cashier rings a split check ───────────────────────────────────────────
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
let tr = await go(cash, "/app/pos", { waitMs: 8000 });
log("/app/pos:", JSON.stringify(tr));

await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(500);
const tableTrigger = cash.locator("[data-testid=table-select-trigger]");
if (await tableTrigger.count()) {
  await tableTrigger.click();
  await cash.waitForTimeout(1200);
  const opts = await cash.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
      id: n.getAttribute("data-testid"),
      t: n.innerText.replace(/\s+/g, " ").trim(),
      disabled: n.getAttribute("aria-disabled") === "true",
    })),
  );
  log("table options:", JSON.stringify(opts.slice(0, 10)));
  const free = opts.find((o) => !o.disabled);
  log("table:", JSON.stringify(free));
  if (free) {
    await cash.locator(`[data-testid="${free.id}"]`).click();
    await cash.waitForTimeout(900);
  } else {
    await cash.keyboard.press("Escape");
    await cash.waitForTimeout(500);
  }
}

/**
 * A dish tile may now open a MODIFIER dialog (another agent's in-flight work landed mid-run
 * and this harness broke on it: the dialog's overlay intercepted the next tile's click).
 * Confirm it if it appears, so the harness rings a check rather than dying on someone else's
 * new screen.
 */
async function clearModifierDialog(page) {
  const dialog = page.locator('[data-testid="modifier-dialog"]');
  if ((await dialog.count()) === 0) return;
  if (!(await dialog.first().isVisible().catch(() => false))) return;
  const add = page.locator('[data-testid="modifier-dialog-add"]').first();
  // A FORCED group leaves "Add to order" disabled until something is chosen. Pick options,
  // one at a time, until it enables — the dialog itself decides when the line is legal.
  const options = dialog.locator('[data-testid^="modifier-option-"]');
  const n = await options.count();
  for (let i = 0; i < n; i += 1) {
    if (await add.isEnabled().catch(() => false)) break;
    await options.nth(i).click().catch(() => {});
    await page.waitForTimeout(350);
  }
  if (await add.isEnabled().catch(() => false)) {
    await add.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(1000);
}

/** Tap a menu tile by its visible name — no search box, the whole grid renders. */
async function tapDish(page, name) {
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30000 });
  const tile = tiles.filter({ hasText: name });
  const n = await tile.count();
  log(`  tile "${name}" matches: ${n} (grid has ${await tiles.count()})`);
  if (n === 0) throw new Error(`no tile for ${name}`);
  await tile.first().scrollIntoViewIfNeeded();
  await tile.first().click();
  await page.waitForTimeout(700);
  await clearModifierDialog(page);
}

// "Audit Item 52235" has no kdsStation -> DEFAULT.  "Butter Naan" carries kdsStation=GRILL.
await tapDish(cash, "Audit Item 52235");
await tapDish(cash, "Butter Naan");
await shot(cash, "01a-cart-split-check");

await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(7000);
await shot(cash, "01b-fired");

// The order number is read off the DRAWER the cashier is looking at — the same string the
// employee sees — and everything downstream is keyed off it.
const orderNo = await cash.evaluate(
  () => /ORD-\d{8}-\d+/.exec(document.body.innerText)?.[0] ?? null,
);
log("→ ORDER (from the drawer):", orderNo);
if (!orderNo) throw new Error("could not read the order number off the screen");

/** branch_id, straight off the signed-in persona's own verified token. */
async function branchOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json();
    const token = j?.accessToken ?? j?.data?.accessToken;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.branch_id;
  });
}
const branchId = await branchOf(cash);
log("branch:", branchId);

// ── what the kitchen was told ────────────────────────────────────────────────
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);

tr = await go(kds, "/app/kitchen", { waitMs: 6000 });
log("/app/kitchen:", JSON.stringify(tr));
await shot(kds, "01c-picker");

const tickets = await apiGet(
  kds,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`,
);
const orderId = (tickets.body?.content ?? []).find((t) => t.orderNo === orderNo)?.orderId;
if (!orderId) throw new Error(`no KDS ticket carries ${orderNo}`);
log("orderId:", orderId);
const mine = (tickets.body?.content ?? []).filter((t) => t.orderId === orderId);
log(
  "\nthe check on the KDS, station by station:",
  JSON.stringify(
    mine.map((t) => ({
      station: t.stationCode,
      status: t.status,
      items: t.items.map((i) => `${i.qty}x ${i.name} [${i.status}]`),
    })),
    null,
    1,
  ),
);
writeFileSync(STATE, JSON.stringify({ orderNo, orderId, branchId, tickets: mine }, null, 2));

// ── one station finishes; the other has not started ──────────────────────────
const doneStation = mine.find((t) => t.stationCode === "GRILL") ?? mine[0];
log(`\nfinishing every item at ${doneStation.stationCode} …`);
for (const item of doneStation.items) {
  for (const next of ["ACCEPTED", "PREPARING", "READY"]) {
    const r = await apiSend(
      kds,
      "POST",
      `/api/v1/kitchen/kds/tickets/${doneStation.id}/items/${item.id}/status?branchId=${branchId}`,
      { status: next },
    );
    if (r.status !== 200) log("   !", next, r.status, JSON.stringify(r.body).slice(0, 200));
  }
}
log("  done.");

const after = await apiGet(
  kds,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&status=PENDING,COOKING,READY&size=500`,
);
const mine2 = (after.body?.content ?? []).filter((t) => t.orderId === orderId);
log(
  "\nnow:",
  JSON.stringify(
    mine2.map((t) => ({
      station: t.stationCode,
      status: t.status,
      items: t.items.map((i) => `${i.qty}x ${i.name} [${i.status}]`),
    })),
    null,
    1,
  ),
);

// ── where can a cook see that this TABLE is half ready? ──────────────────────
for (const [route, name] of [
  ["/app/kitchen", "01d-picker-half-ready"],
  [`/app/kitchen/${doneStation.stationCode}`, "01e-finished-station"],
  [`/app/kitchen/${mine2.find((t) => t.id !== doneStation.id)?.stationCode ?? "DEFAULT"}`, "01f-owing-station"],
]) {
  await go(kds, route, { waitMs: 6000 });
  await shot(kds, name);
  const probe = await kds.evaluate((wanted) => {
    const t = document.body.innerText;
    return {
      mentionsOrder: t.includes(wanted),
      mentionsExpoOrPass: /\bexpo\b|\bthe pass\b|ready to run/i.test(t),
      // Does anything on this screen name BOTH stations of the split check?
      namesBothStations: /GRILL/.test(t) && /DEFAULT/.test(t),
    };
  }, orderNo);
  log(`  ${route} →`, JSON.stringify(probe));
}

await browser.close();
log("\nBEFORE captured.");
