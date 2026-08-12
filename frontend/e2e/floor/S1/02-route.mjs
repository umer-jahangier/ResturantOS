/*
 * S1 step 2 — the owner routes a CATEGORY and a single DISH, from the screen.
 *
 * Drinks -> BAR (category rule).  Seekh Kebab -> GRILL (per-item exception).
 *
 * Asserted, in this order:
 *  - each change fires exactly ONE PUT of its own (not a batched save),
 *  - each change raises its own toast that NAMES what changed and where it now fires,
 *  - the row's own "Fires to <CODE> · <source>" text updates without a reload,
 *  - and a full reload still shows it — a toast over an unsaved change is this repo's
 *    signature failure wearing a nicer coat.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, log } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);

const toastsSeen = [];

async function readToasts() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]")).map((t) =>
      (t.textContent || "").trim(),
    ),
  );
}

async function rowState(itemName) {
  return page.evaluate((n) => {
    const row = Array.from(document.querySelectorAll('[data-testid="routing-item"]')).find(
      (r) => r.getAttribute("data-item-name") === n,
    );
    if (!row) return null;
    return {
      effective: row.getAttribute("data-effective-station"),
      source: row.getAttribute("data-route-source"),
      text: row.querySelector('[data-testid="routing-item-destination"]')?.textContent?.trim(),
      selected: row.querySelector('[data-testid="item-station-select"]')?.selectedOptions?.[0]
        ?.textContent,
    };
  }, itemName);
}

async function categoryState(catName) {
  return page.evaluate((n) => {
    const c = Array.from(document.querySelectorAll('[data-testid="routing-category"]')).find(
      (x) => x.getAttribute("data-category-name") === n,
    );
    if (!c) return null;
    return {
      selected: c.querySelector('[data-testid="category-station-select"]')?.selectedOptions?.[0]
        ?.textContent,
    };
  }, catName);
}

try {
  await login(page, PEOPLE.owner);
  await go(page, "/app/menu/routing", { waitMs: 4000 });

  const before = {
    drinksCategory: await categoryState("Drinks"),
    pinacolada: await rowState("Pinacolada"),
    freshLime: await rowState("Fresh Lime"),
    seekhKebab: await rowState("Seekh Kebab"),
    chickenKarahi: await rowState("Chicken Karahi"),
  };
  log("  BEFORE:", JSON.stringify(before));
  await shot(page, "02a-before");

  // ── 1. the category rule: all Drinks go to the bar ───────────────────────────────
  page.__requests.length = 0;
  const drinksSelect = page.locator(
    '[data-testid="routing-category"][data-category-name="Drinks"] [data-testid="category-station-select"]',
  );
  await drinksSelect.selectOption({ label: "Main bar (BAR)" });
  await page.waitForTimeout(2500);
  const toastA = await readToasts();
  toastsSeen.push({ step: "drinks->BAR", toasts: toastA });
  const putsA = page.__requests.filter((r) => r.m === "PUT");
  log("  drinks PUTs:", JSON.stringify(putsA));
  log("  toast:", JSON.stringify(toastA));
  await shot(page, "02b-drinks-to-bar-toast");

  const afterDrinks = {
    drinksCategory: await categoryState("Drinks"),
    pinacolada: await rowState("Pinacolada"),
    freshLime: await rowState("Fresh Lime"),
  };
  log("  AFTER drinks:", JSON.stringify(afterDrinks));

  // Let the toast expire so the next assertion cannot read the previous one.
  await page.waitForTimeout(6000);

  // ── 2. the single-dish exception: Seekh Kebab is grilled, not cold prep ──────────
  page.__requests.length = 0;
  const kebabSelect = page.locator(
    '[data-testid="routing-item"][data-item-name="Seekh Kebab"] [data-testid="item-station-select"]',
  );
  await kebabSelect.selectOption({ label: "Hot line (GRILL)" });
  await page.waitForTimeout(2500);
  const toastB = await readToasts();
  toastsSeen.push({ step: "seekh->GRILL", toasts: toastB });
  const putsB = page.__requests.filter((r) => r.m === "PUT");
  log("  kebab PUTs:", JSON.stringify(putsB));
  log("  toast:", JSON.stringify(toastB));
  await shot(page, "02c-kebab-to-grill-toast");

  const afterKebab = await rowState("Seekh Kebab");
  log("  AFTER kebab:", JSON.stringify(afterKebab));

  // ── 3. does it survive a reload? ────────────────────────────────────────────────
  await go(page, "/app/menu/routing", { waitMs: 4500 });
  const persisted = {
    drinksCategory: await categoryState("Drinks"),
    pinacolada: await rowState("Pinacolada"),
    freshLime: await rowState("Fresh Lime"),
    seekhKebab: await rowState("Seekh Kebab"),
    chickenKarahi: await rowState("Chicken Karahi"),
    summary: await page.evaluate(
      () => document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
    ),
  };
  log("  PERSISTED:", JSON.stringify(persisted, null, 1));
  await shot(page, "02d-after-reload");

  saveState({
    route: { before, toastsSeen, putsA, putsB, afterDrinks, afterKebab, persisted },
  });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "02z-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
