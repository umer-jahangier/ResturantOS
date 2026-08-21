/*
 * ADVERSARIAL re-audit of S1-04, round 4 — DETERMINISTIC reproduction of the regression.
 *
 * Mechanism: `safePage` is derived from the focused fragment's index in the board-wide
 * INTERLEAVED list. The last slot of a page (interleave index 9) is one insertion away from
 * page 2. Any column that deepens ahead of it — done by a second terminal, or by the POS —
 * pushes the focused fragment over the boundary and the board FOLLOWS, turning the page under
 * a cook who pressed nothing.
 *
 * This computes which printed jump key sits on that boundary, focuses exactly that card, then
 * has a second real browser session deepen an earlier column, and measures.
 *
 *   node e2e/repair/audit-s1-04-adversarial4.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S1-04/adversarial");
mkdirSync(OUT, { recursive: true });
const KITCHEN = { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };
const COLS = ["NEW", "STARTED", "PREPARING", "READY"];
const PAGE_SIZE = 10;
const log = (...a) => console.log(...a);

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

async function probe(page) {
  return page.evaluate((COLS) => {
    const txt = (n) => (n?.textContent ?? "").trim();
    const keyMap = {};
    const columns = COLS.map((c) => {
      const list = document.querySelector(`[data-testid="kds-column-list-${c}"]`);
      const rendered = Array.from(list?.querySelectorAll("[data-fragment-key]") ?? []).map((el) => {
        const badge = (el.querySelector('[data-testid="kds-ticket-position"]')?.textContent ?? "").trim();
        const key = el.getAttribute("data-fragment-key");
        if (badge) keyMap[badge] = key;
        return {
          key,
          badge,
          focused:
            el.querySelector('[data-testid="kds-ticket-card"]')?.getAttribute("data-focused") === "true",
          moves: Array.from(el.querySelectorAll('[data-testid^="column-move-"]')).map((b) => ({
            testid: b.getAttribute("data-testid"),
            label: (b.textContent ?? "").trim(),
          })),
        };
      });
      return {
        column: c,
        depth: Number(txt(document.querySelector(`[data-testid="kds-column-count-${c}"]`)) || 0),
        n: rendered.length,
        rendered,
      };
    });
    const ind = txt(document.querySelector('[data-testid="kds-page-indicator"]')) || "1 / 1";
    const [cur, of] = ind.split("/").map((s) => Number(s.trim()));
    return {
      indicator: ind,
      page: cur,
      pages: of,
      columns,
      keyMap,
      keys: columns.flatMap((c) => c.rendered.map((r) => r.key)),
      focused: columns.flatMap((c) => c.rendered).find((r) => r.focused)?.key ?? null,
    };
  }, COLS);
}

/** Which (column, rank) sits at a given index of the round-robin interleave. */
function interleaveAt(depths, index) {
  let i = 0;
  const max = Math.max(...depths);
  for (let rank = 0; rank < max; rank += 1) {
    for (let c = 0; c < depths.length; c += 1) {
      if (rank < depths[c]) {
        if (i === index) return { col: c, rank };
        i += 1;
      }
    }
  }
  return null;
}

const line = (p) => `page ${p.indicator} | ` + p.columns.map((c) => `${c.column} ${c.n}/${c.depth}`).join("  ");

async function main() {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const A = await ctxA.newPage();
  await login(A, KITCHEN);
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const B = await ctxB.newPage();
  await login(B, KITCHEN);

  const results = [];
  for (let trial = 1; trial <= 3; trial += 1) {
    log(`\n──────── trial ${trial} ────────`);
    await A.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
    await A.waitForTimeout(4500);
    let a1 = await probe(A);
    log(`  A: ${line(a1)}`);
    const depths = a1.columns.map((c) => c.depth);
    const boundary = interleaveAt(depths, PAGE_SIZE - 1);
    if (!boundary) {
      log("  (board too small)");
      break;
    }
    const bcol = a1.columns[boundary.col];
    const bcard = bcol.rendered[boundary.rank];
    if (!bcard) {
      log(`  boundary fragment ${COLS[boundary.col]}#${boundary.rank} not rendered — skipping`);
      continue;
    }
    log(
      `  boundary of page 1 = interleave index 9 = ${COLS[boundary.col]} rank ${boundary.rank} ` +
        `= the card printed "${bcard.badge}"`,
    );
    await A.keyboard.press(bcard.badge);
    await A.waitForTimeout(800);
    a1 = await probe(A);
    log(`  A focused ${a1.focused} — the cook's ONE key press, then they go back to cooking`);
    const before = { page: a1.page, pages: a1.pages, keys: a1.keys.slice() };

    // A column that must deepen AHEAD of the boundary for the shift to happen.
    const grow = a1.columns.findIndex((c, i) => i < boundary.col ? c.depth <= boundary.rank + 1 : c.depth <= boundary.rank);
    await B.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
    await B.waitForTimeout(4500);
    const b1 = await probe(B);
    // Deepen PREPARING (or whatever is shallowest ahead of the boundary) by advancing a Started card.
    const src = b1.columns.find((c) => c.column === "STARTED")?.rendered.find((r) => r.moves.length);
    if (!src) {
      log("  B had nothing to advance");
      continue;
    }
    log(`  B (second terminal, same station) clicks "${src.moves[0].label}" on ${src.key}`);
    await B.locator(`[data-testid="${src.moves[0].testid}"]`).first().click();
    await B.waitForTimeout(2000);

    await A.waitForTimeout(10000); // A presses NOTHING
    const a2 = await probe(A);
    log(`  A (no input at all): ${line(a2)}`);
    const turned = a2.page !== before.page;
    const retained = before.keys.filter((k) => a2.keys.includes(k)).length;
    log(
      `  >>> page ${before.page} -> ${a2.page}   TURNED UNDER THE COOK = ${turned ? "YES" : "no"};` +
        ` cards still on screen ${retained}/${before.keys.length}`,
    );
    results.push({ trial, turned, retained, total: before.keys.length });
    if (turned) await A.screenshot({ path: `${OUT}/E-spontaneous-turn-trial${trial}.png` });
  }

  log("\n================ SUMMARY ================");
  for (const r of results)
    log(`  trial ${r.trial}: turned=${r.turned}  retained ${r.retained}/${r.total}`);
  log(
    `\n  ${results.filter((r) => r.turned).length} of ${results.length} trials turned the page with NO cook input.`,
  );
  await browser.close();
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
