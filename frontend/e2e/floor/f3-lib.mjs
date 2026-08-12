/*
 * F3 — "the KDS station picker and the board report different numbers under the same word
 * tickets". Shared harness bits: same login/probe discipline as e2e/shift/lib.mjs, but the
 * screenshots land in .planning/audits/floor/F3/.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export { newBrowser, newPage, login, PEOPLE, pageTrouble, tokenOf, apiGet, apiSend, totpNow } from "../shift/lib.mjs";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F3");
mkdirSync(OUT, { recursive: true });

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`    shot: ${name}.png`);
  return p;
}

export async function go(page, route, { waitMs = 3500 } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  const t = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(text))
      bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(text)) bad.push("access-denied");
    return { bad, alerts, url: location.href };
  });
  if (t.bad.length) {
    console.log(`    ! ${route} showed ${t.bad.join(",")} — retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
    return page.evaluate(() => ({
      bad: [],
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent || "").trim(),
      ),
      url: location.href,
      retried: true,
    }));
  }
  return t;
}

/**
 * Wait for the picker to REACH a state, rather than trusting a fixed timeout.
 * `kds_stations` is synced from pos-service before every read, so a cold pos-service makes
 * the first station list slow — and a screenshot of "Loading stations…" scored as a missing
 * tile is exactly the empty-vs-loading confusion this audit exists to stop repeating.
 */
export async function waitForPicker(page, timeout = 45000) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid^="station-tile-"]') !== null ||
      document.querySelector('[data-testid="kds-no-stations"]') !== null ||
      document.querySelector('[role="alert"]') !== null,
    // `waitForFunction(fn, ARG, OPTIONS)` — passing options in the second slot makes them the
    // ARG and silently leaves the default 30s in place. That cost a run.
    null,
    { timeout },
  );
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    tiles: document.querySelectorAll('[data-testid^="station-tile-"]').length,
    noStations: !!document.querySelector('[data-testid="kds-no-stations"]'),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
  }));
  if (state.tiles === 0) throw new Error(`picker reached a non-tile state: ${JSON.stringify(state)}`);
  return state;
}

/** Same, for a board: wait until the header count is rendered (not "Loading station…"). */
export async function waitForBoard(page, timeout = 45000) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="kds-ticket-count"]') !== null ||
      document.querySelector('[data-testid="kds-station-unknown"]') !== null ||
      document.querySelector('[role="alert"]') !== null,
    null,
    { timeout },
  );
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-testid="kds-ticket-count"]').count())) {
    throw new Error(
      `board reached a non-board state: ${JSON.stringify(
        await page.evaluate(() => document.body.innerText.slice(0, 300)),
      )}`,
    );
  }
}

/** Every station tile on /app/kitchen, exactly as the DOM presents it. */
export async function readPicker(page) {
  return page.evaluate(() => {
    const out = [];
    for (const tile of document.querySelectorAll('[data-testid^="station-tile-"]')) {
      const code = tile.getAttribute("data-testid").replace("station-tile-", "");
      const badge = document.querySelector(`[data-testid="station-queue-${code}"]`);
      const cols = {};
      for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
        const el = document.querySelector(`[data-testid="station-${code}-col-${c}"]`);
        cols[c] = el ? el.innerText.trim().split("\n")[0] : null;
      }
      const t = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.innerText.trim() : null;
      };
      out.push({
        code,
        badge: badge ? badge.innerText.trim() : null,
        badgeAria: badge ? badge.getAttribute("aria-label") : null,
        tickets: t(`[data-testid="station-tickets-${code}"]`),
        items: t(`[data-testid="station-items-${code}"]`),
        caption: t(`[data-testid="station-breakdown-caption-${code}"]`),
        text: tile.innerText.replace(/\n+/g, " | "),
        cols,
      });
    }
    return out;
  });
}

/** The board header + column headers, exactly as the DOM presents them. */
export async function readBoard(page) {
  return page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const cols = {};
    for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
      const el = q(`[data-testid="kds-column-count-${c}"]`);
      const head = q(`[data-testid="kds-column-${c}"]`);
      cols[c] = el ? el.innerText.trim() : null;
      if (head) cols[`${c}_header`] = head.innerText.split("\n").slice(0, 2).join(" ");
    }
    return {
      h1: q("h1") ? q("h1").innerText.trim() : null,
      count: q('[data-testid="kds-ticket-count"]')
        ? q('[data-testid="kds-ticket-count"]').innerText.trim()
        : null,
      items: q('[data-testid="kds-item-count"]')
        ? q('[data-testid="kds-item-count"]').innerText.trim()
        : null,
      page: q('[data-testid="kds-page-indicator"]')
        ? q('[data-testid="kds-page-indicator"]').innerText.trim()
        : null,
      cols,
      cards: document.querySelectorAll("[data-fragment-key]").length,
    };
  });
}
