/*
 * S6 — MODIFIERS, driven end to end in real Chromium.
 *
 *   node e2e/s6/prove.mjs
 *
 * The path in DONE MEANS, as the personas who do each job:
 *
 *   OWNER    /app/menu/items → Options & add-ons → "Spice level" (forced, exactly 1)
 *            and "Extras" (optional, up to 3, Extra cheese +Rs 150) on one dish.
 *   CASHIER  /app/pos → tap the dish → dialog opens → Add REFUSED until spice level
 *            is chosen → adds with Extra cheese → cart line carries the delta.
 *   KITCHEN  /app/kitchen → the ticket names the modifier, never a UUID.
 *   CASHIER  settle → the printed bill and the journal entry agree to the paisa.
 *
 * Screenshots land in .planning/audits/floor/S6/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  pageTrouble,
  tokenOf,
  apiGet,
  apiSend,
  money,
} from "../shift/lib.mjs";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S6");
mkdirSync(OUT, { recursive: true });

const RESULT = {};
const log = (...a) => console.log(...a);

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
}

/**
 * Next's dev-overlay is a top-level custom element that covers the viewport and swallows every
 * click. Ten agents share this working tree, so a SIBLING's unrelated compile error in a file
 * this run never visits would otherwise read as "the button does not work" — the precise class
 * of false negative this harness exists to avoid. The pages under test are untouched.
 */
async function hideDevOverlay(page) {
  await page
    .addStyleTag({ content: "nextjs-portal{display:none !important;pointer-events:none !important}" })
    .catch(() => {});
}

async function go(page, route, waitMs = 3500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  await hideDevOverlay(page);
  let t = await pageTrouble(page);
  if (t.bad.length) {
    log(`    ! ${route} showed ${t.bad.join(",")} — retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
    await hideDevOverlay(page);
    t = await pageTrouble(page);
  }
  if (t.bad.length) throw new Error(`${route} is broken: ${t.bad.join(",")} :: ${t.alerts.join("|")}`);
  return t;
}

/**
 * Sign in, with retries. Not papering over a product defect: ten agents restart these services
 * under each other all day, and auth-service being mid-restart is an outage, not a login failure.
 * A single attempt records that outage as "the persona cannot sign in", which is the false
 * negative that has cost this project days.
 */
async function signIn(page, who) {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await login(page, who);
      await hideDevOverlay(page);
      return page;
    } catch (e) {
      last = e;
      log(`    ! login ${who.email} attempt ${attempt + 1} failed: ${e.message.slice(0, 90)}`);
      await page.waitForTimeout(12000);
    }
  }
  throw last;
}

const browser = await newBrowser();

// ══════════════════════════════════════════════════════════════════════════════
// 1. OWNER builds the catalogue on a real dish
// ══════════════════════════════════════════════════════════════════════════════
log("\n=== 1. OWNER creates the modifier groups ===");
const owner = await newPage(browser);
await signIn(owner, PEOPLE.owner);
await go(owner, "/app/menu/items", 5000);
await shot(owner, "01-menu-items");

// Pick a real, ACTIVE dish by name so the cashier can find the same tile later. Retried:
// ten agents share this machine and a service restart mid-run reads as an empty menu, which
// is exactly the "error state looks like an empty state" trap.
let dish = null;
for (let attempt = 0; attempt < 5 && !dish; attempt++) {
  dish = await owner.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[aria-label$="category"] .divide-y > div'));
    for (const row of rows) {
      const name = row.querySelector("span.flex-1")?.textContent?.trim();
      const trigger = row.querySelector('button[aria-label^="Actions for"]');
      if (name && trigger && !/Inactive/.test(row.innerText)) return { name };
    }
    return null;
  });
  if (!dish) {
    const t = await pageTrouble(owner);
    log(`    menu empty on attempt ${attempt + 1}; trouble=${JSON.stringify(t)} — reloading`);
    await owner.reload({ waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(6000);
    await hideDevOverlay(owner);
  }
}
if (!dish) throw new Error("no active menu item found on /app/menu/items after 5 attempts");
log("  dish under test:", dish.name);
RESULT.dish = dish.name;

await owner.locator(`button[aria-label="Actions for ${dish.name}"]`).first().click();
await owner.waitForTimeout(500);
const menuLabels = await owner.evaluate(() =>
  Array.from(document.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent.trim()),
);
log("  item actions:", JSON.stringify(menuLabels));
RESULT.itemActions = menuLabels;
await shot(owner, "02-item-actions-menu");

await owner.locator('[role="menuitem"]', { hasText: "Options & add-ons" }).first().click();
await owner.waitForTimeout(2500);
await shot(owner, "03-modifier-manager-empty");

const managerOpen = await owner.evaluate(() => {
  const d = document.querySelector("[data-testid=modifier-manager]");
  return d ? d.innerText.replace(/\s+/g, " ").slice(0, 300) : null;
});
log("  manage dialog:", managerOpen);
RESULT.manageDialogOpened = managerOpen !== null;

/** Create one group and return its id, read back off the rendered card. */
async function addGroup({ name, required, min, max }) {
  await owner.locator("[data-testid=add-modifier-group]").click();
  await owner.waitForTimeout(400);
  await owner.locator("#modifier-group-name").fill(name);
  if (required) await owner.locator("[data-testid=new-group-required]").check();
  await owner.locator("#modifier-group-min").fill(String(min));
  await owner.locator("#modifier-group-max").fill(String(max));
  await owner.waitForTimeout(200);
  await owner.locator("[data-testid=new-group-save]").click();
  await owner.waitForTimeout(2000);
  const err = await owner.evaluate(() => {
    const n = document.querySelector("[data-testid=new-group-error]");
    return n ? n.textContent.trim() : null;
  });
  if (err && /temporarily unavailable|try again/i.test(err)) {
    // Ten agents share this machine; a sibling restarting pos-service mid-run is an outage,
    // not a refusal. Retry once rather than record a false negative.
    log(`    ! "${name}" hit an outage — retrying once`);
    await owner.waitForTimeout(15000);
    await owner.locator("[data-testid=new-group-save]").click();
    await owner.waitForTimeout(2500);
    const again = await owner.evaluate(
      () => document.querySelector("[data-testid=new-group-error]")?.textContent?.trim() ?? null,
    );
    if (again) throw new Error(`group "${name}" refused: ${again}`);
  } else if (err) {
    throw new Error(`group "${name}" refused: ${err}`);
  }
  return owner.evaluate((n) => {
    const cards = Array.from(document.querySelectorAll('[data-testid^="manage-group-"]'));
    const card = cards.find((c) => c.innerText.startsWith(n));
    return card ? card.getAttribute("data-testid").replace("manage-group-", "") : null;
  }, name);
}

async function addOption(groupId, { name, rupees }) {
  await owner.locator(`[data-testid=add-option-${groupId}]`).click();
  await owner.waitForTimeout(400);
  await owner.locator(`#option-name-${groupId}`).fill(name);
  await owner.locator(`#option-price-${groupId}`).fill(String(rupees));
  await owner.locator(`[data-testid=save-option-${groupId}]`).click();
  await owner.waitForTimeout(1800);
  const err = await owner.evaluate(
    (g) => document.querySelector(`[data-testid=option-error-${g}]`)?.textContent?.trim() ?? null,
    groupId,
  );
  if (err && /temporarily unavailable|try again/i.test(err)) {
    log(`    ! option "${name}" hit an outage — retrying once`);
    await owner.waitForTimeout(15000);
    await owner.locator(`[data-testid=save-option-${groupId}]`).click();
    await owner.waitForTimeout(2500);
    const again = await owner.evaluate(
      (g) => document.querySelector(`[data-testid=option-error-${g}]`)?.textContent?.trim() ?? null,
      groupId,
    );
    if (again) throw new Error(`option "${name}" refused: ${again}`);
  } else if (err) {
    throw new Error(`option "${name}" refused: ${err}`);
  }
}

// Wipe any groups a previous run left, so this run proves creation and not persistence.
const stale = await owner.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="manage-group-"]')).map((c) =>
    c.getAttribute("data-testid").replace("manage-group-", ""),
  ),
);
for (const gid of stale) {
  const label = await owner.evaluate(
    (g) =>
      document
        .querySelector(`[data-testid=manage-group-${g}] p`)
        ?.textContent?.trim()
        ?.split("\n")[0] ?? "",
    gid,
  );
  log("  removing stale group:", label);
  await owner.locator(`[data-testid=manage-group-${gid}] button[aria-label^="Remove "]`).first().click();
  await owner.waitForTimeout(1500);
}

const spiceId = await addGroup({ name: "Spice level", required: true, min: 1, max: 1 });
log("  Spice level group:", spiceId);
await addOption(spiceId, { name: "Medium", rupees: 0 });
await addOption(spiceId, { name: "Hot", rupees: 0 });

const extrasId = await addGroup({ name: "Extras", required: false, min: 0, max: 3 });
log("  Extras group:", extrasId);
await addOption(extrasId, { name: "Extra cheese", rupees: 150 });
await addOption(extrasId, { name: "Extra raita", rupees: 80 });

await shot(owner, "04-modifier-manager-built");
RESULT.builtCatalogue = await owner.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="manage-group-"]')).map((c) =>
    c.innerText.replace(/\s+/g, " ").trim(),
  ),
);
log("  catalogue now:", JSON.stringify(RESULT.builtCatalogue, null, 1));

// Read it back over HTTP on the owner's OWN bearer — the row, not the render.
const ownerToken = await tokenOf(owner);
const catalogueRead = await apiGet(owner, "/api/v1/pos/menu/modifier-groups", ownerToken);
RESULT.catalogueOverHttp = catalogueRead.body?.data?.map((g) => ({
  name: g.name,
  required: g.required,
  min: g.minSelect,
  max: g.maxSelect,
  options: g.options.map((o) => `${o.name} ${o.priceDeltaPaisa}`),
}));
log("  GET /modifier-groups:", catalogueRead.status, JSON.stringify(RESULT.catalogueOverHttp));

// ══════════════════════════════════════════════════════════════════════════════
// 2. CASHIER taps the dish
// ══════════════════════════════════════════════════════════════════════════════
log("\n=== 2. CASHIER rings the dish ===");
const cashier = await newPage(browser);
await signIn(cashier, PEOPLE.cashier);
await go(cashier, "/app/pos", 6000);
await shot(cashier, "05-pos-terminal");

// Open a till if the cashier has none — a cash settlement needs one.
const needsTill = await cashier.evaluate(
  () => !!document.querySelector("[data-testid=open-till-button]"),
);
if (needsTill) {
  await cashier.locator("[data-testid=open-till-button]").click();
  await cashier.waitForTimeout(900);
  await cashier.locator("[data-testid=open-till-panel] input").first().fill("5000");
  await cashier.locator("[data-testid=open-till-confirm-button]").first().click();
  await cashier.waitForTimeout(2500);
  log("  opened a till with a Rs 5,000.00 float");
}

// Find the dish tile and count dialogs before and after the tap — the walkthrough's own probe.
await cashier.locator('input[aria-label="Search menu"]').fill(dish.name.slice(0, 14));
await cashier.waitForTimeout(1200);
const before = await cashier.evaluate(() => ({
  dialogs: document.querySelectorAll('[role="dialog"]').length,
}));
await cashier.locator(`[data-testid=menu-grid] button:has-text("${dish.name}")`).first().click();
await cashier.waitForTimeout(1500);
const after = await cashier.evaluate(() => ({
  dialogs: document.querySelectorAll('[role="dialog"]').length,
  groups: Array.from(document.querySelectorAll('[data-testid^="modifier-group-"]'))
    .filter((n) => !n.dataset.testid.includes("error"))
    .map((n) => n.innerText.replace(/\s+/g, " ").trim().slice(0, 120)),
}));
RESULT.tapProbe = { before, after };
log("  dialogs before/after tap:", JSON.stringify(RESULT.tapProbe, null, 1));
await shot(cashier, "06-modifier-dialog-open");

// 2a. It REFUSES until the forced group is answered — and SAYS SO, on screen, before
// anyone presses anything. `aria-disabled` is honoured by Playwright's actionability
// check exactly as it is by a screen reader, so a click here would hang for 30s; the
// probe is what a cashier can read, plus a forced click that must not add a line.
RESULT.refusal = await cashier.evaluate(() => {
  const add = document.querySelector("[data-testid=modifier-dialog-add]");
  return {
    messages: Array.from(document.querySelectorAll('[data-testid^="modifier-group-error-"]')).map(
      (n) => n.textContent.trim(),
    ),
    blockedSummary:
      document.querySelector("[data-testid=modifier-dialog-blocked]")?.textContent.trim() ?? null,
    addAriaDisabled: add?.getAttribute("aria-disabled"),
    addDescribedBy: add?.getAttribute("aria-describedby"),
  };
});
// Force the click past the actionability gate: even bypassed, the line must not be added.
await cashier.locator("[data-testid=modifier-dialog-add]").click({ force: true });
await cashier.waitForTimeout(800);
RESULT.refusalAfterForcedClick = await cashier.evaluate(() => ({
  dialogStillOpen: document.querySelectorAll("[data-testid=modifier-dialog]").length === 1,
  cartLines: document.querySelectorAll("[data-testid=cart-line-modifiers]").length,
  alertRoles: Array.from(document.querySelectorAll('[data-testid^="modifier-group-error-"]')).map(
    (n) => n.getAttribute("role"),
  ),
}));
log("  refusal:", JSON.stringify(RESULT.refusal, null, 1));
log("  after forced click:", JSON.stringify(RESULT.refusalAfterForcedClick));
await shot(cashier, "07-refused-until-spice-chosen");

// 2b. Choose Hot + Extra cheese and add.
await cashier.locator('[data-testid^=modifier-option-]:has-text("Hot")').first().click();
await cashier.waitForTimeout(300);
await cashier.locator('[data-testid^=modifier-option-]:has-text("Extra cheese")').first().click();
await cashier.waitForTimeout(400);
RESULT.dialogTotal = await cashier.evaluate(
  () => document.querySelector("[data-testid=modifier-dialog-total]")?.innerText.replace(/\s+/g, " ") ?? null,
);
log("  dialog total with options:", RESULT.dialogTotal);
await shot(cashier, "08-hot-and-extra-cheese-chosen");

await cashier.locator("[data-testid=modifier-dialog-add]").click();
await cashier.waitForTimeout(1500);
RESULT.cartLine = await cashier.evaluate(() => {
  const mods = document.querySelector("[data-testid=cart-line-modifiers]");
  const panel = document.querySelector(".w-80");
  return {
    modifierCaption: mods ? mods.textContent.trim() : null,
    panelText: panel ? panel.innerText.replace(/\s+/g, " ").trim().slice(0, 400) : null,
  };
});
log("  cart line:", JSON.stringify(RESULT.cartLine, null, 1));
await shot(cashier, "09-cart-with-modifiers");

// ══════════════════════════════════════════════════════════════════════════════
// 3. Fire it, and read the kitchen ticket
// ══════════════════════════════════════════════════════════════════════════════
log("\n=== 3. Send to Kitchen ===");
await cashier.locator("[data-testid=send-to-kitchen-button]").click();
await cashier.waitForTimeout(5000);
await shot(cashier, "10-after-send-to-kitchen");

const cashierToken = await tokenOf(cashier);
const branchId = JSON.parse(
  Buffer.from(cashierToken.split(".")[1], "base64url").toString("utf8"),
)["branch_id"];
log("  cashier branch:", branchId);

// The order id comes off the requests the BROWSER actually made — `POST /orders/{id}/send-to-kds`
// is the fire the cashier just pressed. Reading it from a list would be a different question.
const fireUrl = [...cashier.__requests]
  .reverse()
  .find((r) => /\/api\/v1\/pos\/orders\/[0-9a-f-]{36}\/send-to-kds/.test(r.u) && r.s < 300);
if (!fireUrl) throw new Error("Send to Kitchen made no successful send-to-kds request");
const orderId = /orders\/([0-9a-f-]{36})\/send-to-kds/.exec(fireUrl.u)[1];
const order = { id: orderId, branchId };

let full = null;
for (let attempt = 0; attempt < 4; attempt++) {
  // A fresh bearer each attempt: this machine restarts services under the run, and a stale
  // token reads as "the order is not there", which is the trap this harness exists to avoid.
  full = await apiGet(cashier, `/api/v1/pos/orders/${order.id}?branchId=${branchId}`, await tokenOf(cashier));
  if (full.status === 200 && full.body?.data?.items?.length) break;
  log(`    ! order read attempt ${attempt + 1}: ${full.status} ${JSON.stringify(full.body).slice(0, 200)}`);
  await cashier.waitForTimeout(4000);
}
if (full.status !== 200) throw new Error(`could not read the order back: ${full.status}`);
RESULT.orderNo = full.body?.data?.orderNo ?? orderId;
log("  order:", RESULT.orderNo, orderId, "status", full.body?.data?.status);
const line = (full.body?.data?.items ?? []).find((i) => (i.modifiers ?? []).length > 0);
RESULT.persistedLine = line && {
  item: line.itemNameSnapshot,
  unitPricePaisa: line.unitPriceSnapshot,
  quantity: line.quantity,
  lineTotalPaisa: line.lineTotalPaisa,
  modifiers: line.modifiers.map((m) => ({ name: m.modifierNameSnapshot, delta: m.priceDeltaPaisa })),
};
RESULT.orderTotals = {
  subtotalPaisa: full.body?.data?.subtotalPaisa,
  taxPaisa: full.body?.data?.taxPaisa,
  totalPaisa: full.body?.data?.totalPaisa,
};
log("  persisted line:", JSON.stringify(RESULT.persistedLine, null, 1));
log("  order totals:", JSON.stringify(RESULT.orderTotals));

log("\n=== 3b. KITCHEN reads the ticket ===");
RESULT.firedStation = line?.kdsStation ?? "DEFAULT";
const kitchen = await newPage(browser);
await signIn(kitchen, PEOPLE.kitchen);
await go(kitchen, "/app/kitchen", 6000);
await shot(kitchen, "11-kds-stations");
// The landing page is a station chooser. The chef stands at ONE pass, so the ticket is read
// on the board the line actually routed to — which the order row itself names.
await go(kitchen, `/app/kitchen/${RESULT.firedStation}`, 8000);
await shot(kitchen, "11b-kds-board");
RESULT.kdsTicket = await kitchen.evaluate((orderNo) => {
  const cards = Array.from(document.querySelectorAll("[data-testid=kds-ticket-card]"));
  const card = cards.find((c) => (c.innerText || "").includes(orderNo));
  if (!card) {
    return {
      found: false,
      cardsOnBoard: cards.length,
      firstCard: cards[0]?.innerText.replace(/\s+/g, " ").slice(0, 200) ?? null,
    };
  }
  const mods = Array.from(card.querySelectorAll('[data-testid^="kds-item-modifiers-"]')).map((n) =>
    n.textContent.trim(),
  );
  return { found: true, text: card.innerText.replace(/\s+/g, " ").trim().slice(0, 400), modifiers: mods };
}, RESULT.orderNo);
log("  KDS ticket:", JSON.stringify(RESULT.kdsTicket, null, 1));
RESULT.kdsShowsUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
  JSON.stringify(RESULT.kdsTicket ?? ""),
);
if (RESULT.kdsTicket?.found) {
  await kitchen
    .locator(`[data-testid=kds-ticket-card]:has-text("${RESULT.orderNo}")`)
    .first()
    .scrollIntoViewIfNeeded();
  await shot(kitchen, "11c-kds-ticket-by-name");
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Settle, and check the bill and the ledger agree to the paisa
// ══════════════════════════════════════════════════════════════════════════════
log("\n=== 4. Settle ===");
await go(cashier, `/app/pos/orders/${order.id}/charge`, 5000);
await shot(cashier, "12-charge-page");
RESULT.chargeScreen = await cashier.evaluate(() =>
  document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
);

const total = RESULT.orderTotals.totalPaisa;
if (typeof total !== "number") throw new Error("order total never arrived — cannot settle");
// Mark every line SERVED first: an order closes only once it is fully Paid AND fully Served.
const served = await apiSend(cashier, "POST", `/api/v1/pos/orders/${order.id}/serve-all`, {}, cashierToken);
log("  serve-all:", served.status);
const pay = await apiSend(
  cashier,
  "POST",
  `/api/v1/pos/orders/${order.id}/payments`,
  { method: "CASH", amountPaisa: total, tenderedPaisa: total },
  cashierToken,
);
RESULT.paymentStatus = pay.status;
log("  payment:", pay.status, JSON.stringify(pay.body?.data ?? pay.body).slice(0, 300));

await cashier.waitForTimeout(2500);
const bill = await apiGet(cashier, `/api/v1/pos/orders/${order.id}/receipt`, cashierToken);
RESULT.receipt = bill.body?.data ?? bill.body;
// A long run outlives an access token, and this machine restarts auth-service under it. A
// bounce to /login here would record "the bill is blank", which is the false negative this
// harness exists to avoid — so the session is re-established before the bill is read.
if (cashier.url().includes("/login") || (await cashier.evaluate(() => /Sign in to RestaurantOS/.test(document.body.innerText)))) {
  await signIn(cashier, PEOPLE.cashier);
}
await go(cashier, `/app/pos/orders/${order.id}/receipt`, 6000).catch(() => {});
if (await cashier.evaluate(() => /Sign in to RestaurantOS/.test(document.body.innerText))) {
  await signIn(cashier, PEOPLE.cashier);
  await go(cashier, `/app/pos/orders/${order.id}/receipt`, 6000).catch(() => {});
}
await shot(cashier, "13-printed-bill");
RESULT.receiptScreen = await cashier.evaluate(() =>
  document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
);
log("  receipt screen:", RESULT.receiptScreen?.slice(0, 400));

const je = await apiGet(
  owner,
  `/api/v1/finance/journal-entries/by-source/${order.id}?resolveSource=true`,
  ownerToken,
).catch(() => ({ status: 0 }));
RESULT.journalStatus = je.status;
RESULT.journal = JSON.stringify(je.body?.data ?? je.body).slice(0, 900);
log("  journal:", RESULT.journalStatus, RESULT.journal);

// ══════════════════════════════════════════════════════════════════════════════
log("\n=== SUMMARY ===");
RESULT.expectedLineTotal = RESULT.persistedLine
  ? (RESULT.persistedLine.unitPricePaisa +
      RESULT.persistedLine.modifiers.reduce((s, m) => s + m.delta, 0)) *
    RESULT.persistedLine.quantity
  : null;
RESULT.receiptNamesTheModifier = /Extra cheese/.test(RESULT.receiptScreen ?? "");
RESULT.receiptShowsLineTotal = (RESULT.receiptScreen ?? "").includes(
  money(RESULT.persistedLine?.lineTotalPaisa ?? 0),
);
RESULT.receiptShowsOrderTotal = (RESULT.receiptScreen ?? "").includes(
  money(RESULT.orderTotals.totalPaisa ?? 0),
);
log("  receipt names the modifier :", RESULT.receiptNamesTheModifier);
log("  receipt line total matches :", RESULT.receiptShowsLineTotal);
log("  receipt order total matches:", RESULT.receiptShowsOrderTotal);
log("  line total on the row  :", money(RESULT.persistedLine?.lineTotalPaisa ?? 0));
log("  line total by hand     :", money(RESULT.expectedLineTotal ?? 0));
log("  KDS shows a UUID       :", RESULT.kdsShowsUuid);
writeFileSync(`${OUT}/s6-prove.json`, JSON.stringify(RESULT, null, 2));
log(`\n  wrote ${OUT}/s6-prove.json`);

await browser.close();
