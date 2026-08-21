/*
 * F4 RE-CHECK 03 — the wrong personas, and the other tenant.
 *
 * For each persona: does the sidebar offer it, what does /app/settings/audit render, does the
 * screen NAME the missing permission (rather than show an empty log), and what do the two audit
 * endpoints answer for that persona's own token.
 *
 * Then Control Bistro: its owner must see only Control's rows, and must not be able to reach
 * Floating Terrace's by any parameter the client controls.
 */
import {
  BASE, WHO, launch, tab, signIn, shot, note, say, health, readScreen, bearer, apiGet,
} from "./f4-recheck-lib.mjs";

const browser = await launch();

async function persona(key) {
  const who = WHO[key];
  const p = await tab(browser, { tz: "Europe/Lisbon" });
  await signIn(p, who);
  await p.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6500);
  const nav = await p.evaluate(() =>
    Array.from(document.querySelectorAll("nav a, aside a"))
      .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
      .filter((n) => /audit/i.test(`${n.t} ${n.h}`)));
  await p.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(9000);
  const s = await readScreen(p);
  const tok = await bearer(p);
  const ev = await apiGet(p, "/api/v1/audit/events?size=5", tok);
  const fc = await apiGet(p, "/api/v1/audit/facets", tok);
  const out = {
    navEntries: nav,
    h1: s.h1,
    namesThePermission: /audit\.log\.view/.test(s.bodyText),
    saysEmptyLog: /Nothing has been recorded yet|0 events/i.test(s.bodyText),
    tableRows: s.rowCount,
    eventsStatus: ev.status,
    eventsRows: ev.body?.data?.length ?? null,
    eventsTotal: ev.body?.meta?.totalCount ?? null,
    facetsStatus: fc.status,
    facetsActions: fc.body?.data?.actions?.length ?? null,
    health: await health(p),
  };
  await shot(p, `c-${key}`);
  await p.context().close();
  return out;
}

for (const k of ["cashier", "waiter", "manager", "accountant", "storekeeper", "admin"]) {
  say(`\n=== ${k} ===`);
  note(`C_${k}`, await persona(k));
}

say("\n=== Control Bistro (tenant B) ===");
const cb = await tab(browser, { tz: "Europe/Lisbon" });
await signIn(cb, WHO.controlOwner);
await cb.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await cb.waitForTimeout(6500);
const cbNav = await cb.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a"))
    .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
    .filter((n) => /audit/i.test(`${n.t} ${n.h}`)));
note("D1_controlNav", cbNav);
const cbLink = cb.getByRole("link", { name: /audit log/i });
if (await cbLink.count()) {
  await cbLink.first().scrollIntoViewIfNeeded();
  await Promise.all([cb.waitForURL(/settings\/audit/, { timeout: 180_000 }), cbLink.first().click()]);
} else {
  await cb.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
}
await cb.waitForTimeout(11_000);
const cbs = await readScreen(cb);
note("D2_controlScreen", {
  h1: cbs.h1, summary: cbs.summary, zoneNote: cbs.zoneNote, rowCount: cbs.rowCount,
  health: await health(cb), firstRow: cbs.rows[0] ?? null,
});
await shot(cb, "c-control-bistro");

const cbTok = await bearer(cb);
const cbAll = await apiGet(cb, "/api/v1/audit/events?size=200&zone=Asia%2FKarachi", cbTok);
const cbRows = cbAll.body?.data ?? [];
note("D3_controlRows", {
  status: cbAll.status,
  total: cbAll.body?.meta?.totalCount ?? null,
  returned: cbRows.length,
  distinctActors: [...new Set(cbRows.map((r) => r.userName).filter(Boolean))],
  anyTerraceActor: [...new Set(cbRows.map((r) => r.userName).filter(Boolean))].filter((n) => /terrace/i.test(n)),
});

// Can a client influence WHOSE log it reads?
const injections = {};
for (const q of [
  "/api/v1/audit/events?tenantId=00000000-0000-0000-0000-000000000000&size=3",
  "/api/v1/audit/events?tenant_id=00000000-0000-0000-0000-000000000000&size=3",
  "/api/v1/audit/events?size=3&sort=occurredAt,asc",
  "/api/v1/audit/events?size=99999",
  "/api/v1/audit/events?page=-5&size=3",
  "/api/v1/audit/events?zone=Mars%2FOlympus&size=3",
  "/api/v1/audit/events?resourceType=NOT_A_THING&size=3",
  "/api/v1/audit/events?action=%27%20OR%201%3D1--&size=3",
]) {
  const r = await apiGet(cb, q, cbTok);
  injections[q] = {
    status: r.status,
    rows: r.body?.data?.length ?? null,
    total: r.body?.meta?.totalCount ?? null,
    code: r.body?.error?.code ?? null,
    anyTerrace: (r.body?.data ?? []).some((x) => /terrace/i.test(x.userName ?? "")),
  };
}
note("D4_injections", injections);

// The terrace owner's own tenant total, for comparison — two different numbers is the point.
const noTok = await apiGet(cb, "/api/v1/audit/events?size=3", null);
note("D5_noBearer", { status: noTok.status, rows: noTok.body?.data?.length ?? null });

note("D6_consoleErrors", [...new Set(cb.__errors)].slice(0, 8));
await browser.close();
say("\nDONE 03");
