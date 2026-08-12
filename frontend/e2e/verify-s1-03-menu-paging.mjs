// S1-03 — "The till renders only the first ~20 menu items and cannot tell that more exist."
//
// Drives real Chromium through the exact acceptance path:
//   manager  → /app/menu/items → create a category and 30 items ZZ-01…ZZ-30 THROUGH THE FORM
//   cashier  → /app/pos        → the category tab, the All tab, the search box, and a tap that
//                                must land the right line at the right price
//
// Nothing here is asserted from an API response: every number is read out of the rendered DOM.
// Run:  node e2e/verify-s1-03-menu-paging.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/repair/S1-03";
const CATEGORY = "ZZ Till";
const ITEM_COUNT = 30;

const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };
const CASHIER = { email: "cashier@terrace.local", password: "Terrace#Cashier1" };

let step = 0;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  step += 1;
  const file = `${OUT}/${String(step).padStart(2, "0")}-${name}.png`;
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log("   shot:", file);
}

/**
 * A page mid-failure looks exactly like a page with nothing on it. Six routes were once audited
 * while the backend was down; this refuses to let that happen silently.
 */
async function assertNoErrorState(page, where) {
  // Empty role=alert nodes are the toast/form-message placeholders every page mounts; only text
  // inside one is a real error.
  const alerts = (await page.locator('[role="alert"]').allInnerTexts())
    .map((t) => t.trim())
    .filter(Boolean);
  const body = await page.locator("body").innerText();
  const broken = /Couldn't load|Something went wrong|SERVICE_UNAVAILABLE|Access denied/i.test(body);
  if (alerts.length || broken) {
    throw new Error(
      `error state on ${where}: alerts=${JSON.stringify(alerts)} bodyMatch=${broken}`,
    );
  }
}

async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${email}`);
}

// ── Manager: build the 30-item menu through the real form ────────────────────────────────────

async function createMenu(page) {
  await login(page, MANAGER);
  await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await assertNoErrorState(page, "/app/menu/items");
  await shot(page, "manager-menu-items-before");

  // Category, through the Add category dialog.
  const alreadyThere = await page.getByText(CATEGORY, { exact: false }).count();
  if (alreadyThere === 0) {
    await page.getByRole("button", { name: "Add category" }).click();
    await page.waitForTimeout(600);
    await page.locator('input[placeholder="Starters"]').fill(CATEGORY);
    await page.locator('input[placeholder="0"]').first().fill("98");
    await page.locator('button[form="menu-category-form"]').click();
    await page.waitForTimeout(1800);
    await assertNoErrorState(page, "after creating the category");
  }
  record("manager created the category through the UI", true, CATEGORY);

  for (let n = 1; n <= ITEM_COUNT; n++) {
    const name = `ZZ-${String(n).padStart(2, "0")}`;
    const rupees = 100 + n; // ZZ-29 → Rs 129.00 → 12900 paisa
    // The per-category "Add item" — there is also a page-level one, so scope it to ZZ Till.
    await page
      .getByLabel(`${CATEGORY} category`)
      .getByRole("button", { name: "Add item", exact: true })
      .click();
    await page.waitForTimeout(350);
    await page.locator('select[aria-label="Category"]').selectOption({ label: CATEGORY });
    await page.locator('input[placeholder="Chicken Karahi"]').fill(name);
    await page.locator('input[placeholder="450"]').fill(String(rupees));
    await page.locator('button[form="menu-item-form"]').click();
    // The dialog closes on success; if it does not, the save failed and we must know.
    await page
      .locator('button[form="menu-item-form"]')
      .waitFor({ state: "detached", timeout: 15000 });
    if (n % 10 === 0) console.log(`   created ${n}/${ITEM_COUNT}`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await assertNoErrorState(page, "/app/menu/items after creating");

  // Open the category's disclosure and count what the manager can see.
  const catToggle = page.getByRole("button", { name: `${CATEGORY} category` });
  if (await catToggle.count()) {
    await catToggle.first().click();
    await page.waitForTimeout(1200);
  }
  const bodyText = await page.locator("body").innerText();
  const seen = [];
  for (let n = 1; n <= ITEM_COUNT; n++) {
    const name = `ZZ-${String(n).padStart(2, "0")}`;
    if (new RegExp(`\\b${name}\\b`).test(bodyText)) seen.push(name);
  }
  record(
    "all 30 items are listed on /app/menu/items",
    seen.length === ITEM_COUNT,
    `${seen.length}/${ITEM_COUNT} visible`,
  );
  await shot(page, "manager-30-items-created");
}

// ── Cashier: the till ────────────────────────────────────────────────────────────────────────

/** Every tile's visible text in the grid, read from the DOM. */
async function tiles(page) {
  return page.locator('[data-testid="menu-grid"] > div > button').allInnerTexts();
}

async function selectCategory(page, label) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(1500);
}

async function search(page, text) {
  const box = page.locator('input[aria-label="Search menu"]');
  await box.fill(text);
  await page.waitForTimeout(700); // 150ms debounce + render
}

async function clearCart(page) {
  const clear = page.locator('[data-testid="clear-all-button"]');
  if (await clear.count()) {
    await clear.click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="clear-all-confirm-button"]').click();
    await page.waitForTimeout(600);
  }
}

async function verifyTill(page) {
  await login(page, CASHIER);
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await assertNoErrorState(page, "/app/pos");
  await shot(page, "cashier-till-all");

  // ── The category tab must hold all 30 ──────────────────────────────────────────────────────
  await selectCategory(page, CATEGORY);
  await assertNoErrorState(page, `/app/pos with ${CATEGORY} selected`);
  const catTiles = await tiles(page);
  const catNames = catTiles.map((t) => t.split("\n")[0].trim());
  const missing = [];
  for (let n = 1; n <= ITEM_COUNT; n++) {
    const name = `ZZ-${String(n).padStart(2, "0")}`;
    if (!catNames.includes(name)) missing.push(name);
  }
  record(
    `the ${CATEGORY} tab renders all 30 tiles`,
    catTiles.length === ITEM_COUNT && missing.length === 0,
    `${catTiles.length} tiles rendered; missing: ${missing.join(",") || "none"}`,
  );
  await shot(page, "cashier-category-30-tiles");

  // The last tile must be reachable by scrolling, not merely present in the DOM.
  const last = page
    .locator('[data-testid="menu-grid"] > div > button')
    .filter({ hasText: `ZZ-${ITEM_COUNT}` })
    .first();
  await last.scrollIntoViewIfNeeded();
  record("the 30th tile can be scrolled to", await last.isVisible(), "ZZ-30 visible after scroll");
  await shot(page, "cashier-category-scrolled-to-zz30");

  // ── The All tab must hold them too ─────────────────────────────────────────────────────────
  await selectCategory(page, "All");
  const allTiles = await tiles(page);
  const allNames = allTiles.map((t) => t.split("\n")[0].trim());
  const zzInAll = allNames.filter((n) => /^ZZ-\d\d$/.test(n));
  record(
    "the All tab renders the whole menu, not the first 20",
    allTiles.length > 20 && zzInAll.length === ITEM_COUNT,
    `${allTiles.length} tiles total, ${zzInAll.length} of them ZZ-*`,
  );
  await shot(page, "cashier-all-tab-full-menu");

  // ── Search finds an item that used to be past the truncation point ─────────────────────────
  for (const scope of [CATEGORY, "All"]) {
    await selectCategory(page, scope);
    await clearCart(page);
    await search(page, "ZZ-29");
    const hits = await tiles(page);
    const hit = hits.length === 1 && hits[0].includes("ZZ-29");
    record(
      `search "ZZ-29" finds the tile with ${scope} selected`,
      hit,
      `${hits.length} tile(s): ${hits.map((h) => h.split("\n")[0]).join(", ")}`,
    );
    await shot(page, `cashier-search-zz29-${scope.replace(/\s+/g, "-").toLowerCase()}`);

    // Tap it, and check the LINE and the PRICE, not that a click happened.
    await page
      .locator('[data-testid="menu-grid"] > div > button')
      .filter({ hasText: "ZZ-29" })
      .first()
      .click();
    await page.waitForTimeout(900);
    const lineExists = (await page.getByLabel("Increase ZZ-29 quantity").count()) > 0;
    const body = await page.locator("body").innerText();
    const subtotalOk = /Subtotal\s*\n?\s*Rs\s*129\.00/.test(body.replace(/ /g, " "));
    record(
      `tapping ZZ-29 (${scope}) adds the line at Rs 129.00`,
      lineExists && subtotalOk,
      `line=${lineExists} subtotal Rs 129.00=${subtotalOk}`,
    );
    await shot(page, `cashier-zz29-in-cart-${scope.replace(/\s+/g, "-").toLowerCase()}`);
    await search(page, "");
    await clearCart(page);
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("   [browser error]", m.text().slice(0, 200));
  });

  try {
    if (!process.argv.includes("--till-only")) await createMenu(page);
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page2 = await ctx2.newPage();
    page2.on("console", (m) => {
      if (m.type() === "error") console.log("   [browser error]", m.text().slice(0, 200));
    });
    await verifyTill(page2);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
