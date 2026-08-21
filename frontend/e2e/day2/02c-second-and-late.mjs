/* DAY 2 — step 2c: a second (take-away) check, a late add to the dine-in check after it
 * was fired, and what Order Management says about TYPE and WHO. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, BASE } from "./lib.mjs";

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

// ── 2c-i. TAKEAWAY ───────────────────────────────────────────────────────────
if (!process.env.SKIP_TAKEAWAY) {
log("\n=== take-away check ===");
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(700);
const tablePickerGone = (await cash.locator("[data-testid=table-select-trigger]").count()) === 0;
log("  table picker removed for takeaway:", tablePickerGone);
const search = cash.locator('input[type=search], input[placeholder*="Search" i]').first();
await search.fill("Chicken");
await cash.waitForTimeout(1600);
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().click();
await cash.waitForTimeout(500);
await tiles.nth(1).click();
await cash.waitForTimeout(900);
const c2 = await cash.evaluate(() => {
  const t = document.body.innerText;
  return {
    lines: Array.from(document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]')).map((n) =>
      n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, "")),
    panel: (document.querySelector("[data-testid=order-panel]")?.innerText ?? t).replace(/\s+/g, " ").match(/Subtotal.*?(Send to Kitchen|Charge Now)/)?.[0] ?? null,
  };
});
log("  takeaway cart:", JSON.stringify(c2));
await shot(cash, "02m-takeaway-cart");
await cash.getByRole("button", { name: /send to kitchen/i }).first().click();
await cash.waitForTimeout(6000);
const ord2 = await cash.evaluate(() => {
  const m = Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((x) => x[0]);
  return Array.from(new Set(m));
});
log("  ORDER 2:", JSON.stringify(ord2));
await shot(cash, "02n-takeaway-fired");
saveState({ order2: ord2 });
}

// ── 2c-ii. late add to the DINE-IN check ─────────────────────────────────────
log("\n=== late add to", S.order1.no, "===");
await go(cash, "/app/pos", { waitMs: 6000 });
await cash.getByText("Order Management", { exact: true }).first().click();
await cash.waitForTimeout(4000);
const omSearch = cash.locator('input[placeholder*="Search" i], input[type=search]').last();
log("  order-management search boxes:", await cash.locator('input[placeholder*="Search" i], input[type=search]').count());
await omSearch.fill(S.order1.no);
await cash.waitForTimeout(3000);
await shot(cash, "02o-order-management-search");
const rowText = await cash.evaluate((no) => {
  const tr = Array.from(document.querySelectorAll("tr")).find((r) => r.innerText.includes(no));
  return tr ? tr.innerText.replace(/\s*\n\s*/g, " | ").trim() : null;
}, S.order1.no);
log("  ORDER-MANAGEMENT ROW:", rowText);

const open = cash.locator(`[aria-label^="Open order ${S.order1.no}"]`);
log("  Open buttons:", await open.count());
await open.first().click();
await cash.waitForTimeout(3500);
await shot(cash, "02p-drawer-open");
const drawer = await cash.evaluate(() => {
  const d = document.querySelector("[role=dialog], [data-testid=order-drawer]");
  return {
    btns: Array.from((d ?? document).querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean).slice(0, 40),
    head: (d ?? document.body).innerText.replace(/\s+/g, " ").slice(0, 500),
  };
});
log("  DRAWER:", JSON.stringify(drawer, null, 1).slice(0, 1600));

// quick add
const quick = cash.locator('[role=dialog] input[aria-label="Search menu"]').first();
if (await quick.count()) {
  // A dish with a REQUIRED modifier group — the terminal refuses it without a choice.
  await quick.fill("Audit Item 52235");
  await cash.waitForTimeout(2200);
  await shot(cash, "02q0-quickadd-required-modifier-dish");
  const qaRes = await cash.evaluate(() => document.querySelector("[data-testid=quick-add-results]")?.innerText.replace(/\s+/g," ").trim() ?? null);
  log("  quick-add results for a REQUIRED-modifier dish:", qaRes);
  const addBtn0 = cash.getByRole("button", { name: /^Add$/ });
  if (await addBtn0.count()) { await addBtn0.first().click(); await cash.waitForTimeout(3000); }
  const modDlg = await cash.evaluate(() => !!document.querySelector("[data-testid=modifier-dialog]"));
  log("  did quick-add open the modifier dialog?", modDlg);
  await shot(cash, "02q1-after-quickadd-required");
  const afterQ = await cash.evaluate(() => (document.querySelector("[role=dialog]")?.innerText ?? "").replace(/\s+/g," ").slice(0,900));
  log("  drawer after quick-add:", afterQ.slice(0,700));
  saveState({ quickAddRequiredModifier: { results: qaRes, modifierDialogOpened: modDlg, drawer: afterQ } });

  await quick.fill("Naan");
  await cash.waitForTimeout(2000);
  const addBtn = cash.getByRole("button", { name: /^Add$/ });
  log("  quick-add Add buttons:", await addBtn.count());
  if (await addBtn.count()) { await addBtn.first().click(); await cash.waitForTimeout(2500); }
  await shot(cash, "02q-late-add-pending");
  const pend = await cash.evaluate(() => {
    const d = document.querySelector("[role=dialog], [data-testid=order-drawer]") ?? document.body;
    return d.innerText.replace(/\s+/g, " ").slice(0, 900);
  });
  log("  after quick add:", pend.slice(0, 700));
  const sendNew = cash.getByRole("button", { name: /send new items/i });
  log("  'Send New Items' present:", await sendNew.count());
  if (await sendNew.count()) {
    await sendNew.first().click();
    await cash.waitForTimeout(4000);
    await shot(cash, "02r-late-add-fired");
    const afterFire = await cash.evaluate(() => {
      const d = document.querySelector("[role=dialog], [data-testid=order-drawer]") ?? document.body;
      return d.innerText.replace(/\s+/g, " ").slice(0, 900);
    });
    log("  after firing the late add:", afterFire.slice(0, 700));
    saveState({ lateAdd: afterFire });
  }
} else {
  finding({ id: "D2-LATE", sev: "high", what: "no quick-add control on the order drawer" });
}
saveState({ omRow: rowText, drawer });
await browser.close();
