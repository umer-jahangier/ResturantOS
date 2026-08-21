/*
 * F4 RE-OPEN, part 4b — the day boundary, settled by arithmetic on the raw instants.
 *
 * The server's stated total for "the Karachi day 2026-08-12" must equal the number of rows whose
 * stored instant falls in [2026-08-11T19:00Z, 2026-08-12T19:00Z). If the cut were UTC it would
 * instead equal the count in [2026-08-12T00:00Z, 2026-08-13T00:00Z). Those two sets differ by
 * over a thousand rows here, so the two hypotheses are trivially separable.
 *
 * Also picks a row that lives ONLY in the Karachi day (23:42Z on the 11th) and pages the filtered
 * result all the way to it, rather than looking at the first page and calling it absent.
 */
import { launch, ctx, signIn, record, log, apiGet, token, PEOPLE, BASE } from "./f4-reopen-lib.mjs";

const browser = await launch();
const page = await ctx(browser, { tz: "America/New_York" });
await signIn(page, PEOPLE.owner);
await page.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const tok = await token(page);

const T0 = Date.now(); // rows written after this are excluded from both sides of the comparison

const pull = async (qs) =>
  page.evaluate(async ({ tok, qs }) => {
    const H = { Authorization: `Bearer ${tok}` };
    const all = [];
    let total = null;
    for (let p = 0; p < 60; p++) {
      const r = await fetch(`http://localhost:8080/api/v1/audit/events?size=200&page=${p}&${qs}`, { headers: H, credentials: "include" });
      const j = await r.json();
      if (total === null) total = j?.meta?.totalCount ?? null;
      const rows = j?.data ?? [];
      all.push(...rows.map((x) => ({ id: x.id, at: x.occurredAt })));
      if (!j?.meta?.page?.nextCursor) break;
    }
    return { total, rows: all };
  }, { tok, qs });

const KDAY = "2026-08-12";
const karachi = await pull(`from=${KDAY}&to=${KDAY}&zone=Asia%2FKarachi`);
const utc = await pull(`from=${KDAY}&to=${KDAY}&zone=UTC`);
const everything = await pull("");

const inRange = (rows, loIso, hiIso) => {
  const lo = Date.parse(loIso), hi = Date.parse(hiIso);
  return rows.filter((r) => { const t = Date.parse(r.at); return t >= lo && t < hi; });
};

// Freeze the comparison at the newest row the *filtered* read saw, so rows written by other
// agents between the two calls cannot make the arithmetic look wrong.
const cutoff = Math.min(
  Math.max(...karachi.rows.map((r) => Date.parse(r.at))),
  Math.max(...utc.rows.map((r) => Date.parse(r.at))),
  Math.max(...everything.rows.map((r) => Date.parse(r.at))),
);
const settled = everything.rows.filter((r) => Date.parse(r.at) <= cutoff);

const expectedKarachi = inRange(settled, "2026-08-11T19:00:00Z", "2026-08-12T19:00:00Z").length;
const expectedUtc = inRange(settled, "2026-08-12T00:00:00Z", "2026-08-13T00:00:00Z").length;

record("D2_arithmetic", {
  cutoffInstant: new Date(cutoff).toISOString(),
  serverTotal_zoneKarachi: karachi.total,
  rowsReturned_zoneKarachi: karachi.rows.length,
  computedFromRawInstants_KarachiWindow: expectedKarachi,
  serverTotal_zoneUtc: utc.total,
  rowsReturned_zoneUtc: utc.rows.length,
  computedFromRawInstants_UtcWindow: expectedUtc,
  karachiMatchesKarachiWindow: Math.abs((karachi.rows.length) - expectedKarachi) <= 2,
  utcMatchesUtcWindow: Math.abs((utc.rows.length) - expectedUtc) <= 2,
});

// The decisive membership test, done on the FULL paged result rather than page one.
const eveningRow = settled.find((r) => {
  const d = new Date(r.at);
  return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 7 && d.getUTCDate() === 11 && d.getUTCHours() >= 19;
});
const morningRow = settled.find((r) => {
  const d = new Date(r.at);
  return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 7 && d.getUTCDate() === 12 && d.getUTCHours() >= 19;
});
record("D2_membership", {
  eveningRow: eveningRow ? { id: eveningRow.id, at: eveningRow.at } : null,
  eveningRow_isInKarachiDay: eveningRow ? karachi.rows.some((r) => r.id === eveningRow.id) : null,   // must be TRUE
  eveningRow_isInUtcDay: eveningRow ? utc.rows.some((r) => r.id === eveningRow.id) : null,           // must be FALSE
  lateRowAfter19zOnThe12th: morningRow ? { id: morningRow.id, at: morningRow.at } : "none yet (it is still morning in UTC)",
  lateRow_isInKarachiDay: morningRow ? karachi.rows.some((r) => r.id === morningRow.id) : null,      // must be FALSE
  lateRow_isInUtcDay: morningRow ? utc.rows.some((r) => r.id === morningRow.id) : null,              // must be TRUE
});

// Does the count the pager states agree with the rows it will actually hand over?
record("D2_totalIsHonest", {
  statedKarachi: karachi.total,
  actuallyPaged: karachi.rows.length,
  agreesWithin: karachi.total === null ? null : karachi.rows.length - karachi.total,
});

await browser.close();
log("\ndone — part 4b");
