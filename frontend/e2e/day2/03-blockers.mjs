/* DAY 2 — step 3: THE THREE FORMER BLOCKERS.
 * (a) the cashier voids a check that HAS gone to the kitchen, with a reason
 * (b) a discount at the charge step — for whom, with a reason
 * (c) left to 06 (business date) */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();
async function loginCashier(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(NEW.email);
  await page.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) throw new Error("cashier login failed");
}
const cash = await newPage(browser);
await loginCashier(cash);
await go(cash, "/app/pos", { waitMs: 8000 });

// ── ring a third check purely to void it ─────────────────────────────────────
log("\n=== 3a. ring a check, fire it, then void it as the CASHIER ===");
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(500);
await cash.locator("[data-testid=table-select-trigger]").click();
await cash.waitForTimeout(1400);
const opts = await cash.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
    id: n.getAttribute("data-testid"), t: n.innerText.replace(/\s+/g, " ").trim(),
  })),
);
const free = opts.find((o) => /AVAILABLE/i.test(o.t)) ?? opts[0];
await cash.locator(`[data-testid="${free.id}"]`).click();
await cash.waitForTimeout(900);
const search = cash.locator('input[type=search], input[placeholder*="Search menu" i]').first();
await search.fill("Butter Naan");
await cash.waitForTimeout(1600);
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().click();
await cash.waitForTimeout(400);
await tiles.first().click();
await cash.waitForTimeout(900);
await cash.getByRole("button", { name: /send to kitchen/i }).first().click();
await cash.waitForTimeout(6000);
const ord3 = (await cash.evaluate(() => Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])))))[0];
log("  ORDER 3 (to be voided):", ord3, "table", free.t);
await shot(cash, "03a-order3-fired");

// find it in Order Management and void it
await cash.getByText("Order Management", { exact: true }).first().click();
await cash.waitForTimeout(4000);
const omSearch = cash.locator('input[placeholder*="Search" i], input[type=search]').last();
await omSearch.fill(ord3);
await cash.waitForTimeout(3000);
const row3 = await cash.evaluate((no) => {
  const tr = Array.from(document.querySelectorAll("tr")).find((r) => r.innerText.includes(no));
  return tr ? tr.innerText.replace(/\s*\n\s*/g, " | ").trim() : null;
}, ord3);
log("  row before void:", row3);
await cash.locator(`[aria-label^="Open order ${ord3}"]`).first().click();
await cash.waitForTimeout(3500);
const voidBtn = cash.locator('[role=dialog] button').filter({ hasText: /^Void$/ });
log("  Void trigger on the drawer:", await voidBtn.count());
await voidBtn.first().click();
await cash.waitForTimeout(1800);
await shot(cash, "03b-void-panel");
const voidPanel = await cash.evaluate(() => {
  const p = document.querySelector("[data-testid=void-refund-panel]");
  return p ? { text: p.innerText.replace(/\s+/g, " ").trim().slice(0, 700),
    inputs: Array.from(p.querySelectorAll("input,textarea,select")).map((i) => ({ id: i.id, ph: i.getAttribute("placeholder"), tag: i.tagName })),
    btns: Array.from(p.querySelectorAll("button")).map((b) => b.textContent.trim()) } : null;
});
log("  VOID PANEL:", JSON.stringify(voidPanel, null, 1).slice(0, 1400));
const REASON = "Guest left before the food went out — day 2 walkthrough";
const reasonBox = cash.locator("[data-testid=void-refund-panel] textarea, [data-testid=void-refund-panel] input[type=text]").first();
if (await reasonBox.count()) await reasonBox.fill(REASON);
await cash.waitForTimeout(400);
await shot(cash, "03c-void-reason-typed");
const confirm = cash.locator("[data-testid=void-refund-panel] button").filter({ hasText: /confirm void|void order/i });
log("  confirm button:", await confirm.count());
await confirm.last().click();
await cash.waitForTimeout(5000);
await shot(cash, "03d-after-void");
const voidResult = await cash.evaluate(() => ({
  err: document.querySelector("[data-testid=void-error]")?.innerText.trim() ?? null,
  panelStillOpen: !!document.querySelector("[data-testid=void-refund-panel]"),
  body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
  denied: /don.t have permission|Not permitted/i.test(document.body.innerText || ""),
}));
log("  VOID RESULT:", JSON.stringify(voidResult).slice(0, 700));

// reload and read the server's truth
await go(cash, "/app/pos", { waitMs: 6000 });
await cash.getByText("Order Management", { exact: true }).first().click();
await cash.waitForTimeout(3500);
await cash.locator('input[placeholder*="Search" i], input[type=search]').last().fill(ord3);
await cash.waitForTimeout(3000);
const row3after = await cash.evaluate((no) => {
  const tr = Array.from(document.querySelectorAll("tr")).find((r) => r.innerText.includes(no));
  return tr ? tr.innerText.replace(/\s*\n\s*/g, " | ").trim() : null;
}, ord3);
log("  ROW AFTER RELOAD:", row3after);
await shot(cash, "03e-voided-row");
saveState({ order3: { no: ord3, table: free.t, rowBefore: row3, rowAfter: row3after, voidResult, voidPanel, reason: REASON } });

// ── 3b. a discount at the charge step ────────────────────────────────────────
log("\n=== 3b. discount at the charge step, as the CASHIER ===");
await cash.locator('input[placeholder*="Search" i], input[type=search]').last().fill(S.order1.no);
await cash.waitForTimeout(3000);
await cash.locator(`[aria-label^="Open order ${S.order1.no}"]`).first().click();
await cash.waitForTimeout(3000);
const chargeBtn = cash.locator("[role=dialog] button").filter({ hasText: /charge now/i });
await chargeBtn.first().click();
await cash.waitForTimeout(7000);
log("  charge page:", cash.url());
await shot(cash, "03f-charge-page");
const chargeProbe = await cash.evaluate(() => ({
  hasPanel: !!document.querySelector("[data-testid=discount-panel]"),
  addBtn: !!document.querySelector("[data-testid=add-discount-button]"),
  addBtnText: document.querySelector("[data-testid=add-discount-button]")?.innerText.trim() ?? null,
  applied: document.querySelector("[data-testid=applied-discounts]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900),
}));
log("  CHARGE PAGE:", JSON.stringify(chargeProbe, null, 1).slice(0, 1500));
saveState({ chargeProbe, chargeUrl: cash.url() });
await browser.close();
