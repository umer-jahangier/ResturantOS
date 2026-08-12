/*
 * F18 step 4 — the pass at 390 / 768 / 1440, measured rather than eyeballed.
 *
 * Reads PAINTED extents (getBoundingClientRect) of every header control and of every check
 * card against their container, because a control pushed past the right edge of a flex row
 * does not always show up as document-level horizontal overflow — the screen looks fine in a
 * screenshot and the button is unreachable. Also reads computed colours, never class lists.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, log } from "./lib.mjs";

const browser = await newBrowser();
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);

async function measure(page) {
  return page.evaluate(() => {
    const board = document.querySelector('[data-testid="expo-board"]');
    const header = board.querySelector("header");
    const hr = header.getBoundingClientRect();
    const controls = [
      "expo-check-count",
      "expo-ready-count",
      "expo-filter-all",
      "expo-filter-ready",
      "expo-filter-outstanding",
      "expo-all-stations",
      "expo-connection",
    ].map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return { id, missing: true };
      const r = el.getBoundingClientRect();
      return {
        id,
        left: Math.round(r.left),
        right: Math.round(r.right),
        clippedRight: Math.round(r.right) > Math.round(hr.right) + 1,
        clippedLeft: Math.round(r.left) < Math.round(hr.left) - 1,
        zeroSize: r.width === 0 || r.height === 0,
      };
    });
    const cards = Array.from(document.querySelectorAll('[data-testid="expo-check"]')).slice(0, 12);
    const boardRect = board.getBoundingClientRect();
    const overflowingCards = cards
      .map((c) => ({
        no: c.getAttribute("data-order-no"),
        right: Math.round(c.getBoundingClientRect().right),
      }))
      .filter((c) => c.right > Math.round(boardRect.right) + 1);
    const firstHeadline = document.querySelector('[data-testid="expo-check-headline"] span');
    return {
      docScrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      headerRight: Math.round(hr.right),
      controls,
      clipped: controls.filter((c) => c.clippedRight || c.clippedLeft || c.missing || c.zeroSize),
      overflowingCards,
      boardBg: getComputedStyle(board).backgroundColor,
      headlineColor: firstHeadline ? getComputedStyle(firstHeadline).color : null,
      cardTitleColor: document.querySelector('[data-testid="expo-check"] h2')
        ? getComputedStyle(document.querySelector('[data-testid="expo-check"] h2')).color
        : null,
      columns: getComputedStyle(document.querySelector('[data-testid="expo-check-list"]'))
        .gridTemplateColumns,
    };
  });
}

for (const theme of ["dark", "light"]) {
  for (const [w, h, label] of [
    [390, 844, "390"],
    [768, 1024, "768"],
    [1440, 950, "1440"],
  ]) {
    await kds.setViewportSize({ width: w, height: h });
    await kds.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    const tr = await go(kds, "/app/kitchen/expo", { waitMs: 7000 });
    if (tr.bad.length) log(`  ! ${label}/${theme} trouble:`, JSON.stringify(tr));
    // Re-apply after navigation (a fresh document resets the attribute).
    await kds.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await kds.waitForTimeout(1200);
    const m = await measure(kds);
    log(`\n── ${label}px · ${theme} ──`);
    log("  doc scrollW/clientW:", m.docScrollW, "/", m.clientW, "→ page overflow:", m.docScrollW > m.clientW);
    log("  header controls clipped or missing:", JSON.stringify(m.clipped));
    log("  cards past the board's right edge:", JSON.stringify(m.overflowingCards));
    log("  grid columns:", m.columns);
    log("  board bg:", m.boardBg, "| card title:", m.cardTitleColor, "| headline:", m.headlineColor);
    await shot(kds, `04-pass-${label}-${theme}`);
  }
}

await browser.close();
log("\nresponsive/theme measured.");
