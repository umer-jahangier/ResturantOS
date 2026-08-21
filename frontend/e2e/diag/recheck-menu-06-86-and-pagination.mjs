// RECHECK — two headline claims:
//  (a) 86-ing a dish does not reach a till that is already open
//  (b) the POS grid silently truncates at the 20th active item
// Reversible: reactivates the 15 pre-existing ZZPAGE probe items, measures, deactivates again.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

async function token(email, password) {
  const r = await fetch(`${GW}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenantSlug: "floating-terrace" }),
  });
  return (await r.json()).data.accessToken;
}
async function api(tok, path, method = "GET") {
  const r = await fetch(`${GW}${path}`, { method, headers: { Authorization: `Bearer ${tok}` } });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace");
  await page.locator('input#email, input[name="email"]').first().fill(email);
  await page.locator('input#password, input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  log("   login ->", page.url());
}

const gridState = (page) => page.evaluate(() => {
  const g = document.querySelector('[data-testid="menu-grid"]');
  return {
    tiles: g ? g.querySelectorAll("button[aria-pressed]").length : -1,
    names: g ? [...g.querySelectorAll("button[aria-pressed]")].map((b) => b.innerText.split("\n")[0]) : [],
  };
});

async function main() {
  const mgr = await token("manager@terrace.local", "Terrace#Manager1");
  const items = (await api(mgr, "/api/v1/pos/menu/items/admin")).body.data;
  const probes = items.filter((i) => i.name.startsWith("ZZPAGE Probe"));
  const activeNow = items.filter((i) => i.active);
  log(`0. tenant state: ${items.length} items, ${activeNow.length} active, ${probes.length} ZZPAGE probes (all inactive: ${probes.every((p) => !p.active)})`);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await login(page, "cashier@terrace.local", "Terrace#Cashier1");
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  // ================= (a) 86 propagation =================
  const before = await gridState(page);
  log("A1. cashier grid BEFORE 86:", JSON.stringify(before));
  await page.screenshot({ path: `${OUT}/R50-cashier-before-86.png` });

  const victim = activeNow.find((i) => i.name === "Pinacolada") ?? activeNow[0];
  log(`A2. manager 86s "${victim.name}" (${victim.id}) via the same API the admin screen calls`);
  log("    deactivate ->", (await api(mgr, `/api/v1/pos/menu/items/${victim.id}/deactivate`, "PATCH")).status);

  // wait WITHOUT reloading — an open till in a real service does not get reloaded
  for (const wait of [5000, 15000, 30000]) {
    await page.waitForTimeout(wait);
    const s = await gridState(page);
    log(`A3. cashier grid after ~${wait}ms, NO reload: tiles=${s.tiles} stillShows86ed=${s.names.includes(victim.name)}`);
  }
  await page.screenshot({ path: `${OUT}/R51-cashier-after-86-noreload.png` });

  // now click a different category chip and back — does a refetch happen?
  const chips = page.locator('button:has-text("Mains"), button:has-text("All")');
  if (await chips.count()) {
    await page.getByRole("button", { name: "Mains", exact: true }).click().catch(() => {});
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "All", exact: true }).click().catch(() => {});
    await page.waitForTimeout(2500);
    const s = await gridState(page);
    log(`A4. after switching category chips: tiles=${s.tiles} stillShows86ed=${s.names.includes(victim.name)}`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const after = await gridState(page);
  log(`A5. after a HARD RELOAD: tiles=${after.tiles} stillShows86ed=${after.names.includes(victim.name)}`);
  await page.screenshot({ path: `${OUT}/R52-cashier-after-86-reload.png` });

  log("A6. restoring:", (await api(mgr, `/api/v1/pos/menu/items/${victim.id}/activate`, "PATCH")).status);

  // ================= (b) 20-item cap =================
  log("B1. reactivating 15 pre-existing ZZPAGE probes to push active count over 20");
  for (const p of probes) await api(mgr, `/api/v1/pos/menu/items/${p.id}/activate`, "PATCH");
  const nowActive = (await api(mgr, "/api/v1/pos/menu/items/admin")).body.data.filter((i) => i.active).length;
  const posReturns = (await api(mgr, "/api/v1/pos/menu/items")).body.data.length;
  log(`B2. active items now = ${nowActive}; GET /pos/menu/items (no size, exactly what the grid sends) returns ${posReturns}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const capped = await gridState(page);
  log(`B3. CASHIER GRID shows ${capped.tiles} tiles out of ${nowActive} active items`);
  log("B4. names on screen:", JSON.stringify(capped.names));
  const missing = (await api(mgr, "/api/v1/pos/menu/items/admin")).body.data
    .filter((i) => i.active).map((i) => i.name).filter((n) => !capped.names.includes(n));
  log(`B5. ACTIVE BUT UNSELLABLE (on the menu, not on the till): ${missing.length} -> ${JSON.stringify(missing)}`);
  await page.screenshot({ path: `${OUT}/R53-pos-truncated.png`, fullPage: true });

  // search for one of the hidden items — does client-side search rescue it?
  if (missing.length) {
    await page.getByRole("textbox", { name: /Search menu/i }).fill(missing[0]);
    await page.waitForTimeout(2000);
    const searched = await gridState(page);
    log(`B6. searching the till for "${missing[0]}" (an ACTIVE item): tiles=${searched.tiles} found=${searched.names.includes(missing[0])}`);
    log("    on-screen message:", await page.evaluate(() => document.body.innerText.match(/No items match your search|No items available/)?.[0] ?? "(none)"));
    await page.screenshot({ path: `${OUT}/R54-pos-search-hidden-item.png` });
  }

  log("B7. cleanup — deactivating the 15 probes again");
  for (const p of probes) await api(mgr, `/api/v1/pos/menu/items/${p.id}/deactivate`, "PATCH");
  const finalActive = (await api(mgr, "/api/v1/pos/menu/items/admin")).body.data.filter((i) => i.active);
  log(`B8. final active count = ${finalActive.length}:`, JSON.stringify(finalActive.map((i) => i.name)));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
