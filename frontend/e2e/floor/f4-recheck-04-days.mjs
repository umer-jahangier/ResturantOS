/*
 * F4 RE-CHECK 04 — is the DAY cut where the restaurant is, on the READER as well as the writer,
 * and on rows written long before F4 landed?
 *
 * Karachi is UTC+5. So the Karachi day D begins at (D-1)T19:00Z. Any row stored between
 * (D-1)T19:00Z and (D-1)T23:59Z belongs to Karachi's day D and to UTC's day D-1. Those rows are
 * the discriminator: a reader cutting on Karachi must INCLUDE them for from=to=D; a reader cutting
 * on UTC must EXCLUDE them. Both are asserted against the same rows, over HTTP, plus the screen.
 *
 * Also: 390px, and the branch zone on a device that is nowhere near it.
 */
import {
  BASE, WHO, launch, tab, signIn, shot, note, say, health, readScreen, bearer, apiGet, settle,
} from "./f4-recheck-lib.mjs";

const browser = await launch();
const p = await tab(browser, { tz: "Europe/Lisbon" });
await signIn(p, WHO.owner);
await p.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(11_000);
note("E0_health", await health(p));
const tok = await bearer(p);

// Today, in Karachi.
const kDay = await p.evaluate(() =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
note("E1_karachiToday", kDay);

const karachiCut = await apiGet(p, `/api/v1/audit/events?from=${kDay}&to=${kDay}&zone=Asia%2FKarachi&size=200`, tok);
const utcCut = await apiGet(p, `/api/v1/audit/events?from=${kDay}&to=${kDay}&size=200`, tok);
note("E2_totals", {
  karachiCutTotal: karachiCut.body?.meta?.totalCount ?? null,
  utcCutTotal: utcCut.body?.meta?.totalCount ?? null,
  theyDiffer: (karachiCut.body?.meta?.totalCount ?? -1) !== (utcCut.body?.meta?.totalCount ?? -2),
});

// The discriminating band: (kDay-1) 19:00Z .. 23:59:59Z. Find such a row from the raw log.
const wide = await apiGet(p, "/api/v1/audit/events?size=200&page=0&zone=Asia%2FKarachi", tok);
let band = null;
for (let pg = 0; pg < 40 && !band; pg++) {
  const r = await apiGet(p, `/api/v1/audit/events?size=200&page=${pg}`, tok);
  const rows = r.body?.data ?? [];
  if (!rows.length) break;
  band = rows.find((x) => {
    const d = new Date(x.occurredAt);
    const kd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const ud = d.toISOString().slice(0, 10);
    return kd === kDay && ud !== kDay;
  });
}
note("E3_discriminatingRow", band ? { id: band.id, occurredAt: band.occurredAt, action: band.action } : "none found");

if (band) {
  const inKarachi = (karachiCut.body?.data ?? []).some((x) => x.id === band.id);
  // The Karachi-cut window can exceed 200 rows, so ask the server directly for that one id's window.
  const kAll = [];
  for (let pg = 0; pg < 40; pg++) {
    const r = await apiGet(p, `/api/v1/audit/events?from=${kDay}&to=${kDay}&zone=Asia%2FKarachi&size=200&page=${pg}`, tok);
    const rows = r.body?.data ?? [];
    kAll.push(...rows.map((x) => x.id));
    if (!r.body?.meta?.page?.nextCursor || !rows.length) break;
  }
  const uAll = [];
  for (let pg = 0; pg < 40; pg++) {
    const r = await apiGet(p, `/api/v1/audit/events?from=${kDay}&to=${kDay}&size=200&page=${pg}`, tok);
    const rows = r.body?.data ?? [];
    uAll.push(...rows.map((x) => x.id));
    if (!r.body?.meta?.page?.nextCursor || !rows.length) break;
  }
  note("E4_membership", {
    rowId: band.id,
    storedUtc: band.occurredAt,
    isInKarachiCutDay: kAll.includes(band.id),
    isInUtcCutDay: uAll.includes(band.id),
    karachiWindowSize: kAll.length,
    utcWindowSize: uAll.length,
    firstPageContained: inKarachi,
    verdict: kAll.includes(band.id) && !uAll.includes(band.id)
      ? "cut on the BRANCH zone"
      : "NOT cut on the branch zone",
  });
}

// The same on the screen: pick today in Karachi and see the request that goes out.
await p.fill("[data-testid=audit-filter-from]", kDay);
await p.fill("[data-testid=audit-filter-to]", kDay);
await settle(p, 6000);
const s = await readScreen(p);
note("E5_onScreen", {
  summary: s.summary,
  rowCount: s.rowCount,
  lastRequest: p.__net.filter((n) => n.u.includes("/audit/events")).at(-1)?.u ?? null,
  everyRowIsThatKarachiDay: s.rows.length > 0 && s.rows.every((r) => r[0].startsWith(`${Number(kDay.slice(8))} Aug 2026`)),
  health: await health(p),
});
await shot(p, "e01-day-filter");

say("\n=== 390px, dark ===");
await p.context().close();
for (const [w, scheme] of [[390, "light"], [390, "dark"], [768, "light"], [1440, "dark"]]) {
  const q = await tab(browser, { tz: "Europe/Lisbon", width: w, height: 850, colorScheme: scheme });
  await signIn(q, WHO.owner);
  await q.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
  await q.waitForTimeout(11_000);
  const r = await readScreen(q);
  note(`E6_${w}_${scheme}`, {
    h1: r.h1,
    summary: r.summary,
    rowsOrCards: r.rowCount || (await q.evaluate(() => document.querySelectorAll("li,[data-card]").length)),
    tablesVisible: r.tablesVisible,
    noHorizontalOverflow: await q.evaluate(() => document.body.scrollWidth <= window.innerWidth),
    bodyScrollW: await q.evaluate(() => document.body.scrollWidth),
    viewportW: w,
    bg: await q.evaluate(() => getComputedStyle(document.body).backgroundColor),
    health: await health(q),
  });
  await shot(q, `e02-${w}-${scheme}`);
  await q.context().close();
}

await browser.close();
say("\nDONE 04");
