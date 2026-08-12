/*
 * F10 re-open, follow-ups:
 *  1. the no-match empty state, read in FULL (the 600-char snip in 92 truncated it)
 *  2. what the rest of the ledger's descriptions look like today, by recipe
 *  3. whether searching an order number reaches EVERY entry that order produced
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const ORDER_NO = process.argv[2];
const browser = await newBrowser();
const out = {};
async function loginFresh(who, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    const page = await newPage(browser);
    try { await login(page, who); return page; }
    catch (e) { last = e; log(`  attempt ${i + 1}: ${e.message.slice(0, 120)}`);
      await page.context().close().catch(() => {});
      await new Promise((r) => setTimeout(r, 8000 + i * 5000)); }
  }
  throw last;
}
try {
  const owner = await loginFresh(PEOPLE.owner);
  await go(owner, "/app/finance/journal-entries", { waitMs: 5500 });
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description" });

  await box.fill("ORD-19990101-0001");
  await owner.waitForTimeout(5000);
  out.noMatch = await owner.evaluate(() => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      saysNoEntryMatches: /No entry matches/.test(t),
      saysNoJournalEntries: /No journal entries/.test(t),
      saysWholeBranch: /covers every entry for this branch/.test(t),
      main: (document.querySelector("main")?.innerText || t).replace(/\s+/g, " ").slice(0, 700),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
    };
  });
  await shot(owner, "94a-no-match-full");
  log("no-match state:", JSON.stringify(out.noMatch, null, 1));

  // 3. does searching the order number reach every entry the order produced?
  if (ORDER_NO) {
    await box.fill(ORDER_NO);
    await owner.waitForTimeout(5000);
    out.searchRows = await owner.evaluate(() =>
      Array.from(document.querySelectorAll("table tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim())));
    log("rows for", ORDER_NO, JSON.stringify(out.searchRows));
  }

  // 2. what the ledger's auto-posted descriptions look like now, by recipe
  const probes = ["Order revenue", "Order COGS", "Order refund", "Reversal of", "Shift close"];
  out.byRecipe = {};
  for (const p of probes) {
    const r = await apiGet(owner, `/api/v1/finance/journal-entries?q=${encodeURIComponent(p)}&size=300`);
    const rows = (r.body?.data ?? []).map((j) => j.description ?? "");
    const uuid = rows.filter((d) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(d));
    out.byRecipe[p] = { status: r.status, total: r.body?.meta?.totalCount ?? null,
      fetched: rows.length, uuidDescribed: uuid.length, sample: rows.slice(0, 3) };
    log(`  ${p}: total=${out.byRecipe[p].total} uuid=${uuid.length}/${rows.length} e.g. ${JSON.stringify(rows.slice(0, 2))}`);
  }

  writeFileSync(
    "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F10/94-followups.json",
    JSON.stringify(out, null, 2));
} catch (e) {
  log("FATAL", e.message);
} finally { await browser.close(); }
