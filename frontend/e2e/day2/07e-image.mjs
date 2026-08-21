/* DAY 2 — 7e: upload a dish photo and confirm it reaches the POS grid; and confirm the
 * branch edit persisted. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, PEOPLE, login } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const S = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const out = {};

// branch edit, read back over HTTP
const br = await apiGet(owner, "/api/v1/branches");
const rows = br.body?.data ?? br.body ?? [];
const mine = (Array.isArray(rows) ? rows : []).filter((b) => /Day2 Terrace/.test(b.name ?? ""));
log("  branches named Day2:", JSON.stringify(mine).slice(0, 700));
out.branchReadBack = mine;

// ── the dish photo ───────────────────────────────────────────────────────────
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAV0lEQVR42u3QMQEAAAgDoC251a3g" +
  "LWSgmXBpREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREQuLQ1UAAHIeGvVAAAAAElFTkSuQmCC",
  "base64",
);
const IMG = "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad/day2-dish.png";
writeFileSync(IMG, PNG);

let tr = await go(owner, "/app/menu/items", { waitMs: 8000 });
log("  /app/menu/items trouble:", JSON.stringify(tr.bad));
await shot(owner, "07q-menu-items");
// open the first item's editor
const editors = await owner.evaluate(() => ({
  btns: Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean).slice(0, 30),
  rows: Array.from(document.querySelectorAll("tr")).slice(0, 4).map((r) => r.innerText.replace(/\s*\n\s*/g, " | ").slice(0, 200)),
}));
log("  menu items screen:", JSON.stringify(editors, null, 1).slice(0, 1200));

const actions = owner.locator('[aria-label^="Actions for "]').filter({ hasNotText: "category" });
const names = await owner.evaluate(() => Array.from(document.querySelectorAll('[aria-label^="Actions for "]')).map((b) => b.getAttribute("aria-label")).slice(0, 12));
log("  action menus:", JSON.stringify(names));
const itemMenu = owner.locator('[aria-label="Actions for Photo Dish 50585"]');
const useMenu = (await itemMenu.count()) ? itemMenu : owner.locator(`[aria-label="${names.find((n) => !/category/.test(n))}"]`);
if (await useMenu.count()) {
  await useMenu.first().click();
  await owner.waitForTimeout(1200);
  await owner.getByRole("menuitem", { name: /edit/i }).first().click();
  await owner.waitForTimeout(3000);
  await shot(owner, "07r-item-editor");
  const dlgName = await owner.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    return d ? { name: d.querySelector("input")?.value ?? null, hasImage: !!d.querySelector("[data-testid=menu-item-image]"),
      choose: !!d.querySelector("[data-testid=menu-item-image-choose]"),
      empty: d.querySelector("[data-testid=menu-item-image-empty]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
      text: d.innerText.replace(/\s+/g, " ").slice(0, 500) } : null;
  });
  log("  item editor:", JSON.stringify(dlgName).slice(0, 800));
  out.itemEditor = dlgName;
  const input = owner.locator("[data-testid=menu-item-image-input]");
  log("  file input present:", await input.count());
  if (await input.count()) {
    await input.setInputFiles(IMG);
    await owner.waitForTimeout(6000);
    await shot(owner, "07s-image-uploaded");
    const up = await owner.evaluate(() => ({
      preview: !!document.querySelector("[data-testid=menu-item-image-preview]"),
      previewSrc: document.querySelector("[data-testid=menu-item-image-preview] img, img[data-testid=menu-item-image-preview]")?.getAttribute("src")?.slice(0, 120) ?? null,
      err: document.querySelector("[data-testid=menu-item-image-error-message]")?.innerText.trim() ?? null,
    }));
    log("  after upload:", JSON.stringify(up));
    out.upload = up;
    const save = owner.locator("[role=dialog] button").filter({ hasText: /^Save|^Update/i });
    if (await save.count()) { await save.last().click(); await owner.waitForTimeout(5000); }
    await shot(owner, "07t-item-saved");
    out.savedItemName = dlgName?.name;
  }
}

// does it reach the POS grid?
if (out.savedItemName) {
  await go(owner, "/app/pos", { waitMs: 9000 });
  const search = owner.locator('input[placeholder*="Search menu" i]').first();
  if (await search.count()) {
    await search.fill(out.savedItemName);
    await owner.waitForTimeout(2500);
    const tile = await owner.evaluate(() => {
      const b = document.querySelector('[data-testid="menu-grid"] button[aria-pressed]');
      if (!b) return null;
      const img = b.querySelector("img");
      return { text: b.innerText.replace(/\s+/g, " ").trim(), hasImg: !!img, src: img?.getAttribute("src")?.slice(0, 140) ?? null,
        bg: getComputedStyle(b.querySelector("div") ?? b).backgroundImage.slice(0, 120) };
    });
    log("  POS TILE:", JSON.stringify(tile));
    out.posTile = tile;
    await shot(owner, "07u-pos-tile-with-photo");
  }
}
saveState({ newScreens4: out });
await browser.close();
