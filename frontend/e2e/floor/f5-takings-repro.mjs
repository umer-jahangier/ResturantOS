/*
 * F5 — "Net sales" on /app/finance/takings is larger than gross, because it is the bill total.
 * Drives the real screen as the owner and reads the rendered tiles.
 */
import { newBrowser, newPage, login, go, PEOPLE, apiGet } from "../shift/lib.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F5");
mkdirSync(OUT, { recursive: true });

const DATE = process.argv[2] ?? null;

async function readTiles(page) {
  return page.evaluate(() => {
    const sec = document.querySelector('[aria-labelledby="takings-summary-heading"]');
    if (!sec) return { tiles: [], note: "no summary section" };
    const tiles = Array.from(sec.querySelectorAll("div")).filter(
      (d) => d.querySelector("dt, .text-label, [data-tile-label]") || false,
    );
    // fall back: read every direct grid child's text
    const grid = sec.querySelector(".grid");
    const cards = grid ? Array.from(grid.children) : [];
    return {
      tiles: cards.map((c) => (c.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean)),
      raw: (sec.innerText || "").trim(),
    };
  });
}

(async () => {
  const browser = await newBrowser();
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);

  // Find a business date that actually has a discounted, taxed order.
  let date = DATE;
  if (!date) {
    for (let back = 0; back < 25 && !date; back++) {
      const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
      const r = await apiGet(page, `/api/v1/pos/takings/daily?date=${d}`);
      if (r.status === 200 && r.body) {
        const b = r.body.data ?? r.body;
        if ((b.discountsPaisa ?? 0) > 0 && (b.taxPaisa ?? 0) > 0) date = d;
        console.log(
          `  probe ${d}: gross=${b.grossSalesPaisa} disc=${b.discountsPaisa} tax=${b.taxPaisa} svc=${b.serviceChargePaisa} net=${b.netSalesPaisa} totalBilled=${b.totalBilledPaisa} orders=${b.orderCount}`,
        );
      } else {
        console.log(`  probe ${d}: HTTP ${r.status}`);
      }
    }
  }
  console.log(`\n  chosen business date: ${date}`);

  const t = await go(page, `/app/finance/takings?date=${date}`, { waitMs: 4500 });
  console.log("  page trouble:", JSON.stringify(t));
  await page.screenshot({ path: `${OUT}/f5-takings-${date}.png`, fullPage: false });

  const tiles = await readTiles(page);
  console.log("\n  ── rendered tiles ──");
  for (const t2 of tiles.tiles) console.log("   ", JSON.stringify(t2));

  const api = await apiGet(page, `/api/v1/pos/takings/daily?date=${date}`);
  console.log("\n  ── api ──");
  console.log(JSON.stringify(api.body?.data ?? api.body, null, 2).slice(0, 1200));

  await browser.close();
})();
