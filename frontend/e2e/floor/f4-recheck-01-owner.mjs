/*
 * F4 RE-CHECK 01 — the OWNER's own path, driven from the sidebar, in a browser whose clock is
 * Europe/Lisbon (UTC+1) so a screen rendering the browser's time would be visibly an hour out.
 */
import {
  BASE, WHO, launch, tab, signIn, shot, note, say, health, readScreen, bearer, apiGet, settle,
} from "./f4-recheck-lib.mjs";

const browser = await launch();
const p = await tab(browser);

say("\n=== 1. sign in and find it without typing a URL ===");
await signIn(p, WHO.owner);
await p.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);

const nav = await p.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a"))
    .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
    .filter((n) => /audit|activity|history|security|log\b/i.test(`${n.t} ${n.h}`)),
);
note("A1_navMatches", nav);
await shot(p, "a01-sidebar");

const link = p.getByRole("link", { name: /audit log/i });
if ((await link.count()) === 0) throw new Error("FAIL: no Audit log entry in the sidebar");
await link.first().scrollIntoViewIfNeeded();
await Promise.all([p.waitForURL(/\/app\/settings\/audit/, { timeout: 180_000 }), link.first().click()]);
await p.waitForTimeout(9000);

note("A2_health", await health(p));
const s1 = await readScreen(p);
note("A2_screen", {
  url: s1.url, h1: s1.h1, zoneNote: s1.zoneNote, summary: s1.summary,
  headers: s1.headers, rowCount: s1.rowCount, prevDisabled: s1.prevDisabled, nextDisabled: s1.nextDisabled,
});
note("A2_firstRows", s1.rows.slice(0, 3));
await shot(p, "a02-audit-log");

say("\n=== 2. reload: does it persist ===");
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(9000);
const s2 = await readScreen(p);
note("A3_afterReload", { h1: s2.h1, summary: s2.summary, rowCount: s2.rowCount, zoneNote: s2.zoneNote, health: await health(p) });
await shot(p, "a03-after-reload");

say("\n=== 3. does the screen show the BRANCH zone or the BROWSER's ===");
const tok = await bearer(p);
const raw = await apiGet(p, "/api/v1/audit/events?page=0&size=1&zone=Asia%2FKarachi", tok);
const top = raw.body?.data?.[0];
const zoneMath = await p.evaluate(
  ({ iso }) => {
    const d = new Date(iso);
    const at = (tz) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz }).format(d);
    return {
      browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utc: at("UTC"), karachi: at("Asia/Karachi"), lisbon: at("Europe/Lisbon"),
    };
  },
  { iso: top?.occurredAt },
);
note("A4_zoneMath", { storedUtc: top?.occurredAt, ...zoneMath, renderedTopCell: s2.rows[0]?.[0] ?? null, topRowActor: { id: top?.userId, name: top?.userName, action: top?.action } });

say("\n=== 4. the filters ===");
const facets = await apiGet(p, "/api/v1/audit/facets?zone=Asia%2FKarachi", tok);
note("A5_facets", { status: facets.status, actions: facets.body?.data?.actions?.length, resourceTypes: facets.body?.data?.resourceTypes });

await p.selectOption("[data-testid=audit-filter-action]", "ORDER_VOIDED");
await settle(p, 4000);
const fa = await readScreen(p);
note("A5_actionFilter", {
  summary: fa.summary, rowCount: fa.rowCount,
  distinctEvent: [...new Set(fa.rows.map((r) => r[1]))],
  everyRowIsVoid: fa.rows.length > 0 && fa.rows.every((r) => /ORDER_VOIDED/.test(r[1])),
  health: await health(p),
});
await shot(p, "a04-filter-action");

await p.selectOption("[data-testid=audit-filter-action]", "");
await settle(p, 3000);
await p.selectOption("[data-testid=audit-filter-resource]", "ORDER");
await settle(p, 4000);
const fr = await readScreen(p);
note("A6_resourceFilter", {
  summary: fr.summary, rowCount: fr.rowCount,
  everyWhatIsOrder: fr.rows.length > 0 && fr.rows.every((r) => /^ORDER\b/.test(r[3])),
  anyUserLogin: fr.rows.some((r) => /USER_LOGIN/.test(r[1])),
  distinctActions: [...new Set(fr.rows.map((r) => r[1].split(" ").pop()))],
  health: await health(p),
});
await shot(p, "a05-filter-resource");

// A combination that cannot match: does it say 0, or silently fall back to one filter?
await p.selectOption("[data-testid=audit-filter-action]", "USER_LOGIN_SUCCEEDED");
await settle(p, 4000);
const fc = await readScreen(p);
note("A7_contradictory", {
  summary: fc.summary, rowCount: fc.rowCount,
  saysNothingRecorded: /Nothing has been recorded yet/i.test(fc.bodyText),
  health: await health(p),
});
await shot(p, "a06-contradictory");

await p.click("[data-testid=audit-clear-filters]");
await settle(p, 4000);
note("A8_afterClear", (await readScreen(p)).summary);

say("\n=== 5. paging, and whether the stated total is honest ===");
const pages = [];
for (let i = 0; i < 3; i++) {
  const s = await readScreen(p);
  pages.push({ page: s.pageLabel, summary: s.summary, first: s.rows[0]?.[0], last: s.rows.at(-1)?.[0], prevDisabled: s.prevDisabled });
  if (i < 2) {
    await p.click("[data-testid=audit-next-page]");
    await settle(p, 4500);
  }
}
note("A9_paging", pages);
await shot(p, "a07-page-3");

// Walk every page of a bounded filter over the API and count what actually comes back.
say("\n=== 6. walk ORDER_VOIDED end to end and compare with the stated total ===");
const seen = new Map();
let dup = 0;
let pageNo = 0;
let stated = null;
for (;;) {
  const r = await apiGet(p, `/api/v1/audit/events?action=ORDER_VOIDED&size=50&page=${pageNo}&zone=Asia%2FKarachi`, tok);
  if (r.status !== 200) { note("A10_walkAborted", { pageNo, status: r.status }); break; }
  stated = r.body?.meta?.totalCount ?? stated;
  const rows = r.body?.data ?? [];
  for (const row of rows) { if (seen.has(row.id)) dup++; seen.set(row.id, row); }
  const next = r.body?.meta?.page?.nextCursor;
  if (!next || rows.length === 0 || pageNo > 60) break;
  pageNo += 1;
}
note("A10_walk", {
  statedTotal: stated, distinctIdsCollected: seen.size, duplicateRowsAcrossPages: dup,
  pagesWalked: pageNo + 1,
  everyRowIsOrderVoided: [...seen.values()].every((r) => r.action === "ORDER_VOIDED"),
  everyRowHasResourceTypeOrder: [...seen.values()].every((r) => r.resourceType === "ORDER"),
  rowsWithAName: [...seen.values()].filter((r) => r.userName).length,
  rowsWithoutAName: [...seen.values()].filter((r) => !r.userName).length,
  namelessSample: [...seen.values()].filter((r) => !r.userName).slice(0, 3).map((r) => ({ id: r.id, userId: r.userId })),
});

say("\n=== 7. a backwards range ===");
await p.fill("[data-testid=audit-filter-from]", "2026-08-12");
await p.fill("[data-testid=audit-filter-to]", "2026-08-01");
await settle(p, 2500);
const back = await readScreen(p);
note("A11_backwards", {
  rangeError: back.rangeError, rowsStillOnScreen: back.rowCount,
  fromInvalid: await p.getAttribute("[data-testid=audit-filter-from]", "aria-invalid"),
  toInvalid: await p.getAttribute("[data-testid=audit-filter-to]", "aria-invalid"),
  requestsSentSince: p.__net.slice(-3).map((n) => n.u),
});
await shot(p, "a08-backwards-range");
await p.click("[data-testid=audit-clear-filters]");
await settle(p, 3500);

say("\n=== 8. rows per page, and the detail panel ===");
await p.selectOption("[data-testid=audit-page-size]", "25");
await settle(p, 4000);
const sz = await readScreen(p);
note("A12_size25", { summary: sz.summary, rowCount: sz.rowCount, pageLabel: sz.pageLabel });

const anyDetail = p.locator("[data-testid^=audit-detail-]").first();
await anyDetail.click();
await settle(p, 1500);
const panel = await p.evaluate(() => {
  const el = document.querySelector("[data-testid=audit-detail-panel]");
  return el ? (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600) : null;
});
note("A13_detailPanel", panel);
await shot(p, "a09-detail-panel");

note("A14_consoleErrors", [...new Set(p.__errors)].slice(0, 8));
note("A15_auditCalls", p.__net.filter((n) => n.u.includes("/audit/")).slice(-14));
note("A16_bearerCaptured", Boolean(tok));

await browser.close();
say("\nDONE 01");
