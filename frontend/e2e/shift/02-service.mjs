/*
 * SHIFT STEP 2 — SERVICE.
 *
 *  a. Cashier rings a DINE-IN check for a table: three different dishes, one at qty 2.
 *  b. Fires it. Records what the kitchen was told.
 *  c. Cook signs in, finds the ticket, bumps NEW -> PREPARING -> READY.
 *  d. Cashier rings a SECOND check, TAKEAWAY.
 *  e. A guest orders one more dish on table 1 after the mains were fired.
 *
 * Everything is measured off the screen the employee is looking at, and cross-read over
 * HTTP on the same persona's bearer so "the screen is lying" is distinguishable from
 * "the server never got it".
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, log, money,
} from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
if (!NEW) throw new Error("run 01c first");

const browser = await newBrowser();

async function loginNewCashier(page) {
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(NEW.email);
  await page.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error("new cashier login failed");
  log("  ✓ signed in as", NEW.email);
}

/** What the cashier can see of the cart and the panel. */
async function cartProbe(page) {
  return page.evaluate(() => {
    const lines = Array.from(
      document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]'),
    ).map((n) => n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""));
    const t = document.body.innerText;
    return {
      cartLines: lines,
      subtotal: /Subtotal\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      tax: /Tax \(est\.\)\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      total: /Total \(est\.\)\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      orderNos: Array.from(new Set(Array.from(t.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
      tileCount: document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]').length,
      itemCountLabel:
        document.querySelector('[data-testid="menu-item-count"]')?.textContent?.trim() ?? null,
    };
  });
}

const cash = await newPage(browser);
await loginNewCashier(cash);
let tr = await go(cash, "/app/pos", { waitMs: 7000 });
log("  /app/pos:", JSON.stringify(tr));

// ── 2a. DINE-IN, a table, three dishes ────────────────────────────────────────
log("\n=== 2a. dine-in check for a table ===");
const typeBtns = await cash.evaluate(() =>
  Array.from(document.querySelectorAll("[role=radio]")).map((b) => ({
    t: b.textContent.trim(),
    checked: b.getAttribute("aria-checked"),
  })),
);
log("  order type control:", JSON.stringify(typeBtns));
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(400);

// pick a table
const tableTrigger = cash.locator("[data-testid=table-select-trigger]");
log("  table picker present:", await tableTrigger.count());
if (await tableTrigger.count()) {
  await tableTrigger.click();
  await cash.waitForTimeout(1200);
  await shot(cash, "02a-table-picker");
  const opts = await cash.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
      id: n.getAttribute("data-testid"),
      t: n.innerText.replace(/\s+/g, " ").trim(),
    })),
  );
  log("  table options (first 8):", JSON.stringify(opts.slice(0, 8)));
  saveState({ tableOptions: opts.slice(0, 12) });
  const free = opts.find((o) => /AVAILABLE|Free|Open/i.test(o.t)) ?? opts[0];
  log("  choosing:", JSON.stringify(free));
  await cash.locator(`[data-testid="${free.id}"]`).click();
  await cash.waitForTimeout(900);
  saveState({ order1Table: free.t });
}
await shot(cash, "02b-table-chosen");

// three different dishes; one rung twice
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
const names = await cash.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]'))
    .slice(0, 6)
    .map((b) => b.innerText.replace(/\s+/g, " ").trim()),
);
log("  first tiles:", JSON.stringify(names));
await tiles.nth(0).click();
await cash.waitForTimeout(250);
await tiles.nth(0).click(); // qty 2
await cash.waitForTimeout(250);
await tiles.nth(1).click();
await cash.waitForTimeout(250);
await tiles.nth(2).click();
await cash.waitForTimeout(700);
const cart1 = await cartProbe(cash);
log("  cart before fire:", JSON.stringify(cart1, null, 1));
await shot(cash, "02c-order1-cart");

// Does a tap ever offer a modifier / size / note?
const modifierProbe = await cash.evaluate(() => ({
  dialogs: document.querySelectorAll("[role=dialog]").length,
  noteControls: Array.from(document.querySelectorAll("button,input,textarea"))
    .map((n) => (n.getAttribute("aria-label") || n.textContent || "").trim())
    .filter((t) => /note|modif|option|special|instruction|half|full|size/i.test(t)),
}));
log("  modifier/note surfaces after tapping a dish:", JSON.stringify(modifierProbe));

log("\n  → Send to Kitchen");
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(6000);
const after1 = await cartProbe(cash);
log("  after fire:", JSON.stringify(after1, null, 1));
await shot(cash, "02d-order1-fired");

// what does the server hold?
const list1 = await apiGet(cash, "/api/v1/pos/orders?size=5");
const rows1 = list1.body?.data ?? list1.body ?? [];
const o1 = Array.isArray(rows1) ? rows1[0] : null;
log("  newest order on the server:", JSON.stringify(o1)?.slice(0, 700));
saveState({ order1: o1 });

// ── 2c. the cook ──────────────────────────────────────────────────────────────
log("\n=== 2c. the cook works the ticket ===");
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
tr = await go(kds, "/app/kitchen", { waitMs: 5000 });
log("  /app/kitchen:", JSON.stringify(tr));
await shot(kds, "02e-kitchen-station-picker");
const stations = await kds.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 600),
  links: Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href")).filter((h) => h?.includes("kitchen")),
}));
log("  stations:", JSON.stringify(stations, null, 1));
saveState({ kitchenStations: stations.links });

tr = await go(kds, "/app/kitchen/DEFAULT", { waitMs: 7000 });
log("  /app/kitchen/DEFAULT:", JSON.stringify(tr));
await shot(kds, "02f-kds-default-board");

const orderNo1 = o1?.orderNo ?? after1.orderNos[0] ?? null;
log("  looking for", orderNo1, "on DEFAULT");
let board = await kds.evaluate((wanted) => {
  const t = document.body.innerText;
  return {
    hasMine: wanted ? t.includes(wanted) : null,
    pageInfo: /Page \d+ of \d+/.exec(t)?.[0] ?? null,
    heads: Array.from(document.querySelectorAll("h1,h2,h3")).map((n) => n.textContent.trim()).slice(0, 8),
    first600: t.replace(/\s+/g, " ").slice(0, 600),
  };
}, orderNo1);
log("  board:", JSON.stringify(board, null, 1));
saveState({ order1No: orderNo1, kdsBoardFirstLook: board });

await browser.close();
log("\nstep 2 (part 1) done");
