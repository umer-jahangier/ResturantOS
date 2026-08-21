/*
 * SHIFT STEP 5c — the money, to the paisa, across the screens that are supposed to agree.
 *
 * My shift took exactly two payments:
 *   CASH Rs 1,682.60 on ORD-20260812-0164   (server time 2026-08-12T02:59:24Z, shown 7:59 AM)
 *   CARD Rs 1,972.00 on ORD-20260812-0165   (server time 2026-08-12T03:01:20Z, shown 8:01 AM)
 * and one drawer: float 5,000.00, expected 6,682.60, declared 6,682.60, variance 0.00.
 *
 * Question: does /app/finance/takings put that money on the day the rest of the product
 * says it happened, and does the till appear under "What each till counted"?
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, tokenOf, log, BASE } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

async function readTakings(date) {
  await go(owner, `/app/finance/takings?date=${date}`, { waitMs: 8000 });
  return owner.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const tenders = {};
    for (const m of t.matchAll(/(Card|Cash|Wallet|Bank Transfer|Voucher)\s+(\d+)\s+(Rs [\d,]+\.\d\d)/g)) {
      tenders[m[1]] = { count: m[2], amount: m[3] };
    }
    const tillBlock = /What each till counted(.*?)(Residual|$)/.exec(t)?.[1]?.trim() ?? null;
    return {
      shownDate: document.querySelector("[data-testid=takings-date]")?.value ?? null,
      orders: /(\d+) orders closed on this trading day/.exec(t)?.[1] ?? null,
      tiles: Array.from(document.querySelectorAll('[data-testid^="figure-tile-"]')).map((n) => n.innerText.replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ")),
      tenders,
      tillBlock: tillBlock?.slice(0, 1200) ?? null,
      unclosedCash: document.querySelector("[data-testid=unclosed-cash-amount]")?.textContent?.trim() ?? null,
    };
  });
}

for (const d of ["2026-08-11", "2026-08-12"]) {
  const r = await readTakings(d);
  log(`\n--- takings ?date=${d} ---`);
  log(JSON.stringify(r, null, 1));
  await shot(owner, `05j-takings-${d}`);
  saveState({ [`takings_${d}`]: r });
}

// the raw server answer, so the screen can be checked against its own source
const tok = await tokenOf(owner);
for (const d of ["2026-08-11", "2026-08-12"]) {
  const api = await apiGet(owner, `/api/v1/finance/takings?date=${d}`, tok);
  log(`\n  API takings ${d} → ${api.status}`);
  log("  ", JSON.stringify(api.body).slice(0, 1400));
  saveState({ [`takingsApi_${d}`]: api.body });
}

// ── journal entries behind a real payment ─────────────────────────────────────
log("\n=== drill a transaction through to its journal entry ===");
await go(owner, "/app/finance/transactions", { waitMs: 8000 });
// find MY cash payment row and press its Trace/Open link
const traced = await owner.evaluate((no) => {
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const r = rows.find((x) => x.innerText.includes(no) && /Payment/.test(x.innerText));
  if (!r) return { found: false, rowsSeen: rows.length };
  const link = r.querySelector("a,button");
  return {
    found: true,
    row: r.innerText.replace(/\s+/g, " ").trim(),
    linkText: link?.textContent?.trim() ?? null,
    href: link?.getAttribute("href") ?? null,
  };
}, st.order1No);
log("  my CASH payment row:", JSON.stringify(traced));
saveState({ tracedRow: traced });

if (traced.found) {
  const row = owner.locator("tbody tr", { hasText: st.order1No }).first();
  await row.locator("a,button").first().click();
  await owner.waitForTimeout(6000);
  await shot(owner, "05k-transaction-trace");
  const trace = await owner.evaluate(() => ({
    url: location.href,
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 2000),
    tables: Array.from(document.querySelectorAll("table")).map((t) => t.innerText.replace(/\s+/g, " ").slice(0, 700)),
  }));
  log("  trace landed at:", trace.url);
  log("  content:", trace.body.slice(0, 1400));
  saveState({ trace });
}

await browser.close();
log("\nstep 5c done");
