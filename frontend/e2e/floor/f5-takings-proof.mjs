/*
 * F5 — PROOF. Owner opens /app/finance/takings on a day with a discounted, taxed order and reads
 * the tiles the way a person cashing up reads them: label, amount, caption.
 *
 * The assertions are the DONE MEANS, verbatim:
 *   · no tile labelled "net" exceeds the gross tile
 *   · net = gross − discounts
 *   · tax is shown separately and is not inside net
 *   · the caption under each tile describes the figure above it
 *
 * Screenshots land in .planning/audits/floor/F5/.
 */
import { newBrowser, newPage, login, go, PEOPLE, apiGet, tokenOf, money } from "../shift/lib.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F5");
mkdirSync(OUT, { recursive: true });

const IDS = [
  "figure-tile-gross-sales",
  "figure-tile-discounts",
  "figure-tile-comps",
  "figure-tile-net-sales",
  "figure-tile-tax",
  "figure-tile-service-charge",
  "figure-tile-total-billed",
];

/** Read every tile off the RENDERED page: label, money, caption. No props, no model. */
async function readTiles(page) {
  return page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        out[id] = null;
        continue;
      }
      const lines = (el.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const text = el.innerText || "";
      const m = text.match(/Rs\s*([\d,]+\.\d{2})/);
      out[id] = {
        label: lines[0] ?? "",
        amountText: m ? `Rs ${m[1]}` : null,
        paisa: m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : null,
        caption: lines.slice(2).join(" "),
      };
    }
    const identity = document.querySelector('[data-testid="takings-identity"]');
    out.__identity = identity ? identity.textContent.trim() : null;
    return out;
  }, IDS);
}

const problems = [];
function check(ok, what) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) problems.push(what);
}

(async () => {
  const browser = await newBrowser();
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);

  // Minted ONCE. `tokenOf` spends the HttpOnly refresh cookie, and calling it per request rotates
  // the cookie under the tab — which is what made the first two runs of this script report "no
  // trading day found" against a stack that had one. An empty answer from a rotated-out token
  // looks exactly like an empty day, which is the trap this whole exercise is about.
  const bearer = await tokenOf(page);
  if (!bearer) throw new Error("could not mint a bearer for the signed-in owner");

  // Pick a day that genuinely has a discount AND a tax — otherwise gross, net and total collapse
  // onto one number and this screen proves nothing.
  let date = process.argv[2] ?? null;
  const probes = [];
  if (!date) {
    for (let back = 0; back < 25 && !date; back++) {
      const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
      const r = await apiGet(page, `/api/v1/pos/takings/daily?date=${d}`, bearer);
      if (r.status !== 200) throw new Error(`takings probe for ${d} returned HTTP ${r.status}`);
      const b = r.body?.data ?? r.body;
      if (b) {
        probes.push({ d, ...b, byTender: undefined, tills: undefined });
        if ((b.discountsPaisa ?? 0) > 0 && (b.taxPaisa ?? 0) > 0) date = d;
      }
    }
  }
  if (!date) throw new Error("no trading day with both a discount and a tax was found");
  console.log(`\n  business date under test: ${date}\n`);

  const apiRes = await apiGet(page, `/api/v1/pos/takings/daily?date=${date}`, bearer);
  if (apiRes.status !== 200) throw new Error(`takings read returned HTTP ${apiRes.status}`);
  const api = apiRes.body?.data ?? apiRes.body;
  console.log("  API:", JSON.stringify({
    gross: api.grossSalesPaisa, discounts: api.discountsPaisa, net: api.netSalesPaisa,
    tax: api.taxPaisa, service: api.serviceChargePaisa, totalBilled: api.totalBilledPaisa,
    orders: api.orderCount,
  }));

  const t = await go(page, `/app/finance/takings?date=${date}`, { waitMs: 4500 });
  check(t.bad.length === 0, `page is not in an error state (${JSON.stringify(t.bad)})`);
  check(t.alerts.length === 0, `no [role=alert] on the page (${JSON.stringify(t.alerts)})`);

  const tiles = await readTiles(page);
  console.log("\n  ── tiles as rendered ──");
  for (const id of IDS) {
    const x = tiles[id];
    console.log(
      x ? `    ${x.label.padEnd(15)} ${String(x.amountText ?? "(not known)").padStart(14)}  — ${x.caption}`
        : `    ${id}: ABSENT`,
    );
  }
  console.log(`    identity line: ${tiles.__identity}`);

  const gross = tiles["figure-tile-gross-sales"];
  const disc = tiles["figure-tile-discounts"];
  const net = tiles["figure-tile-net-sales"];
  const tax = tiles["figure-tile-tax"];
  const svc = tiles["figure-tile-service-charge"];
  const total = tiles["figure-tile-total-billed"];

  console.log("\n  ── DONE MEANS ──");
  check(!!net && net.label.toLowerCase().includes("net"), "a tile labelled 'Net sales' exists");
  check(!!total, "a tile labelled 'Total billed' exists");
  check(disc.paisa > 0, `the day has a real discount (${money(disc.paisa)})`);
  check(tax.paisa > 0, `the day has a real tax (${money(tax.paisa)})`);

  // Every tile whose LABEL contains "net", checked against gross. Generic on purpose: a future
  // tile called "Net revenue" is caught by the same rule.
  const netish = IDS.map((id) => tiles[id]).filter(
    (x) => x && x.paisa !== null && /net/i.test(x.label),
  );
  check(netish.length > 0, "at least one tile is labelled 'net'");
  for (const x of netish) {
    check(x.paisa <= gross.paisa,
      `"${x.label}" ${money(x.paisa)} does not exceed GROSS ${money(gross.paisa)}`);
  }

  check(net.paisa === gross.paisa - disc.paisa,
    `net ${money(net.paisa)} = gross ${money(gross.paisa)} − discounts ${money(disc.paisa)}`);
  check(net.paisa !== gross.paisa - disc.paisa + tax.paisa,
    `tax ${money(tax.paisa)} is NOT inside net`);
  check(total.paisa === net.paisa + tax.paisa + svc.paisa,
    `total billed ${money(total.paisa)} = net + tax + service charge`);
  check(total.paisa === api.totalBilledPaisa && net.paisa === api.netSalesPaisa,
    "the screen shows exactly what the server stated (no client arithmetic)");

  // Captions must describe the figure ABOVE them, which is the half of this defect that a number
  // check cannot catch: "What the bills actually came to" was true of a total and sat under "net".
  check(/gross sales less discounts/i.test(net.caption), `net caption describes net: "${net.caption}"`);
  check(/not inside net sales/i.test(tax.caption), `tax caption says it is outside net: "${tax.caption}"`);
  check(/what the bills actually came to/i.test(total.caption),
    `total-billed caption describes a total: "${total.caption}"`);
  check(/before any discount/i.test(gross.caption), `gross caption describes gross: "${gross.caption}"`);
  check(
    tiles.__identity ===
      "Gross sales − discounts = net sales. Net sales + tax + service charge = total billed.",
    "the identity line is printed under the tiles",
  );

  await page.screenshot({ path: `${OUT}/f5-01-takings-1440-light.png`, fullPage: false });

  // 390 / 768 / 1440, both themes — the screen has to hold up where it is actually read.
  for (const [w, h, name] of [[390, 844, "390"], [768, 1024, "768"], [1440, 950, "1440"]]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((th) => {
        document.documentElement.classList.toggle("dark", th === "dark");
      }, theme);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/f5-02-${name}-${theme}.png`, fullPage: true });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      check(!overflow, `no horizontal overflow at ${w}px (${theme})`);
      const still = await readTiles(page);
      check(
        still["figure-tile-net-sales"]?.paisa === net.paisa &&
          still["figure-tile-total-billed"]?.paisa === total.paisa,
        `figures unchanged at ${w}px (${theme})`,
      );
    }
  }

  console.log(
    problems.length === 0
      ? "\n  ALL CHECKS PASSED\n"
      : `\n  ${problems.length} FAILED:\n   - ${problems.join("\n   - ")}\n`,
  );
  await browser.close();
  process.exit(problems.length === 0 ? 0 : 1);
})();
