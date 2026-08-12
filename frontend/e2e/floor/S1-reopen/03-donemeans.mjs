/*
 * S1 RE-OPEN 03 — I drive the DONE MEANS myself, with a DIFFERENT dish than the claimant used,
 * and I clear the category route first so I am not reading their leftover state.
 *
 * Also dumps every option the station selects offer — the claim never checked what is in them.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, log, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const page = await newPage(browser);
const findings = {};

async function toasts() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]")).map((t) => (t.textContent || "").trim()),
  );
}
async function rowState(name) {
  return page.evaluate((n) => {
    const row = Array.from(document.querySelectorAll('[data-testid="routing-item"]')).find(
      (r) => r.getAttribute("data-item-name") === n,
    );
    if (!row) return null;
    return {
      effective: row.getAttribute("data-effective-station"),
      source: row.getAttribute("data-route-source"),
      text: row.querySelector('[data-testid="routing-item-destination"]')?.textContent?.replace(/\s+/g, " ").trim(),
      selected: row.querySelector('[data-testid="item-station-select"]')?.selectedOptions?.[0]?.textContent,
    };
  }, name);
}
async function catState(name) {
  return page.evaluate((n) => {
    const c = Array.from(document.querySelectorAll('[data-testid="routing-category"]')).find(
      (x) => x.getAttribute("data-category-name") === n,
    );
    if (!c) return null;
    const sel = c.querySelector('[data-testid="category-station-select"]');
    return { selected: sel?.selectedOptions?.[0]?.textContent ?? null };
  }, name);
}

try {
  await login(page, PEOPLE.owner);
  const t = await go(page, "/app/menu/routing", { waitMs: 5000 });
  log("routing page:", JSON.stringify(t));

  // ── what do the selects actually offer? ────────────────────────────────────────
  const options = await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('[data-testid="routing-category"]')).find(
      (x) => x.getAttribute("data-category-name") === "Drinks",
    );
    const sel = c?.querySelector('[data-testid="category-station-select"]');
    return Array.from(sel?.options ?? []).map((o) => ({ label: o.textContent.trim(), value: o.value }));
  });
  log("Drinks category select offers:", JSON.stringify(options, null, 1));
  findings.categorySelectOptions = options;

  // ── 1. CLEAR the Drinks route so I am not reading leftover state ───────────────
  page.__requests.length = 0;
  await page
    .locator('[data-testid="routing-category"][data-category-name="Drinks"] [data-testid="category-station-select"]')
    .selectOption({ label: "Not routed — DEFAULT board" });
  await page.waitForTimeout(3000);
  const clearToast = await toasts();
  const clearPuts = page.__requests.filter((r) => r.m === "PUT");
  log("CLEAR Drinks -> toasts:", JSON.stringify(clearToast), "PUTs:", JSON.stringify(clearPuts));
  log("  Pinacolada now:", JSON.stringify(await rowState("Pinacolada")));
  findings.clear = { toasts: clearToast, puts: clearPuts, pinacolada: await rowState("Pinacolada") };
  await shot(page, "03a-drinks-cleared");

  // ── 2. SET Drinks -> BAR ───────────────────────────────────────────────────────
  page.__requests.length = 0;
  await page
    .locator('[data-testid="routing-category"][data-category-name="Drinks"] [data-testid="category-station-select"]')
    .selectOption({ label: "Main bar (BAR)" });
  await page.waitForTimeout(3000);
  const setToast = await toasts();
  const setPuts = page.__requests.filter((r) => r.m === "PUT");
  log("SET Drinks->BAR toasts:", JSON.stringify(setToast));
  log("  PUTs:", JSON.stringify(setPuts));
  log("  Pinacolada now:", JSON.stringify(await rowState("Pinacolada")));
  findings.setCategory = { toasts: setToast, puts: setPuts, pinacolada: await rowState("Pinacolada") };
  await shot(page, "03b-drinks-bar");

  // ── 3. a DIFFERENT dish than the claimant's: Chicken Samosa (Starters) -> GRILL ─
  page.__requests.length = 0;
  await page
    .locator('[data-testid="routing-item"][data-item-name="Chicken Samosa"] [data-testid="item-station-select"]')
    .selectOption({ label: "Hot line (GRILL)" });
  await page.waitForTimeout(3000);
  const itemToast = await toasts();
  const itemPuts = page.__requests.filter((r) => r.m === "PUT");
  log("SET Chicken Samosa->GRILL toasts:", JSON.stringify(itemToast));
  log("  PUTs:", JSON.stringify(itemPuts));
  const samosaAfter = await rowState("Chicken Samosa");
  log("  Chicken Samosa now:", JSON.stringify(samosaAfter));
  findings.setItem = { toasts: itemToast, puts: itemPuts, row: samosaAfter };
  await shot(page, "03c-samosa-grill");

  // ── 4. reload: does it PERSIST? ────────────────────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const persisted = {
    drinksCategory: await catState("Drinks"),
    pinacolada: await rowState("Pinacolada"),
    freshLime: await rowState("Fresh Lime"),
    chickenSamosa: await rowState("Chicken Samosa"),
    otherStarter: await rowState("Audit Item 52235"),
  };
  log("AFTER RELOAD:", JSON.stringify(persisted, null, 1));
  findings.afterReload = persisted;
  await shot(page, "03d-after-reload");

  writeFileSync(`${OUT}/03-findings.json`, JSON.stringify(findings, null, 2));
  saveState({ donemeans: findings });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "03z-failure");
  writeFileSync(`${OUT}/03-findings.json`, JSON.stringify({ ...findings, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
