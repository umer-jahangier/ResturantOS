// Shared harness for S0 #7 — "Offline Send to Kitchen lands the order as a DRAFT that never fires".
//
// Same instrument for the BEFORE probe and the AFTER proof so a reviewer is comparing
// like with like.
import { mkdirSync } from "node:fs";

export const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
export const SHOTS = `${REPO}/.planning/audits/repair/S0-08`;
export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";

export const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};
export const KITCHEN = {
  slug: "floating-terrace",
  email: "kitchen@terrace.local",
  password: "Terrace#Kitchen1",
};

/** The Rs 499.00 tile the DONE MEANS click path rings. */
export const ITEM_499 = "Audit Item 52235";

export async function shot(page, label, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${label}-${name}.png`, fullPage: false });
  console.log("    shot:", `${label}-${name}.png`);
}

export async function login(page, who = CASHIER) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/app\//, { timeout: 25000 });
  await page.waitForTimeout(1500);
  return page.url();
}

/** Everything a cashier can actually READ on the till right now. */
export async function probe(page) {
  return page.evaluate(() => {
    const txt = (n) => (n?.textContent || "").trim();
    const live = document.querySelector('[data-testid="pos-live-indicator"]');
    const badge = document.querySelector('[data-testid="sync-badge"]');
    const banner =
      document.querySelector('[data-testid="offline-banner"]') ||
      document.querySelector('[data-testid="online-reconnected-banner"]');
    // Read the totals block of the order panel by its row labels.
    const rows = {};
    for (const div of document.querySelectorAll("div.flex.justify-between")) {
      const label = txt(div.querySelector("span"));
      if (!label) continue;
      const money = div.textContent.match(/Rs\s?[\d,]+\.\d{2}/);
      if (money && !(label in rows)) rows[label] = money[0];
    }
    return {
      liveIndicator: live ? txt(live) : null,
      syncBadge: badge ? txt(badge) : null,
      queuedStrip: (() => {
        const s = document.querySelector('[data-testid="order-queued-strip"]');
        return s ? txt(s) : null;
      })(),
      banner: banner ? txt(banner) : null,
      totals: rows,
      toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map(txt),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(txt),
      statuses: Array.from(document.querySelectorAll('[role="status"]')).map(txt),
      orderNoOnScreen:
        (document.body.innerText.match(/ORD-\d{8}-\d+/) || [])[0] ?? null,
      queuedNotice: /queued|will sync|queue/i.test(document.body.innerText),
      bodyHead: document.body.innerText.slice(0, 600),
    };
  });
}

/** Dump the IndexedDB outbox from inside the page. */
export async function readOutbox(page) {
  return page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("restaurantos-pos");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains("outbox")) return [];
    return new Promise((res) => {
      const tx = db.transaction("outbox", "readonly");
      const req = tx.objectStore("outbox").getAll();
      req.onsuccess = () =>
        res(
          req.result.map((o) => ({
            type: o.type,
            status: o.status,
            attempts: o.attempts,
            clientOrderId: o.clientOrderId,
            lastError: o.lastError,
          })),
        );
      req.onerror = () => res([]);
    });
  });
}

/** Ring one tile by its visible name (the menu grid tile is a button). */
export async function ringItem(page, name) {
  const tile = page.locator(`button:has-text("${name}")`).first();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await page.waitForTimeout(500);
}

export async function ensureTerminal(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const terminalTab = page.locator('button:has-text("POS Terminal")').first();
  if (await terminalTab.count()) await terminalTab.click();
  await page.waitForTimeout(1200);
  await ensureTillOpen(page);
}

/**
 * A cashier cannot ring anything without an OPEN till, and the shared dev stack's till
 * is opened and closed by other runs all day. Open one if there isn't one.
 */
export async function ensureTillOpen(page) {
  const openBtn = page.getByTestId("open-till-button");
  if (!(await openBtn.isVisible().catch(() => false))) return false;
  console.log("    (till was closed — opening one with a Rs 5,000.00 float)");
  await openBtn.click();
  await page.waitForTimeout(800);
  await page.getByTestId("open-till-panel").locator("input").first().fill("5000.00");
  await page.getByTestId("open-till-confirm-button").click();
  await page.waitForTimeout(3000);
  const err = await page.getByTestId("open-till-error").innerText().catch(() => "");
  if (err) {
    // The cashier ALREADY has an open till and the till query merely failed to load it
    // (an error state rendered as "your till is closed" — a separate defect, gap #9's
    // family). Reload; the retry usually resolves it.
    console.log(`    (open-till said "${err}" — reloading to re-read the existing till)`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
  }
  return true;
}
