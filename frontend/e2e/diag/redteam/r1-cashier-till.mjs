import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";

const { browser, page } = await newBrowser();
const ok = await login(page, P.cashier);
if (!ok) { await shot(page, "r1-login-fail"); await browser.close(); process.exit(1); }

await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await healthCheck(page, "pos");
await shot(page, "r1-01-pos-terminal");

// ---- till state
const till = await page.evaluate(() => ({
  tillClosed: !!document.querySelector('[data-testid="pos-till-closed-notice"]'),
  bar: document.body.innerText.slice(0, 400),
}));
console.log("TILL CLOSED NOTICE:", till.tillClosed);
if (till.tillClosed) console.log("TILL TEXT:", till.bar.replace(/\n/g, " | ").slice(0,300));

// ---- menu grid: images?
const grid = await page.evaluate(() => {
  const g = document.querySelector('[data-testid="menu-grid"]');
  if (!g) return { found: false };
  const tiles = g.querySelectorAll(":scope > div");
  const withBg = [...g.querySelectorAll("*")].filter((e) => getComputedStyle(e).backgroundImage !== "none").length;
  return {
    found: true,
    tiles: tiles.length,
    imgs: g.querySelectorAll("img").length,
    svgs: g.querySelectorAll("svg").length,
    bgImages: withBg,
    firstTileHTML: tiles[0]?.outerHTML.slice(0, 420),
    names: [...g.querySelectorAll("button span")].map((s)=>s.textContent).slice(0, 12),
  };
});
console.log("MENU GRID:", JSON.stringify(grid, null, 1));

// search for the photo dish specifically
await page.locator('input[aria-label="Search menu"]').fill("Photo");
await page.waitForTimeout(1200);
const photo = await page.evaluate(() => {
  const g = document.querySelector('[data-testid="menu-grid"]');
  return { html: g?.innerHTML.slice(0, 800), imgs: g?.querySelectorAll("img").length };
});
console.log("PHOTO DISH SEARCH:", JSON.stringify(photo));
await shot(page, "r1-02-photo-dish-search");
await page.locator('button[aria-label="Clear search"]').click().catch(()=>{});
await page.waitForTimeout(800);

// ---- tap first item; does a modifier dialog appear?
const before = await page.locator('[role="dialog"]').count();
await page.locator('[data-testid="menu-item-first"]').click();
await page.waitForTimeout(1800);
const after = await page.evaluate(() => ({
  dialogs: document.querySelectorAll('[role="dialog"]').length,
  panelText: document.body.innerText.slice(-1400),
}));
console.log("MODIFIER PROMPT AFTER TAP? before=", before, "after=", after.dialogs);
await shot(page, "r1-03-after-first-tap");

// ---- order type radiogroup
const types = await page.evaluate(() => {
  const rg = document.querySelector('[role="radiogroup"][aria-label="Order type"]');
  if (!rg) return null;
  return [...rg.querySelectorAll('[role="radio"]')].map((r) => ({ label: r.textContent.trim(), checked: r.getAttribute("aria-checked") }));
});
console.log("ORDER TYPES:", JSON.stringify(types));

// ---- pre-send controls: any note / discount / price-override?
const controls = await page.evaluate(() => {
  const panel = document.querySelector('[data-testid="send-to-kitchen-button"]')?.closest(".flex.flex-col.h-full.min-h-0");
  const scope = panel ?? document.body;
  return [...scope.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()).filter(Boolean);
});
console.log("PRE-SEND PANEL BUTTONS:", JSON.stringify(controls));

// ---- anything anywhere on the terminal mentioning discount / modifier / variant / split?
const words = await page.evaluate(() => {
  const t = document.body.innerText.toLowerCase();
  return ["discount", "modifier", "variant", "half", "split", "delivery", "coupon", "promo", "comp", "open item", "misc"].map((w) => [w, t.includes(w)]);
});
console.log("TERMINAL VOCAB:", JSON.stringify(words));

await browser.close();
