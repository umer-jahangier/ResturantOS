/* Does the drawer's "Full Menu" escape hatch handle a required modifier group? */
import { newBrowser, newPage, go, shot, saveState, loadState, log, BASE } from "./lib.mjs";
const S = loadState(); const NEW = S.newCashier;
const browser = await newBrowser(); const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await cash.waitForTimeout(1400);
const sl = cash.locator('input[name="tenantSlug"], input#tenantSlug'); if (await sl.count()) await sl.first().fill(NEW.slug);
await cash.locator('input[name="email"]').first().fill(NEW.email);
await cash.locator('input[name="password"]').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click(); await cash.waitForTimeout(6000);
await go(cash, "/app/pos", { waitMs: 8000 });
await cash.getByText("Order Management", { exact: true }).first().click(); await cash.waitForTimeout(4000);
await cash.locator('input[placeholder*="Search" i], input[type=search]').last().fill(S.routingProof.ord); await cash.waitForTimeout(3000);
await cash.locator(`[aria-label^="Open order ${S.routingProof.ord}"]`).first().click(); await cash.waitForTimeout(3000);
await cash.locator("[data-testid=drawer-full-menu]").click(); await cash.waitForTimeout(4000);
log("  after Full Menu, url:", cash.url());
await shot(cash, "11a-full-menu");
const search = cash.locator('input[placeholder*="Search menu" i]').first();
log("  menu search present:", await search.count());
if (await search.count()) {
  await search.fill("Audit Item 60568"); await cash.waitForTimeout(2000);
  await cash.locator('[data-testid="menu-grid"] button[aria-pressed]').first().click(); await cash.waitForTimeout(2000);
  const dlg = await cash.evaluate(() => ({
    modifierDialog: !!document.querySelector("[data-testid=modifier-dialog]"),
    blocked: document.querySelector("[data-testid=modifier-dialog-blocked]")?.innerText.trim() ?? null,
    groups: Array.from(document.querySelectorAll('[data-testid^="modifier-group-"]')).map(n=>n.innerText.replace(/\s+/g," ").slice(0,80)),
  }));
  log("  FULL MENU -> modifier dialog:", JSON.stringify(dlg));
  await shot(cash, "11b-full-menu-modifier");
  saveState({ fullMenuPath: dlg });
}
await browser.close();
