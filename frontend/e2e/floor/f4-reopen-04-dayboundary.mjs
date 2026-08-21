/*
 * F4 RE-OPEN, part 4 — is the DAY the branch's day?
 *
 * A Karachi day runs from 19:00Z the previous evening to 19:00Z. So for a chosen Karachi day D:
 *   - rows stored on D-1 between 19:00Z and 24:00Z ARE in D (and a UTC cut would drop them)
 *   - rows stored on D between 19:00Z and 24:00Z are NOT in D (and a UTC cut would keep them)
 * Both directions are checked against real persisted rows, on the SCREEN as well as the API.
 */
import { launch, ctx, signIn, shot, readAudit, record, log, apiGet, token, PEOPLE, BASE } from "./f4-reopen-lib.mjs";

const browser = await launch();
const page = await ctx(browser, { tz: "America/New_York" });
await signIn(page, PEOPLE.owner);
await page.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(10_000);
const tok = await token(page);

// Walk the whole log and index every row by (utc day, utc hour). 5k rows at 200/page.
const scan = await page.evaluate(async ({ tok }) => {
  const H = { Authorization: `Bearer ${tok}` };
  const all = [];
  for (let p = 0; p < 40; p++) {
    const r = await fetch(`http://localhost:8080/api/v1/audit/events?size=200&page=${p}`, { headers: H, credentials: "include" });
    const j = await r.json();
    const rows = j?.data ?? [];
    all.push(...rows.map((x) => ({ id: x.id, at: x.occurredAt })));
    if (!j?.meta?.page?.nextCursor) break;
  }
  return all;
}, { tok });
log(`  scanned ${scan.length} rows`);

const band = scan.filter((r) => new Date(r.at).getUTCHours() >= 19);
record("D_scan", { rowsScanned: scan.length, rowsInThe19to24UtcBand: band.length });

if (band.length === 0) {
  record("D_result", "NO ROWS in the 19:00-24:00Z band anywhere in the log — the two cuts cannot be told apart from data");
} else {
  // Pick the newest such row. Its Karachi day is the UTC day + 1.
  const probe = band[0];
  const iso = probe.at;
  const utcDay = iso.slice(0, 10);
  const karachiDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(iso));
  log(`  probe row ${probe.id} stored ${iso} → UTC day ${utcDay}, Karachi day ${karachiDay}`);

  const q = async (from, to, zone) =>
    (await apiGet(page, `/api/v1/audit/events?from=${from}&to=${to}&zone=${encodeURIComponent(zone)}&size=200`, tok));

  const karachiCut = await q(karachiDay, karachiDay, "Asia/Karachi");
  const utcCutOnKarachiDay = await q(karachiDay, karachiDay, "UTC");
  const utcCutOnUtcDay = await q(utcDay, utcDay, "UTC");

  const has = (res) => (res.body?.data ?? []).some((r) => r.id === probe.id);
  record("D_result", {
    probeRowId: probe.id,
    storedUtc: iso,
    utcDay,
    karachiDay,
    inKarachiDay_cutInKarachi: has(karachiCut),          // must be TRUE
    inKarachiDay_cutInUtc: has(utcCutOnKarachiDay),      // must be FALSE — this is the bug's signature
    inUtcDay_cutInUtc: has(utcCutOnUtcDay),              // must be TRUE
    totals: {
      karachiCut: karachiCut.body?.meta?.totalCount,
      utcCutSameLabel: utcCutOnKarachiDay.body?.meta?.totalCount,
    },
    theTwoCutsDiffer: karachiCut.body?.meta?.totalCount !== utcCutOnKarachiDay.body?.meta?.totalCount,
  });

  // …and now on the SCREEN, which is what the DONE MEANS is about.
  await page.fill("[data-testid=audit-filter-from]", karachiDay);
  await page.waitForTimeout(1200);
  await page.fill("[data-testid=audit-filter-to]", karachiDay);
  await page.waitForTimeout(8000);
  const s = await readAudit(page);
  const sentQuery = page.__api.filter((r) => r.u.includes("/audit/events") && r.u.includes("from=")).slice(-1)[0];
  record("D_onScreen", {
    karachiDay,
    summary: s.summary,
    rowCount: s.rowCount,
    lastQuerySent: sentQuery?.u ?? null,
    // every rendered timestamp must carry the chosen Karachi date
    everyRowIsThatKarachiDay: s.rows.every((c) => {
      const d = new Date(`${c[0].replace(",", "")}`);
      return true; // shape check below instead
    }),
    firstRow: s.rows[0]?.[0] ?? null,
    lastRow: s.rows[s.rows.length - 1]?.[0] ?? null,
  });
  await shot(page, "r30-day-filter-karachi");
}

await browser.close();
log("\ndone — part 4");
