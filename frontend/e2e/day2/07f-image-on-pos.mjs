/* DAY 2 — 7e proof: the photo I uploaded must be on the cashier's POS tile. */
import { newBrowser, newPage, go, shot, saveState, loadState, log, BASE, apiGet, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();

const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const items = await apiGet(mgr, "/api/v1/pos/menu/items?size=200");
const rows = items.body?.data ?? [];
const photo = rows.find((r) => r.name === "Photo Dish 50585");
log("  server row for Photo Dish 50585:", JSON.stringify({ id: photo?.id, imageFileId: photo?.imageFileId, imageUrl: (photo?.imageUrl ?? "").slice(0, 140) }));

const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const sl = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await sl.count()) await sl.first().fill(NEW.slug);
await cash.locator('input[name="email"]').first().fill(NEW.email);
await cash.locator('input[name="password"]').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);
await go(cash, "/app/pos", { waitMs: 9000 });
const search = cash.locator('input[placeholder*="Search menu" i]').first();
await search.fill("Photo Dish 50585");
await cash.waitForTimeout(2500);
const tile = await cash.evaluate(() => {
  const b = document.querySelector('[data-testid="menu-grid"] button[aria-pressed]');
  if (!b) return null;
  const img = b.querySelector("img");
  return {
    text: b.innerText.replace(/\s+/g, " ").trim(),
    hasImg: !!img,
    src: img?.getAttribute("src")?.slice(0, 160) ?? null,
    naturalW: img?.naturalWidth ?? null,
    naturalH: img?.naturalHeight ?? null,
    complete: img?.complete ?? null,
  };
});
log("  POS TILE:", JSON.stringify(tile));
await shot(cash, "07u-pos-tile-with-photo");
saveState({ photoOnPos: { server: { id: photo?.id, imageFileId: photo?.imageFileId }, tile } });
await browser.close();
