/*
 * Shared driving helpers for S1 #11 — "the kitchen board pages a board-wide flat list,
 * so started work vanishes off the cook's page".
 *
 * Everything in here reads the REAL DOM of the running board. Nothing is inferred from
 * source. `probeBoard` deliberately reports `[role=alert]` and the error/loading
 * testids first, because an error state that renders as an empty four-column board is
 * exactly the failure this repo keeps mistaking for a passing empty state.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const KITCHEN = {
  slug: "floating-terrace",
  email: "kitchen@terrace.local",
  password: "Terrace#Kitchen1",
};

export const OUT = resolve(process.cwd(), "../.planning/audits/repair/S1-04");
mkdirSync(OUT, { recursive: true });

export async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log("    shot:", `${name}.png`);
  return file;
}

export async function login(page, who = KITCHEN) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

/**
 * Everything a cook can actually see on the board, read out of the DOM.
 *
 * `columns[].rendered` is the list of cards physically present in that column's <ul>,
 * each with the position number the card is SHOWING (`data-position`, empty string when
 * the card carries none) — that is the `pos:""` the register measured.
 */
export async function probeBoard(page) {
  return page.evaluate(() => {
    const txt = (n) => (n?.textContent ?? "").trim();
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(txt).filter(Boolean);
    const cols = ["NEW", "STARTED", "PREPARING", "READY"];
    const columns = cols.map((c) => {
      const list = document.querySelector(`[data-testid="kds-column-list-${c}"]`);
      const headCount = txt(document.querySelector(`[data-testid="kds-column-count-${c}"]`));
      const rendered = Array.from(list?.querySelectorAll("[data-fragment-key]") ?? []).map((el) => {
        const card = el.querySelector('[data-testid="kds-ticket-card"]');
        const badge = el.querySelector('[data-testid="kds-ticket-position"]');
        return {
          key: el.getAttribute("data-fragment-key"),
          // The position number the card is ACTUALLY showing. "" is the register's `pos:''`.
          pos: (badge?.textContent ?? "").trim(),
          focused: card?.getAttribute("data-focused") === "true",
        };
      });
      const more = txt(document.querySelector(`[data-testid="kds-column-more-${c}"]`));
      return { column: c, headerCount: headCount, n: rendered.length, more, rendered };
    });
    return {
      present: !!document.querySelector('[data-testid="kds-board"]'),
      unknownStation: !!document.querySelector('[data-testid="kds-station-unknown"]'),
      loading: !!document.querySelector('[data-testid="kds-board-loading"]'),
      alerts,
      ticketCount: txt(document.querySelector('[data-testid="kds-ticket-count"]')),
      pageIndicator: txt(document.querySelector('[data-testid="kds-page-indicator"]')),
      columns,
      total: columns.reduce((a, c) => a + c.n, 0),
      unnumbered: columns.flatMap((c) =>
        c.rendered.filter((r) => !r.pos).map((r) => `${c.column}:${r.key}`),
      ),
    };
  });
}

/** Compact one-line rendering of a probe, for the transcript. */
export function fmt(p) {
  const cols = p.columns.map((c) => `${c.column} n=${c.n}(hdr ${c.headerCount})`).join("  ");
  return `page ${p.pageIndicator || "1 / 1"} | ${p.ticketCount} | ${cols} | unnumbered=${p.unnumbered.length}`;
}

/**
 * Walks every page with PageDown and returns one probe per page.
 *
 * PageDown is the board's own advertised paging key, so this walks the board the way a
 * cook on a bump bar would rather than by poking React state.
 */
export async function walkPages(page, max = 12) {
  const seen = [];
  for (let i = 0; i < max; i += 1) {
    const p = await probeBoard(page);
    seen.push(p);
    const [cur, of] = (p.pageIndicator || "1 / 1").split("/").map((s) => Number(s.trim()));
    if (!of || cur >= of) break;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(450);
  }
  return seen;
}
