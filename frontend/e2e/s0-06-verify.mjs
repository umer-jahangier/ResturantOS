// S0-06 verification: a paid order MUST reach a terminal state.
//
// Drives the exact DONE-MEANS click path in real Chromium as the cashier:
//   /app/pos -> ring 2 items -> Send to Kitchen -> Charge Now -> full CASH
//   -> "Mark served & close order" (the only new control) -> back to Order Management
//   -> open the order and read what the drawer offers.
//
// Then re-opens the SAME order as the manager, because the cashier's live JWT does not
// carry `pos.order.refund` (it carries 11 pos.* codes; refund is not one) — so "Refund
// order IS offered" is a manager-persona assertion, not a cashier one. Widening the
// cashier's permission to make a button appear is exactly what the brief forbids.
//
//   node e2e/s0-06-verify.mjs after dinein|takeaway
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "after";
const MODE = process.argv[3] ?? "dinein";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-06", `${LABEL}-${MODE}`);
const BASE = "http://localhost:3000";
const SLUG = "floating-terrace";
const CASHIER = { slug: SLUG, email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: SLUG, email: "manager@terrace.local", password: "Terrace#Manager1" };

mkdirSync(OUT, { recursive: true });
const log = [];
function say(...parts) {
  const line = parts.join(" ");
  console.log(line);
  log.push(line);
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  say("  [shot]", `${name}.png`);
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  say(`login ${who.email} ->`, page.url());
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

/** Guards against auditing a page mid-failure (the trap that cost six routes once). */
async function assertNoErrorState(page, where) {
  const alerts = (await page.locator('[role="alert"]').allInnerTexts())
    .map((t) => t.trim())
    .filter(Boolean);
  const body = await page.locator("body").innerText();
  const broken = /Couldn't load|Failed to load|SERVICE_UNAVAILABLE|Something went wrong/i.test(body);
  if (alerts.length || broken) {
    say(`!! ERROR STATE on ${where}: alerts=${JSON.stringify(alerts)} brokenCopy=${broken}`);
    return false;
  }
  return true;
}

async function openOrderManagement(page) {
  await page.getByRole("button", { name: "Order Management", exact: true }).first().click();
  await page.waitForTimeout(2500);
}

async function readDrawer(page, orderId, who) {
  const row = page.locator(`[data-testid="open-order-${orderId}"]`).first();
  await row.waitFor({ timeout: 20000 });
  await row.click();
  await page.waitForTimeout(3000);

  const dialog = page.locator('[role="dialog"]').first();
  const text = (await dialog.innerText().catch(() => "")).replace(/\n+/g, " | ");
  const voidBtn = await page.getByRole("button", { name: /^Void order$/i }).count();
  const refundBtn = await page.getByRole("button", { name: /^Refund order$/i }).count();
  const chargeBtn = await page.locator('[data-testid="charge-now-button"]').count();
  const paidChip = await page.locator('[data-testid="paid-chip"]').count();
  say(`--- drawer as ${who} ---`);
  say(text.slice(0, 900));
  say(`VERDICT(${who}): voidOrder=${voidBtn} refundOrder=${refundBtn} chargeNow=${chargeBtn} paidChip=${paidChip}`);
  return { text, voidBtn, refundBtn, chargeBtn, paidChip };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/pos/orders"))
      api.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
  });

  let orderId = null;
  let orderNo = null;
  try {
    await login(page, CASHIER);
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await assertNoErrorState(page, "/app/pos");
    await shot(page, "01-pos-terminal");

    if (MODE === "takeaway") {
      await page.locator('[data-testid="order-type-takeaway"]').first().click();
      await page.waitForTimeout(600);
      say("order type: TAKEAWAY (no table)");
    } else {
      const trigger = page.locator('[data-testid="table-select-trigger"]').first();
      await trigger.click();
      await page.waitForTimeout(700);
      const opts = page.locator('[data-testid^="table-option-"] button:not([disabled])');
      say("selectable tables:", await opts.count());
      await opts.first().click();
      await page.waitForTimeout(700);
      say("table selected:", (await trigger.innerText()).trim());
    }

    // Ring two items — address tiles by name; the index shifts once a tile is selected.
    const grid = page.locator('[data-testid="menu-grid"]');
    await grid.waitFor({ timeout: 15000 });
    const names = (await grid.locator("> div > button").allInnerTexts())
      .slice(0, 2)
      .map((t) => t.split("\n")[0].trim());
    say("ringing:", JSON.stringify(names));
    for (const n of names) {
      await grid.locator("> div > button", { hasText: n }).first().click();
      await page.waitForTimeout(500);
    }
    await shot(page, "02-cart-two-items");

    await page.locator('[data-testid="send-to-kitchen-button"]').first().click();
    await page.waitForTimeout(5000);
    await shot(page, "03-after-send-to-kitchen");

    await page.locator('[data-testid="charge-now-button"]').first().click();
    await page.waitForTimeout(3500);
    orderId = page.url().match(/orders\/([0-9a-f-]{36})\/charge/)?.[1] ?? null;
    say("charge url:", page.url());
    say("orderId:", orderId);
    orderNo = (await page.locator("h1").first().innerText()).trim();
    say("orderNo:", orderNo);
    await shot(page, "04-charge-page");

    await page.locator('[data-testid="fill-full-amount-button"]').first().click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid="record-payment-button"]').first().click();
    await page.waitForTimeout(6000);
    await shot(page, "05-after-full-cash");

    const buttonsAfterPay = (await page.getByRole("button").allInnerTexts())
      .map((s) => s.trim())
      .filter(Boolean);
    say("buttons on charge page after full payment:", JSON.stringify(buttonsAfterPay));

    // ── the new control ────────────────────────────────────────────────────
    const closeBtn = page.locator('[data-testid="close-order-button"]');
    say("close-order-button present:", await closeBtn.count());
    if ((await closeBtn.count()) === 0) throw new Error("no close control on the settlement screen");
    say("close-order-button label:", (await closeBtn.first().innerText()).trim());
    say("close-order-button enabled:", await closeBtn.first().isEnabled());
    await closeBtn.first().click();
    await page.waitForTimeout(6000);
    await shot(page, "06-after-close");

    const closedChip = await page.locator('[data-testid="charge-closed-chip"]').count();
    const closeErr = await page.locator('[data-testid="close-order-error"]').allInnerTexts();
    say("charge page after close: closedChip=", closedChip, "errors=", JSON.stringify(closeErr));
    say(
      "charge page headline:",
      (await page.locator("body").innerText()).split("\n").slice(0, 14).join(" | "),
    );

    // ── re-open from Order Management, as the cashier ──────────────────────
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await openOrderManagement(page);
    await assertNoErrorState(page, "order management");
    // A CLOSED order leaves the default active filters — select Closed.
    const closedFilter = page.locator('[data-testid="status-filter-CLOSED"]');
    if (await closedFilter.count()) {
      await closedFilter.first().click();
      await page.waitForTimeout(2500);
    }
    await shot(page, "07-order-management-closed-filter");
    const cashierDrawer = await readDrawer(page, orderId, "cashier");
    await shot(page, "08-drawer-cashier");

    // ── the same order, as the manager (who holds pos.order.refund) ────────
    const mgrCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const mgr = await mgrCtx.newPage();
    await login(mgr, MANAGER);
    await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await mgr.waitForTimeout(3500);
    await openOrderManagement(mgr);
    const mgrClosed = mgr.locator('[data-testid="status-filter-CLOSED"]');
    if (await mgrClosed.count()) {
      await mgrClosed.first().click();
      await mgr.waitForTimeout(2500);
    }
    const managerDrawer = await readDrawer(mgr, orderId, "manager");
    await mgr.screenshot({ path: `${OUT}/09-drawer-manager.png`, fullPage: true });
    say("  [shot] 09-drawer-manager.png");

    say("");
    say("================ VERDICT ================");
    say(`order            : ${orderNo} (${MODE})`);
    say(`closed on charge : ${closedChip === 1 ? "YES" : "NO"}`);
    say(`cashier drawer   : void=${cashierDrawer.voidBtn} refund=${cashierDrawer.refundBtn} charge=${cashierDrawer.chargeBtn} paidChip=${cashierDrawer.paidChip}`);
    say(`manager drawer   : void=${managerDrawer.voidBtn} refund=${managerDrawer.refundBtn} charge=${managerDrawer.chargeBtn} paidChip=${managerDrawer.paidChip}`);
    say("=========================================");
  } catch (e) {
    say("FAILED:", e.message);
    await shot(page, "99-failure").catch(() => {});
  } finally {
    say("");
    say("--- pos order API calls ---");
    api.forEach((a) => say("  ", a));
    writeFileSync(`${OUT}/transcript.txt`, log.join("\n"));
    await browser.close();
  }
}

main();
