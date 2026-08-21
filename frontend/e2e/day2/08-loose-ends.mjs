/* DAY 2 — step 8: the guest's printed bill; the tender split on Takings; and the drawer's
 * quick-add refusal message. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();
const out = {};

// ── the guest's bill ─────────────────────────────────────────────────────────
const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const sl = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await sl.count()) await sl.first().fill(NEW.slug);
await cash.locator('input[name="email"]').first().fill(NEW.email);
await cash.locator('input[name="password"]').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);
const tr = await go(cash, `/app/pos/orders/${S.order1.id}/receipt`, { waitMs: 8000 });
log("  receipt trouble:", JSON.stringify(tr.bad));
await shot(cash, "08a-receipt");
const receipt = await cash.evaluate(() => {
  const t = (document.body.innerText || "").replace(/[ \t]+/g, " ");
  const i = t.search(/Floating Terrace|TAX INVOICE|Subtotal/);
  return { text: t.slice(Math.max(0, i - 200), i + 1600), bracket: /\[[A-Z0-9-]+\]/.exec(t)?.[0] ?? null };
});
log("  RECEIPT:\n", receipt.text);
log("  bracketed code on the bill:", receipt.bracket);
out.receipt = receipt;

// ── takings: the tender split ────────────────────────────────────────────────
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
await go(owner, "/app/finance/takings?date=2026-08-12", { waitMs: 8000 });
const takings = await owner.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  const start = t.indexOf("The day's money");
  return t.slice(start, start + 2600);
});
log("\n  TAKINGS TEXT:\n ", takings);
out.takings = takings;
await shot(owner, "08b-takings-full");

// ── the drawer's quick-add refusal ───────────────────────────────────────────
await go(cash, "/app/pos", { waitMs: 8000 });
await cash.getByText("Order Management", { exact: true }).first().click();
await cash.waitForTimeout(4000);
await cash.locator('input[placeholder*="Search" i], input[type=search]').last().fill(S.routingProof.ord);
await cash.waitForTimeout(3000);
await cash.locator(`[aria-label^="Open order ${S.routingProof.ord}"]`).first().click();
await cash.waitForTimeout(3000);
const quick = cash.locator('[role=dialog] input[aria-label="Search menu"]').first();
await quick.fill("Audit Item 60568");           // a dish with a REQUIRED "Doneness" group
await cash.waitForTimeout(2200);
await shot(cash, "08c-quickadd-required-dish");
const addBtn = cash.getByRole("button", { name: /^Add$/ });
log("  Add buttons:", await addBtn.count());
if (await addBtn.count()) { await addBtn.first().click(); await cash.waitForTimeout(3500); }
const toast = await cash.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('[data-sonner-toast], [role=status], [role=alert]'));
  return nodes.map((n) => n.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6);
});
log("  TOAST AFTER QUICK-ADD:", JSON.stringify(toast));
await shot(cash, "08d-quickadd-refusal-toast");
const drawerAfter = await cash.evaluate(() => (document.querySelector("[role=dialog]")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 600));
log("  drawer after:", drawerAfter.slice(0, 400));
out.quickAdd = { toast, drawerAfter };
saveState({ looseEnds: out });
await browser.close();
