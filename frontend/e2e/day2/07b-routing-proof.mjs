/* DAY 2 — 7a proof: the dish I re-routed to BAR must now appear on the BAR board. */
import { newBrowser, newPage, go, shot, saveState, loadState, log, BASE, PEOPLE, login, apiGet } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();

// manager re-opens a drawer for the cashier
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, "/app/pos/tills", { waitMs: 5000 });
await mgr.getByRole("button", { name: /open a drawer/i }).first().click();
await mgr.waitForTimeout(1500);
const sel = mgr.locator("#open-drawer-cashier");
const opts = await sel.locator("option").allTextContents();
const label = opts.find((o) => o.includes(NEW.fullName));
log("  re-opening a drawer for:", label);
await sel.selectOption({ label });
await mgr.waitForTimeout(500);
await mgr.locator("[role=dialog] input").first().fill("1000");
await mgr.locator("[role=dialog] button").filter({ hasText: /open drawer/i }).last().click();
await mgr.waitForTimeout(4000);

// cashier rings the re-routed dish
const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const sl = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await sl.count()) await sl.first().fill(NEW.slug);
await cash.locator('input[name="email"]').first().fill(NEW.email);
await cash.locator('input[name="password"]').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);
await go(cash, "/app/pos", { waitMs: 8000 });
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(600);
const search = cash.locator('input[placeholder*="Search menu" i]').first();
await search.fill("Audit Item 52235");
await cash.waitForTimeout(1800);
await cash.locator('[data-testid="menu-grid"] button[aria-pressed]').first().click();
await cash.waitForTimeout(1500);
// satisfy the required modifier group
const opt = cash.locator('[data-testid^="modifier-option-"]').filter({ hasText: /Medium|Hot|Mild/ }).first();
if (await opt.count()) { await opt.click(); await cash.waitForTimeout(600); }
await cash.locator("[data-testid=modifier-dialog-add]").click();
await cash.waitForTimeout(1500);
await cash.getByRole("button", { name: /send to kitchen/i }).first().click();
await cash.waitForTimeout(6000);
const ord = (await cash.evaluate(() => Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])))))[0];
log("  ROUTING PROOF ORDER:", ord);
await shot(cash, "07g-routing-proof-fired");

// the cook looks at BAR
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
const boards = {};
for (const code of ["BAR", "PANTRY1", "GRILL", "DEFAULT"]) {
  await go(kds, `/app/kitchen/${code}`, { waitMs: 5500 });
  const hit = await kds.evaluate((no) => {
    const t = document.body.innerText || "";
    const i = t.indexOf(no);
    return { present: i >= 0, snippet: i >= 0 ? t.slice(i, i + 200).replace(/\s+/g, " ") : null,
      header: document.querySelector("[data-testid=kds-ticket-count]")?.textContent?.trim() ?? null };
  }, ord);
  boards[code] = hit;
  log(`  ${code}: ${hit.present} ${hit.snippet ?? ""}`);
  if (hit.present) await shot(kds, `07h-routed-to-${code}`);
}
saveState({ routingProof: { ord, boards } });
await browser.close();
