/*
 * SHIFT STEP 3d — actually void the unpaid check, and see the paid one as a MANAGER.
 *
 * The Void trigger's accessible name is "Void order", not "Void" — an aria-label overrides
 * the visible text. Worth recording: the button a cashier reads as "Void" is not the button
 * a screen reader announces, and a harness looking for the visible word finds nothing.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

async function signIn(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password ?? who.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  log("  ✓", who.email);
}
async function openAndSearch(page, no) {
  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4000);
  await page.locator("[data-testid=order-management-search]").first().fill(no);
  await page.waitForTimeout(4000);
  return page.evaluate(() => {
    const btn = document.querySelector('[data-testid^="open-order-"]');
    return btn?.getAttribute("data-testid")?.replace("open-order-", "") ?? null;
  });
}

// ── the cashier voids the unpaid check ────────────────────────────────────────
const cash = await newPage(browser);
await signIn(cash, NEW);
const id3 = await openAndSearch(cash, st.order3No);
log("  order 3 id:", id3);
await cash.locator(`[data-testid="open-order-${id3}"]`).click();
await cash.waitForTimeout(3500);

const voidTrigger = cash.getByLabel("Void order");
log("  'Void order' trigger:", await voidTrigger.count());
await voidTrigger.first().click();
await cash.waitForTimeout(1800);
await shot(cash, "03m-void-panel-open");
const panel = await cash.evaluate(() => {
  const p = document.querySelector("[data-testid=void-refund-panel]");
  if (!p) return null;
  return {
    text: p.innerText.replace(/\s+/g, " ").trim().slice(0, 800),
    fields: Array.from(p.querySelectorAll("input,textarea,select")).map((n) => ({
      tag: n.tagName,
      label: n.getAttribute("aria-label") ?? n.placeholder ?? null,
      options: n.tagName === "SELECT" ? Array.from(n.options).map((o) => o.text) : undefined,
    })),
    buttons: Array.from(p.querySelectorAll("button")).map((b) => b.textContent.trim()),
  };
});
log("  void panel:", JSON.stringify(panel, null, 1));
saveState({ voidPanel: panel });

const ta = cash.locator("[data-testid=void-refund-panel] textarea");
if (await ta.count()) await ta.first().fill("Guest left before the food went out — shift walkthrough");
else await cash.locator("[data-testid=void-refund-panel] input").first().fill("Guest left before the food went out");
await cash.waitForTimeout(400);
await shot(cash, "03n-void-reason");
await cash.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void|Void Order|Void/i }).last().click();
await cash.waitForTimeout(5500);
await shot(cash, "03o-after-void");
const after = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
  toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => n.innerText.trim()),
  drawerOpen: !!document.querySelector("[data-testid=order-table-detail-drawer]"),
  body: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
}));
log("  after confirming the void:", JSON.stringify(after, null, 1));
saveState({ voidUnpaidOutcome: after });

// is it on the Voided chip, with reason and actor?
await go(cash, "/app/pos", { waitMs: 6000 });
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(3500);
await cash.locator("[data-testid=status-filter-voided]").click().catch(() => log("  (no voided chip testid)"));
await cash.waitForTimeout(4000);
await shot(cash, "03p-voided-filter");
const voidedList = await cash.evaluate((no) => {
  const t = document.body.innerText;
  const i = t.indexOf(no);
  return { present: i >= 0, ctx: i >= 0 ? t.slice(Math.max(0, i - 60), i + 320).replace(/\s+/g, " ") : null };
}, st.order3No);
log("  under the Voided chip:", JSON.stringify(voidedList, null, 1));
saveState({ voidedChip: voidedList });

// ── the manager looks at the PAID check ───────────────────────────────────────
log("\n=== the same paid check, seen by the MANAGER ===");
const mgr = await newPage(browser);
await signIn(mgr, PEOPLE.manager);
const id1 = await openAndSearch(mgr, st.order1No);
log("  order 1 id (manager):", id1);
await mgr.locator(`[data-testid="open-order-${id1}"]`).click();
await mgr.waitForTimeout(3500);
await shot(mgr, "03q-manager-paid-order-drawer");
const mgrDrawer = await mgr.evaluate(() => {
  const d = document.querySelector("[data-testid=order-table-detail-drawer]");
  return d
    ? {
        buttons: Array.from(d.querySelectorAll("button")).map((b) => (b.getAttribute("aria-label") || b.textContent).trim()).filter(Boolean),
        notice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.textContent?.trim() ?? null,
        text: d.innerText.replace(/\s+/g, " ").slice(0, 700),
      }
    : null;
});
log("  manager's drawer:", JSON.stringify(mgrDrawer, null, 1));
saveState({ managerPaidDrawer: mgrDrawer });

await browser.close();
log("\nstep 3d done");
