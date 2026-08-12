/*
 * S1-01 REPRODUCTION — "No screen anywhere routes a dish or a category to a station."
 *
 * Signs in as the tenant admin (the persona the DONE MEANS names) and, WITHOUT typing a route,
 * enumerates every sidebar link. Then probes the three routes the register says 404, and reads
 * the item/category action menus for any routing affordance.
 *
 * Run: node e2e/repair/s1-01-repro.mjs
 */
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./s1-01-lib.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

try {
  await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  console.log("signed in →", page.url());

  // ── 1. What does the sidebar actually offer? ────────────────────────────────────────────
  await openAndCheck(page, "/app/dashboard");
  const navLinks = await page
    .locator("nav a, aside a")
    .evaluateAll((els) => els.map((e) => `${e.textContent.trim()} → ${e.getAttribute("href")}`));
  const unique = [...new Set(navLinks)].filter(Boolean);
  console.log(`\nSIDEBAR (${unique.length} links):`);
  for (const l of unique) console.log("   ", l);
  const routingEntry = unique.find((l) => /rout|station/i.test(l));
  console.log("=> a routing/station nav entry:", routingEntry ?? "NONE");
  await shot(page, "before-01-sidebar");

  // ── 2. The routes the register says do not exist ────────────────────────────────────────
  console.log("\nCANDIDATE ROUTES:");
  for (const p of ["/app/menu/routing", "/app/menu/stations", "/app/settings/stations"]) {
    const r = await openAndCheck(page, p, { settle: 1800 });
    console.log(`  ${p} -> h1="${r.h1}" missing=${r.missing} denied=${r.denied} failed=${r.failed}`);
  }

  // ── 3. Item + category action menus on /app/menu/items ──────────────────────────────────
  await openAndCheck(page, "/app/menu/items");
  const itemBtn = page.getByRole("button", { name: /^Actions for /i });
  const names = await itemBtn.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  console.log(`\naction-menu triggers on /app/menu/items: ${names.length}`);
  const drinksCat = names.find((n) => /Actions for Drinks$/i.test(n));
  console.log("  Drinks CATEGORY trigger:", drinksCat ?? "NONE");

  if (drinksCat) {
    await page.getByRole("button", { name: drinksCat, exact: true }).click();
    await page.waitForTimeout(800);
    const entries = await page.getByRole("menuitem").allInnerTexts();
    console.log("  CATEGORY action menu:", JSON.stringify(entries));
    console.log(
      "  => category routing entry:",
      entries.find((e) => /station|route/i.test(e)) ?? "NONE",
    );
    await shot(page, "before-02-category-action-menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  const firstItem = names.find((n) => n && !/Actions for (Drinks|Starters|Mains|Soft Drinks)$/i.test(n));
  if (firstItem) {
    await page.getByRole("button", { name: firstItem, exact: true }).click();
    await page.waitForTimeout(800);
    const entries = await page.getByRole("menuitem").allInnerTexts();
    console.log(`  ITEM action menu (${firstItem}):`, JSON.stringify(entries));
    console.log("  => item routing entry:", entries.find((e) => /station|route/i.test(e)) ?? "NONE");
    await page.getByRole("menuitem", { name: /^Edit$/i }).first().click();
    await page.waitForTimeout(1500);
    const dlg = page.locator('[role="dialog"]').first();
    const labels = await dlg.locator("label").allInnerTexts().catch(() => []);
    console.log("  EDIT ITEM dialog fields:", JSON.stringify(labels));
    await shot(page, "before-03-item-edit-dialog");
    await page.keyboard.press("Escape");
  }

  // ── 4. What does the API say every item's destination is? ───────────────────────────────
  const api = await page.evaluate(async () => {
    const res = await fetch("/api/v1/pos/menu/items?size=200", { credentials: "include" });
    const json = await res.json().catch(() => null);
    const rows = json?.data ?? [];
    return {
      status: res.status,
      count: rows.length,
      routed: rows.filter((r) => r.effectiveStationCode).length,
      sample: rows.slice(0, 5).map((r) => `${r.name}: ${r.effectiveStationCode ?? "null"}`),
    };
  });
  console.log("\nGET /api/v1/pos/menu/items →", JSON.stringify(api, null, 2));
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-repro-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
