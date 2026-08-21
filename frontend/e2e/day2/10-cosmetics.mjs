/* DAY 2 — 10: the small things a cashier meets a hundred times a shift. */
import { newBrowser, newPage, go, shot, saveState, loadState, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();
const out = {};

// ── Till Review: is the cashier a name or a UUID? ────────────────────────────
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, "/app/pos/tills", { waitMs: 6000 });
await shot(mgr, "10a-till-review");
out.tillReview = await mgr.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("tr")).slice(0, 6).map((r) => r.innerText.replace(/\s*\n\s*/g, " | ").trim());
  const hex = (document.body.innerText || "").match(/\b[0-9a-f]{8}\b/g) ?? [];
  return { rows, hexFragments: Array.from(new Set(hex)).slice(0, 10) };
});
log("  TILL REVIEW rows:", JSON.stringify(out.tillReview.rows, null, 1).slice(0, 900));
log("  8-char hex fragments on Till Review:", JSON.stringify(out.tillReview.hexFragments));

// ── Charge page: is the cashier a name or a UUID? ────────────────────────────
await go(mgr, `/app/pos/orders/${S.order1.id}/charge`, { waitMs: 8000 });
out.chargeHeader = await mgr.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  return /Cashier: [^·]+/.exec(t)?.[0]?.trim() ?? null;
});
log("  CHARGE PAGE header:", out.chargeHeader);
await shot(mgr, "10b-charge-header");

// ── POS cart: is the dish name readable? ─────────────────────────────────────
const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const sl = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await sl.count()) await sl.first().fill(NEW.slug);
await cash.locator('input[name="email"]').first().fill(NEW.email);
await cash.locator('input[name="password"]').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);
await go(cash, "/app/pos", { waitMs: 9000 });
const search = cash.locator('input[placeholder*="Search menu" i]').first();
await search.fill("Chicken Karahi");
await cash.waitForTimeout(2000);
await cash.locator('[data-testid="menu-grid"] button[aria-pressed]').first().click();
await cash.waitForTimeout(1500);
out.cartLine = await cash.evaluate(() => {
  const dec = document.querySelector('button[aria-label^="Decrease "]');
  if (!dec) return null;
  const row = dec.closest("li, div");
  const nameEl = row?.querySelector("span, p, div");
  const el = Array.from(row?.querySelectorAll("*") ?? []).find((n) => /Chicken/.test(n.textContent ?? "") && n.children.length === 0);
  if (!el) return { rowText: row?.innerText.replace(/\s+/g, " ").trim() ?? null };
  const cs = getComputedStyle(el);
  return {
    rendered: el.textContent,
    full: dec.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""),
    clipped: el.scrollWidth > el.clientWidth,
    scrollW: el.scrollWidth, clientW: el.clientWidth,
    overflow: cs.textOverflow, whiteSpace: cs.whiteSpace,
    rowText: row?.innerText.replace(/\s+/g, " ").trim() ?? null,
  };
});
log("  CART LINE:", JSON.stringify(out.cartLine));
await shot(cash, "10c-cart-line-name");
saveState({ cosmetics: out });
await browser.close();
