// S0-06 reproduction: a paid order never reaches a terminal state.
// Drives the REAL cashier click-path in Chromium:
//   /app/pos -> ring 2 items -> Send to Kitchen -> Charge Now -> full CASH
// then reads back what the operator actually sees.
//
//   node e2e/s0-06-repro.mjs [before|after] [dinein|takeaway]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "before";
const MODE = process.argv[3] ?? "dinein";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-06", `${LABEL}-${MODE}`);
const BASE = "http://localhost:3000";
const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};

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

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(CASHIER.slug);
  await page.locator('input[name="email"], input#email').first().fill(CASHIER.email);
  await page.locator('input[name="password"], input#password').first().fill(CASHIER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  say("login ->", page.url());
  if (page.url().includes("/login")) throw new Error("login failed");
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();

  const api = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/pos/")) api.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") say("  [console.error]", m.text().slice(0, 220));
  });

  try {
    await login(page);

    // --- the cashier's own JWT permissions, straight from the app ------------
    const perms = await page.evaluate(async () => {
      const r = await fetch("/api/auth/session").catch(() => null);
      if (r && r.ok) return await r.json().catch(() => null);
      return null;
    });
    if (perms) writeFileSync(`${OUT}/session.json`, JSON.stringify(perms, null, 2));

    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const alerts = await page.locator('[role="alert"]').allInnerTexts();
    if (alerts.length) say("!! [role=alert] on /app/pos:", JSON.stringify(alerts));
    await shot(page, "01-pos-terminal");

    // --- order type -------------------------------------------------------
    if (MODE === "takeaway") {
      const tw = page.getByRole("button", { name: /takeaway/i }).first();
      if (await tw.count()) {
        await tw.click();
        await page.waitForTimeout(600);
        say("selected order type: TAKEAWAY");
      } else {
        say("!! no Takeaway toggle found");
      }
    } else {
      // dine-in: pick a real, AVAILABLE table so the order carries a tableId
      const trigger = page.locator('[data-testid="table-select-trigger"]').first();
      await trigger.click();
      await page.waitForTimeout(700);
      const opts = page.locator('[data-testid^="table-option-"] button:not([disabled])');
      const on = await opts.count();
      say("selectable tables:", on);
      if (on > 0) {
        say("picking table:", (await opts.first().innerText()).replace(/\n/g, " ").trim());
        await opts.first().click();
      } else {
        await page.keyboard.press("Escape");
        say("!! no AVAILABLE table to pick");
      }
      await page.waitForTimeout(700);
      say("table trigger now reads:", (await trigger.innerText()).trim());
    }

    // --- ring two items ---------------------------------------------------
    // NB: tile index is NOT stable — selecting an item injects a "Remove" button
    // into the same grid, so nth(1) after one click is the remove control.
    // Address the tiles by their accessible name instead.
    const grid = page.locator('[data-testid="menu-grid"]');
    await grid.waitFor({ timeout: 15000 });
    const names = await grid.locator("> div > button").allInnerTexts();
    const wanted = names.slice(0, 2).map((t) => t.split("\n")[0].trim());
    say("ringing:", JSON.stringify(wanted));
    for (const name of wanted) {
      await grid.locator("> div > button", { hasText: name }).first().click();
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(600);
    const cartLines = await page.locator('[data-testid="order-panel"], aside').first().innerText().catch(() => "");
    say("cart panel:", cartLines.replace(/\n+/g, " | ").slice(0, 400));
    await shot(page, "02-cart-two-items");

    // --- send to kitchen --------------------------------------------------
    const send = page.locator('[data-testid="send-to-kitchen-button"]').first();
    await send.waitFor({ timeout: 10000 });
    await send.click();
    await page.waitForTimeout(5000);
    await shot(page, "03-after-send-to-kitchen");

    // --- charge now -------------------------------------------------------
    const charge = page.locator('[data-testid="charge-now-button"]').first();
    if (!(await charge.count())) {
      say("!! no charge-now-button after send to kitchen");
      await shot(page, "03b-no-charge-button");
      throw new Error("no charge button");
    }
    await charge.click();
    await page.waitForTimeout(3500);
    const chargeUrl = page.url();
    say("charge url:", chargeUrl);
    const orderId = chargeUrl.match(/orders\/([0-9a-f-]{36})\/charge/)?.[1] ?? null;
    say("orderId:", orderId);
    await shot(page, "04-charge-page");

    // --- settle in full with CASH ----------------------------------------
    await page.locator('[data-testid="fill-full-amount-button"]').first().click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid="record-payment-button"]').first().click();
    await page.waitForTimeout(6000);
    await shot(page, "05-after-full-cash");

    const afterText = await page.locator("body").innerText();
    say("--- charge page after payment (headline) ---");
    say(afterText.split("\n").slice(0, 24).join(" | "));

    // Look for any explicit close/serve control on the settlement screen.
    const closeCandidates = await page
      .getByRole("button")
      .allInnerTexts()
      .then((t) => t.map((s) => s.trim()).filter(Boolean));
    say("buttons on charge page after payment:", JSON.stringify(closeCandidates));

    // --- WITHOUT further clicks, what does the server say? ----------------
    const serverOrder = await page.evaluate(async (id) => {
      const r = await fetch(`/api/pos/orders/${id}`).catch(() => null);
      return r ? { status: r.status, body: await r.text() } : null;
    }, orderId);
    if (serverOrder) say("proxy read:", serverOrder.status, String(serverOrder.body).slice(0, 300));

    // --- re-open from Order Management ------------------------------------
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const omTab = page.getByRole("tab", { name: /order/i }).first();
    if (await omTab.count()) {
      await omTab.click();
      await page.waitForTimeout(2500);
    } else {
      const omBtn = page.getByRole("button", { name: /^orders?$/i }).first();
      if (await omBtn.count()) {
        await omBtn.click();
        await page.waitForTimeout(2500);
      }
    }
    await shot(page, "06-order-management");

    if (orderId) {
      const row = page.locator(`[data-testid="open-order-${orderId}"]`).first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(3000);
        await shot(page, "07-drawer");
        const drawerText = await page.locator('[role="dialog"]').first().innerText().catch(() => "");
        say("--- drawer text ---");
        say(drawerText.replace(/\n+/g, " | ").slice(0, 1500));
        const voidBtn = await page.getByRole("button", { name: /void order/i }).count();
        const refundBtn = await page.getByRole("button", { name: /refund order/i }).count();
        const chargeBtn = await page.locator('[data-testid="charge-now-button"]').count();
        const paidChip = await page.locator('[data-testid="paid-chip"]').count();
        say(`VERDICT drawer: voidOrder=${voidBtn} refundOrder=${refundBtn} chargeNow=${chargeBtn} paidChip=${paidChip}`);
      } else {
        say("!! order row not found in Order Management for", orderId);
        const bodyTxt = await page.locator("body").innerText();
        say(bodyTxt.split("\n").slice(0, 40).join(" | "));
      }
    }

    say("--- pos API calls ---");
    api.forEach((a) => say("  ", a));
  } catch (e) {
    say("FAILED:", e.message);
    await shot(page, "99-failure").catch(() => {});
  } finally {
    writeFileSync(`${OUT}/transcript.txt`, log.join("\n"));
    await browser.close();
  }
}

main();
