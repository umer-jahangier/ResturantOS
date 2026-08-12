/*
 * F10 step 1 — reproduce: open /app/finance/journal-entries as the owner and read every
 * description off the screen. The claim under test is that ORDER_REVENUE rows name a UUID.
 */
import { newBrowser, newPage, login, go, shot, readJeTable, apiGet, saveState, PEOPLE, log } from "./lib.mjs";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ORDNO_RE = /ORD-\d{8}-\d{4}/;

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);

  const t = await go(page, "/app/finance/journal-entries", { waitMs: 4000 });
  log("  page:", JSON.stringify(t));
  await shot(page, "01a-journal-entries-list");

  const table = await readJeTable(page);
  log("  headers:", table.headers.join(" | "));
  log(`  rows on screen: ${table.rows.length}`);
  const descIdx = table.headers.findIndex((h) => /description/i.test(h));
  const withUuid = [];
  const withOrderNo = [];
  for (const r of table.rows) {
    const desc = descIdx >= 0 ? r[descIdx] : r.join(" ");
    log("   •", r[0], "|", desc);
    if (UUID_RE.test(desc)) withUuid.push(desc);
    if (ORDNO_RE.test(desc)) withOrderNo.push(desc);
  }
  log(`\n  descriptions carrying a raw UUID : ${withUuid.length}`);
  log(`  descriptions carrying an order no : ${withOrderNo.length}`);

  // Cross-read the same list over HTTP on the owner's own bearer, so a rendering quirk cannot
  // be mistaken for a data problem.
  const api = await apiGet(page, "/api/v1/finance/journal-entries?size=50");
  const rows = api.body?.data ?? api.body?.content ?? [];
  log(`\n  API /journal-entries → ${api.status}, ${rows.length} rows`);
  for (const je of rows.slice(0, 20)) {
    log(`   · ${je.entryNo} ${je.sourceType ?? "—"} :: ${je.description}`);
  }

  saveState({
    reproAt: new Date().toISOString(),
    screenUuidDescriptions: withUuid.length,
    screenOrderNoDescriptions: withOrderNo.length,
    apiDescriptions: rows.map((j) => ({ entryNo: j.entryNo, sourceType: j.sourceType, description: j.description })),
  });
} finally {
  await browser.close();
}
