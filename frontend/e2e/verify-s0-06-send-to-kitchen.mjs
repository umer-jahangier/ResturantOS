/*
 * S0 #6 — "Send to Kitchen fails silently".
 *
 * Drives the REAL cashier click path in Chromium and forces each of the two failure
 * seams with request interception (what DevTools request-blocking does, done from the
 * harness so it is reproducible):
 *
 *   A. POST /api/v1/pos/orders            -> 503   (the create never lands)
 *   B. POST .../orders/{id}/send-to-kds   -> 503   (create lands, the fire does not)
 *   C. network restored, press Send again -> EXACTLY ONE ticket on /app/kitchen/DEFAULT
 *
 * After each attempt it probes what a cashier can actually SEE: any [role=alert], any
 * sonner toast, how many cart lines survived, and whether the button came back.
 *
 * The KDS check runs in its OWN browser context signed in as kitchen@terrace.local —
 * the cashier gets "You do not have permission to access the Kitchen Display", which
 * looks exactly like an empty board and would score a missing ticket as a pass.
 *
 *   node e2e/verify-s0-06-send-to-kitchen.mjs before|after
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "run";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S0-07");
const BASE = "http://localhost:3000";
const API = "http://localhost:8080";

const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};
const KITCHEN = {
  slug: "floating-terrace",
  email: "kitchen@terrace.local",
  password: "Terrace#Kitchen1",
};

mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${LABEL}-${name}.png`, fullPage: false });
  console.log("    shot:", `${LABEL}-${name}.png`);
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

/** Everything a cashier could actually read on screen after a failed tap. */
async function probe(page) {
  return page.evaluate(() => {
    const text = (n) => (n.textContent || "").trim();
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(text).filter(Boolean);
    const toasts = Array.from(document.querySelectorAll("[data-sonner-toast]"))
      .map(text)
      .filter(Boolean);
    // `Decrease <name> quantity` exists ONLY on a pre-send cart row — the menu grid's own
    // "Remove <name> from cart" badge would otherwise double-count every line.
    const cartLines = Array.from(
      document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]'),
    ).map((n) => n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""));
    const btn = document.querySelector('[data-testid="send-to-kitchen-button"]');
    const orderNos = Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]);
    return {
      alerts,
      toasts,
      cartLines,
      cartCount: cartLines.length,
      sendButton: btn ? { text: btn.textContent.trim(), disabled: btn.disabled } : null,
      orderNos: Array.from(new Set(orderNos)),
    };
  });
}

async function ringTwoItems(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 20000 });
  if ((await tiles.count()) < 2) throw new Error("menu grid rendered < 2 tiles");
  await tiles.nth(0).click();
  await page.waitForTimeout(250);
  await tiles.nth(1).click();
  await page.waitForTimeout(500);
  const before = await probe(page);
  if (before.cartCount !== 2) throw new Error(`expected 2 cart lines, saw ${before.cartCount}`);
  return before;
}

const block503 = (msg) => async (route) =>
  route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: "SERVICE_UNAVAILABLE", message: msg }),
  });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const results = {};

  await login(page, CASHIER);
  console.log("  signed in as", CASHIER.email);

  // ── A. create blocked ───────────────────────────────────────────────────────
  console.log("\n[A] POST /pos/orders -> 503");
  await ringTwoItems(page);
  await shot(page, "A1-cart-before-tap");
  const createBlock = block503("pos-service is down");
  await page.route(`${API}/api/v1/pos/orders`, createBlock);
  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(2500);
  results.A = await probe(page);
  await shot(page, "A2-after-failed-create");
  await page.unroute(`${API}/api/v1/pos/orders`, createBlock);
  console.log("   ", JSON.stringify(results.A, null, 1));

  // ── B. create OK, fire blocked ──────────────────────────────────────────────
  console.log("\n[B] create OK, POST .../send-to-kds -> 503");
  await ringTwoItems(page); // reload resets the terminal to a fresh cart
  const fireBlock = block503("kitchen fire refused");
  await page.route(`${API}/api/v1/pos/orders/*/send-to-kds`, fireBlock);
  await page.locator('[data-testid="send-to-kitchen-button"]').click();
  await page.waitForTimeout(3000);
  results.B = await probe(page);
  await shot(page, "B1-after-failed-fire");
  await page.unroute(`${API}/api/v1/pos/orders/*/send-to-kds`, fireBlock);
  console.log("   ", JSON.stringify(results.B, null, 1));

  // ── C. network restored, press Send to Kitchen again ────────────────────────
  console.log("\n[C] network restored — press Send to Kitchen again");
  const retry = page.locator('[data-testid="send-to-kitchen-button"]');
  results.C = { retryButtonPresent: (await retry.count()) > 0 };
  if (results.C.retryButtonPresent) {
    await retry.first().click();
    await page.waitForTimeout(2500);
    results.C.after = await probe(page);
    await shot(page, "C1-after-retry");
  }
  console.log("   ", JSON.stringify(results.C, null, 1));

  // ── D. the kitchen board, as the kitchen ────────────────────────────────────
  console.log("\n[D] /app/kitchen/DEFAULT as", KITCHEN.email);
  const kdsCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const kds = await kdsCtx.newPage();
  await login(kds, KITCHEN);
  await kds.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await kds.waitForTimeout(5000);
  const target = results.B.orderNos[0] ?? null;
  results.D = await kds.evaluate((orderNo) => {
    const body = document.body.innerText;
    const all = Array.from(body.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]);
    return {
      accessDenied: /do not have permission/i.test(body),
      targetOrderNo: orderNo,
      occurrencesOfTarget: orderNo ? all.filter((o) => o === orderNo).length : 0,
      totalTicketsOnBoard: all.length,
    };
  }, target);
  await shot(kds, "D1-kds-default");
  console.log("   ", JSON.stringify(results.D));

  console.log("\n===== SUMMARY (" + LABEL + ") =====");
  console.log(
    JSON.stringify(
      {
        A_create_failed: {
          visibleError: results.A.alerts.length + results.A.toasts.length > 0,
          alerts: results.A.alerts,
          toasts: results.A.toasts,
          cartCount: results.A.cartCount,
          sendButton: results.A.sendButton,
        },
        B_fire_failed: {
          visibleError: results.B.alerts.length + results.B.toasts.length > 0,
          alerts: results.B.alerts,
          toasts: results.B.toasts,
          cartCount: results.B.cartCount,
          orderNos: results.B.orderNos,
        },
        C_retry: results.C,
        D_kds: results.D,
      },
      null,
      2,
    ),
  );

  await browser.close();
}

main().catch((e) => {
  console.error("HARNESS FAILED:", e);
  process.exit(1);
});
