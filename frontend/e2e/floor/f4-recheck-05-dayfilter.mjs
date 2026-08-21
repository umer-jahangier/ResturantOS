/*
 * F4 RE-CHECK 05 — the day filter showed "The audit log is unavailable right now" on the first
 * attempt. Is that a transient, or does asking for a big day reliably fail?
 *
 * Times the API call directly at several sizes, then drives the screen three times.
 */
import {
  BASE, WHO, launch, tab, signIn, shot, note, say, health, readScreen, bearer, apiGet, settle,
} from "./f4-recheck-lib.mjs";

const browser = await launch();
const p = await tab(browser, { tz: "Europe/Lisbon" });
await signIn(p, WHO.owner);
await p.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(11_000);
const tok = await bearer(p);
const kDay = await p.evaluate(() =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));

const timings = [];
for (let i = 0; i < 6; i++) {
  const t0 = Date.now();
  const r = await apiGet(p, `/api/v1/audit/events?page=0&size=50&from=${kDay}&to=${kDay}&zone=Asia%2FKarachi`, tok);
  timings.push({ ms: Date.now() - t0, status: r.status, total: r.body?.meta?.totalCount ?? null, rows: r.body?.data?.length ?? null });
}
note("F1_apiTimings", timings);

const unfiltered = [];
for (let i = 0; i < 3; i++) {
  const t0 = Date.now();
  const r = await apiGet(p, `/api/v1/audit/events?page=0&size=50&zone=Asia%2FKarachi`, tok);
  unfiltered.push({ ms: Date.now() - t0, status: r.status, total: r.body?.meta?.totalCount ?? null });
}
note("F2_unfilteredTimings", unfiltered);

const onScreen = [];
for (let i = 0; i < 3; i++) {
  await p.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(10_000);
  await p.fill("[data-testid=audit-filter-from]", kDay);
  await p.fill("[data-testid=audit-filter-to]", kDay);
  await settle(p, 9000);
  const s = await readScreen(p);
  const h = await health(p);
  onScreen.push({
    attempt: i + 1,
    summary: s.summary,
    rowCount: s.rowCount,
    bad: h.bad,
    saysUnavailable: h.alerts.some((a) => /unavailable right now/i.test(a)),
    saysNothingRecorded: /Nothing has been recorded yet/i.test(s.bodyText),
    everyRowIsThatDay: s.rows.length > 0 && s.rows.every((r) => /^12 Aug 2026/.test(r[0])),
  });
  await shot(p, `f-dayfilter-${i + 1}`);
}
note("F3_onScreenAttempts", onScreen);
note("F4_verdict", {
  screenSucceededAtLeastOnce: onScreen.some((a) => a.bad.length === 0 && a.rowCount > 0),
  screenEverLiedAboutEmpty: onScreen.some((a) => a.saysNothingRecorded && a.bad.length > 0),
  failures: onScreen.filter((a) => a.bad.length).length,
});
await browser.close();
say("\nDONE 05");
