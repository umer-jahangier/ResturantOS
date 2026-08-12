/*
 * F20 — REPRODUCTION.
 *
 * "Service charge Rs 0.00 prints on the charge page and on every guest receipt, and there is
 *  no control anywhere to set a service charge or take a tip."
 *
 * Drives: cashier -> till open -> dine-in check -> charge page -> probe.
 * Then reads the printed receipt document for the same order.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, apiSend, log,
} from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20");
mkdirSync(OUT, { recursive: true });
const shots = async (page, name) => {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  log(`    shot: ${name}.png`);
};

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);

// ── till ──────────────────────────────────────────────────────────────────────
let tr = await go(cash, "/app/pos/tills", { waitMs: 4000 });
log("  /app/pos/tills:", JSON.stringify(tr));
const tillTxt = await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
log("  till page:", tillTxt);
if (/Open (the )?till|Open drawer|Opening float/i.test(tillTxt) && !/Close till/i.test(tillTxt)) {
  const btn = cash.locator("button", { hasText: /Open till|Open drawer/i }).first();
  if (await btn.count()) {
    await btn.click();
    await cash.waitForTimeout(1200);
    const amt = cash.locator('input[type="number"], input[inputmode="numeric"]').first();
    if (await amt.count()) await amt.fill("500000");
    const submit = cash.locator('[role=dialog] button[type=submit], [role=dialog] button', { hasText: /Open/i }).first();
    if (await submit.count()) await submit.click();
    await cash.waitForTimeout(3000);
  }
}
await shots(cash, "00-till");

// ── ring a dine-in check ──────────────────────────────────────────────────────
tr = await go(cash, "/app/pos", { waitMs: 8000 });
log("  /app/pos:", JSON.stringify(tr));
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(500);
const tableTrigger = cash.locator("[data-testid=table-select-trigger]");
if (await tableTrigger.count()) {
  await tableTrigger.click();
  await cash.waitForTimeout(1200);
  const opts = await cash.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="table-option-"]'))
      .filter((n) => n.getAttribute("aria-disabled") !== "true")
      .map((n) => ({
        id: n.getAttribute("data-testid"),
        t: n.innerText.replace(/\s+/g, " ").trim(),
      })),
  );
  const free = opts.find((o) => /AVAILABLE/i.test(o.t)) ?? opts[0];
  log("  table:", JSON.stringify(free));
  if (free) await cash.locator(`[data-testid="${free.id}"]`).click();
  await cash.waitForTimeout(800);
}
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
await tiles.nth(0).click();
await cash.waitForTimeout(250);
await tiles.nth(1).click();
await cash.waitForTimeout(900);
await shots(cash, "01-cart");

// ── the terminal panel: is a service charge or tip offered here? ──────────────
const terminalProbe = await cash.evaluate(() => {
  const t = document.body.innerText;
  return {
    serviceChargeText: /Service charge[^\n]*/i.exec(t)?.[0] ?? null,
    tipText: /\btip\b[^\n]*/i.exec(t)?.[0] ?? null,
    controls: Array.from(document.querySelectorAll("button,input,select"))
      .map((n) => (n.getAttribute("aria-label") || n.textContent || "").trim())
      .filter((x) => /tip|service charge|gratuity/i.test(x)),
  };
});
log("  terminal probe:", JSON.stringify(terminalProbe));

// fire it so it is a real dine-in check
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(6000);
const mine = await apiGet(cash, "/api/v1/branches/mine");
const branchId = (mine.body?.data ?? [])[0]?.id ?? (mine.body?.data ?? [])[0]?.branchId;
log("  branchId:", branchId, JSON.stringify(mine.body).slice(0, 300));
const list = await apiGet(cash, `/api/v1/pos/orders?branchId=${branchId}&size=3`);
const rows = list.body?.data ?? list.body ?? [];
const order = Array.isArray(rows) ? rows[0] : null;
log("  order:", JSON.stringify(order)?.slice(0, 600));
if (!order) throw new Error("no order created");

// ── charge page ───────────────────────────────────────────────────────────────
const orderId = order.orderId ?? order.id;
tr = await go(cash, `/app/pos/orders/${orderId}/charge`, { waitMs: 5000 });
log("  charge page:", JSON.stringify(tr));
await shots(cash, "02-charge-page");
const chargeProbe = await cash.evaluate(() => {
  const t = document.body.innerText;
  const row = (label) => {
    const re = new RegExp(label + "\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)", "i");
    return re.exec(t)?.[1] ?? null;
  };
  return {
    subtotal: row("Subtotal"),
    discounts: row("Discounts"),
    serviceCharge: row("Service charge"),
    taxes: row("Taxes"),
    total: row("Total"),
    serviceChargeLinePresent: /Service charge/i.test(t),
    tipControls: Array.from(document.querySelectorAll("button,input,select"))
      .map((n) => (n.getAttribute("aria-label") || n.textContent || "").trim())
      .filter((x) => /tip|gratuity|service charge/i.test(x)),
  };
});
log("  charge probe:", JSON.stringify(chargeProbe, null, 1));

// ── the settings surfaces a manager would look for ────────────────────────────
const routes = [
  "/app/settings", "/app/settings/service-charge", "/app/settings/pos",
  "/app/settings/charges", "/app/terminals",
];
const found = {};
for (const r of routes) {
  const t = await go(cash, r, { waitMs: 2500, allowTrouble: true });
  const body = await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 220));
  found[r] = { bad: t.bad, hasServiceCharge: /service charge/i.test(body), head: body.slice(0, 140) };
}
log("  settings routes (cashier):", JSON.stringify(found, null, 1));

// ── same as OWNER, so "missing" is not "wrong persona" ────────────────────────
const own = await newPage(browser);
await login(own, PEOPLE.owner);
const foundOwner = {};
for (const r of routes) {
  const t = await go(own, r, { waitMs: 2500, allowTrouble: true });
  const body = await own.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
  foundOwner[r] = { bad: t.bad, hasServiceCharge: /service charge/i.test(body), head: body.slice(0, 200) };
}
log("  settings routes (OWNER):", JSON.stringify(foundOwner, null, 1));
await go(own, "/app/settings", { waitMs: 3000, allowTrouble: true });
await shots(own, "03-owner-settings");

writeFileSync(`${OUT}/repro.json`, JSON.stringify(
  { order, terminalProbe, chargeProbe, cashierRoutes: found, ownerRoutes: foundOwner }, null, 2));

await browser.close();
log("\nF20 repro done");
