/*
 * SHIFT STEP 2c — the second check, and a late add on the first.
 *
 *  d. A TAKEAWAY check: two dishes, fired.
 *  e. Table H1 asks for one more dish after the mains have gone. The cashier opens the
 *     live check from Order Management and rings it on — then fires the new line.
 */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, BASE } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

async function loginNewCashier(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(NEW.email);
  await page.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error("login failed");
  log("  ✓", NEW.email);
}

const cash = await newPage(browser);
await loginNewCashier(cash);

// ── 2d. TAKEAWAY ──────────────────────────────────────────────────────────────
log("\n=== 2d. takeaway check ===");
await go(cash, "/app/pos", { waitMs: 7000 });
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(600);
const tableAfterTakeaway = await cash.evaluate(() => {
  const trg = document.querySelector("[data-testid=table-select-trigger]");
  return { present: !!trg, text: trg?.innerText?.replace(/\s+/g, " ").trim() ?? null };
});
log("  table picker while TAKEAWAY is selected:", JSON.stringify(tableAfterTakeaway));

const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
await tiles.nth(3).click();
await cash.waitForTimeout(250);
await tiles.nth(4).click();
await cash.waitForTimeout(700);
const cart2 = await cash.evaluate(() => {
  const t = document.body.innerText;
  return {
    lines: Array.from(
      document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]'),
    ).map((n) => n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, "")),
    subtotal: /Subtotal\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    tax: /Tax \(est\.\)\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    total: /Total \(est\.\)\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    typeChecked: Array.from(document.querySelectorAll("[role=radio]"))
      .filter((b) => b.getAttribute("aria-checked") === "true")
      .map((b) => b.textContent.trim()),
  };
});
log("  takeaway cart:", JSON.stringify(cart2));
await shot(cash, "02j-order2-takeaway-cart");
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(6500);
const after2 = await cash.evaluate(() => ({
  nos: Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
}));
log("  after fire:", JSON.stringify(after2));
await shot(cash, "02k-order2-fired");
const order2No = after2.nos.find((n) => n !== st.order1No) ?? after2.nos[0];
saveState({ order2No, order2Cart: cart2 });
log("  order 2 =", order2No);

// ── 2e. late add on order 1 ───────────────────────────────────────────────────
log("\n=== 2e. table H1 wants one more dish, after the mains went ===");
await go(cash, "/app/pos", { waitMs: 6000 });
// switch to the Orders tab
const tabs = await cash.evaluate(() =>
  Array.from(document.querySelectorAll("[role=tab], button")).map((b) => b.textContent.trim()).filter((t) => /order|table|menu|floor/i.test(t) && t.length < 30).slice(0, 12),
);
log("  tabs on /app/pos:", JSON.stringify(tabs));
const ordersTab = cash.getByRole("tab", { name: /order/i });
if (await ordersTab.count()) {
  await ordersTab.first().click();
  await cash.waitForTimeout(4000);
}
await shot(cash, "02l-order-management");

const searchBox = cash.locator("[data-testid=order-management-search]");
if (await searchBox.count()) {
  await searchBox.first().fill(st.order1No);
  await cash.waitForTimeout(3500);
}
await shot(cash, "02m-searched-order1");
const rowProbe = await cash.evaluate((no) => {
  const t = document.body.innerText;
  const idx = t.indexOf(no);
  return {
    found: idx >= 0,
    row: idx >= 0 ? t.slice(idx - 60, idx + 240).replace(/\s+/g, " ") : null,
    openButtons: Array.from(document.querySelectorAll('[data-testid^="open-order-"]')).length,
  };
}, st.order1No);
log("  search result:", JSON.stringify(rowProbe));

const openBtn = cash.locator('[data-testid^="open-order-"]').first();
if (await openBtn.count()) {
  await openBtn.click();
  await cash.waitForTimeout(3500);
}
await shot(cash, "02n-order1-drawer");
const drawer = await cash.evaluate(() => {
  const d = document.querySelector("[data-testid=order-table-detail-drawer]");
  return d ? d.innerText.replace(/\s+/g, " ").trim().slice(0, 900) : null;
});
log("  drawer:", drawer);

// ring one more dish through Quick Add
const qa = cash.getByLabel("Search menu");
if (await qa.count()) {
  await qa.first().fill("Naan");
  await cash.waitForTimeout(2500);
  await shot(cash, "02o-quick-add-results");
  const addBtns = cash.locator("[data-testid=quick-add-results] button");
  log("  quick-add results:", await addBtns.count());
  if (await addBtns.count()) {
    await addBtns.first().click();
    await cash.waitForTimeout(3000);
  }
}
await shot(cash, "02p-late-item-added");
const afterAdd = await cash.evaluate(() => {
  const d = document.querySelector("[data-testid=order-table-detail-drawer]");
  return {
    drawer: d ? d.innerText.replace(/\s+/g, " ").trim().slice(0, 900) : null,
    sendNew: document.querySelector("[data-testid=send-new-items-button]")?.textContent?.trim() ?? null,
  };
});
log("  after add:", JSON.stringify(afterAdd, null, 1));
saveState({ lateAddDrawer: afterAdd });

if (afterAdd.sendNew) {
  await cash.locator("[data-testid=send-new-items-button]").click();
  await cash.waitForTimeout(5000);
  await shot(cash, "02q-late-item-fired");
  const post = await cash.evaluate(() => {
    const d = document.querySelector("[data-testid=order-table-detail-drawer]");
    return {
      drawer: d ? d.innerText.replace(/\s+/g, " ").trim().slice(0, 900) : null,
      sendNew: document.querySelector("[data-testid=send-new-items-button]")?.textContent?.trim() ?? null,
      alerts: Array.from(document.querySelectorAll('[role=alert]')).map((n) => n.innerText.trim()),
    };
  });
  log("  after Send New Items:", JSON.stringify(post, null, 1));
  saveState({ lateAddFired: post });
} else {
  finding({
    id: "SHIFT-LATEADD",
    sev: "S1",
    what: "a line rung onto a fired check offered no 'Send New Items' control",
    evidence: afterAdd,
  });
}

await browser.close();
log("\nstep 2c done");
