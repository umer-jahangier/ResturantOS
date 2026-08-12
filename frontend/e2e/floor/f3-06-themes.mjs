/*
 * The KDS surface is permanently dark regardless of the office manager's theme (§3.7), so the
 * requirement here is that the NEW elements render IDENTICALLY in light and dark — and legibly
 * in both. Computed style, never the class list: cn()/tailwind-merge has silently dropped
 * utility classes in this repo before.
 */
import { newBrowser, newPage, login, PEOPLE } from "../shift/lib.mjs";
import { go, shot, waitForPicker, waitForBoard } from "./f3-lib.mjs";

const STATION = process.argv[2] ?? "PANTRY1";
const browser = await newBrowser();
const out = {};
let bad = 0;

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.__console = [];
  page.__requests = [];
  page.on("response", (r) => {
    if (r.url().startsWith("http://localhost:8080")) page.__requests.push({ s: r.status(), u: r.url() });
  });
  await login(page, PEOPLE.kitchen);

  await go(page, "/app/kitchen", { waitMs: 2000 });
  await waitForPicker(page);
  await shot(page, `21-picker-${scheme}`);
  const picker = await page.evaluate((code) => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.innerText.trim(), color: cs.color, fontSize: cs.fontSize, transform: cs.textTransform };
    };
    const tile = document.querySelector(`[data-testid="station-tile-${code}"]`);
    return {
      tickets: g(`[data-testid="station-tickets-${code}"]`),
      items: g(`[data-testid="station-items-${code}"]`),
      caption: g(`[data-testid="station-breakdown-caption-${code}"]`),
      tileBg: tile ? getComputedStyle(tile).backgroundColor : null,
      surfaceBg: getComputedStyle(document.querySelector('[data-surface="kds"]')).backgroundColor,
    };
  }, STATION);

  await go(page, `/app/kitchen/${STATION}`, { waitMs: 1500 });
  await waitForBoard(page);
  await shot(page, `22-board-${scheme}`);
  const board = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.innerText.trim(), color: cs.color, fontSize: cs.fontSize };
    };
    return {
      tickets: g('[data-testid="kds-ticket-count"]'),
      items: g('[data-testid="kds-item-count"]'),
      headerBg: getComputedStyle(document.querySelector('[data-testid="kds-board"] > header')).backgroundColor,
      headerHeight: Math.round(
        document.querySelector('[data-testid="kds-board"] > header').getBoundingClientRect().height,
      ),
    };
  });

  out[scheme] = { picker, board };
  console.log(`\n=== ${scheme} ===`);
  console.log(JSON.stringify({ picker, board }, null, 1));
  await ctx.close();
}

// Colour and size must be identical across themes; only the TEXT may differ (live counts).
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "text" ? undefined : v)));
const same = JSON.stringify(strip(out.light)) === JSON.stringify(strip(out.dark));
console.log(`\ncolours/sizes identical across themes: ${same}`);
if (!same) {
  bad += 1;
  console.log("light:", JSON.stringify(strip(out.light)));
  console.log("dark :", JSON.stringify(strip(out.dark)));
}
for (const scheme of ["light", "dark"]) {
  for (const [where, node] of [
    ["picker tickets", out[scheme].picker.tickets],
    ["picker items", out[scheme].picker.items],
    ["picker caption", out[scheme].picker.caption],
    ["board tickets", out[scheme].board.tickets],
    ["board items", out[scheme].board.items],
  ]) {
    if (!node) {
      bad += 1;
      console.log(`MISSING ${scheme} ${where}`);
    }
  }
}
console.log(bad === 0 ? "THEME CHECK CLEAN" : `${bad} theme problem(s)`);
await browser.close();
if (bad) process.exitCode = 1;
