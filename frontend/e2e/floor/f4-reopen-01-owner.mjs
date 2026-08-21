/*
 * F4 RE-OPEN, part 1 — the OWNER's own run.
 *
 * Browser pinned to America/New_York. The machine is in Asia/Karachi and so is the branch, so a
 * screen rendering the browser's clock would be indistinguishable from a correct one on this box.
 */
import { launch, ctx, signIn, shot, trouble, readAudit, record, log, apiGet, token, PEOPLE, BASE } from "./f4-reopen-lib.mjs";

const browser = await launch();
const page = await ctx(browser, { tz: "America/New_York" });

log("\n=== 1. OWNER signs in and looks for the audit log in the sidebar ===");
await signIn(page, PEOPLE.owner);
await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const navMatches = await page.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a"))
    .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
    .filter((n) => /audit|activity|history|security|\blog\b/i.test(`${n.t} ${n.h}`)),
);
record("1_ownerSidebarMatches", navMatches);
await shot(page, "r01-owner-sidebar");

const link = page.getByRole("link", { name: /audit log/i });
if ((await link.count()) === 0) throw new Error("REOPENED: no Audit log entry in the OWNER sidebar");
await link.first().scrollIntoViewIfNeeded();
await Promise.all([page.waitForURL(/\/app\/settings\/audit/, { timeout: 180_000 }), link.first().click()]);
await page.waitForTimeout(10_000);

let t = await trouble(page);
if (t.bad.length) {
  log("  ! trouble on first paint:", JSON.stringify(t), "— reloading once");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  t = await trouble(page);
}
record("1_urlAfterClick", page.url());
record("1_trouble", t);
const first = await readAudit(page);
record("1_screen", {
  h1: first.h1, zoneNote: first.zoneNote, summary: first.summary,
  headers: first.headers, rowCount: first.rowCount, prevDisabled: first.prevDisabled, nextDisabled: first.nextDisabled,
});
record("1_firstThreeRows", first.rows.slice(0, 3));
await shot(page, "r02-owner-audit-log");

// ── PERSIST: a hard reload of the URL, not a client-side nav ────────────────
log("\n=== 2. does it survive a reload? ===");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(10_000);
const afterReload = await readAudit(page);
record("2_afterReload", {
  url: page.url(), h1: afterReload.h1, summary: afterReload.summary,
  rowCount: afterReload.rowCount, zoneNote: afterReload.zoneNote,
  trouble: await trouble(page),
});
await shot(page, "r03-owner-after-reload");

// ── ZONE: the rendered time against the stored instant, from a New York browser ──
log("\n=== 3. is the rendered time the BRANCH's, from a New York browser? ===");
const tok = await token(page);
const raw = await apiGet(page, "/api/v1/audit/events?page=0&size=3&zone=Asia/Karachi", tok);
const branch = await page.evaluate(async () => {
  const r = await fetch("http://localhost:8080/api/v1/branches/current", { credentials: "include" }).catch(() => null);
  return r && r.ok ? await r.json() : null;
});
const topRow = raw.body?.data?.[0] ?? null;
const zoneCheck = topRow
  ? await page.evaluate(
      ({ iso }) => ({
        browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        storedUtc: iso,
        utcHhmm: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)),
        karachiHhmm: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Karachi" }).format(new Date(iso)),
        newYorkHhmm: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/New_York" }).format(new Date(iso)),
        renderedTopCell: document.querySelector('table[aria-label="Audit log"] tbody tr td')?.innerText?.trim() ?? null,
      }),
      { iso: topRow.occurredAt },
    )
  : null;
record("3_zoneCheck", zoneCheck);
record("3_branchZoneFromApi", branch?.data?.timezone ?? branch?.timezone ?? null);
record("3_topRowActorNameFromApi", topRow ? { userId: topRow.userId, userName: topRow.userName, action: topRow.action } : null);

// ── FILTERS ────────────────────────────────────────────────────────────────
log("\n=== 4. do the filters actually narrow? ===");
const facetOptions = await page.evaluate(() => ({
  actions: Array.from(document.querySelectorAll("#audit-action option")).map((o) => o.value).filter(Boolean),
  resources: Array.from(document.querySelectorAll("#audit-resource option")).map((o) => o.value).filter(Boolean),
}));
record("4_facetOptions", facetOptions);

async function pickAction(v) {
  await page.selectOption("#audit-action", v);
  await page.waitForTimeout(6000);
}
async function pickResource(v) {
  await page.selectOption("#audit-resource", v);
  await page.waitForTimeout(6000);
}

if (facetOptions.actions.includes("ORDER_VOIDED")) {
  await pickAction("ORDER_VOIDED");
  const r = await readAudit(page);
  record("4_actionOrderVoided", {
    summary: r.summary,
    rowCount: r.rowCount,
    distinctEvent: [...new Set(r.rows.map((c) => c[1]))],
    allMatch: r.rows.every((c) => /ORDER_VOIDED/.test(c[1])),
  });
  await shot(page, "r04-filter-action");
}

// resourceType — the parameter that did not exist before F4
await pickAction("");
await page.waitForTimeout(3000);
if (facetOptions.resources.includes("ORDER")) {
  await pickResource("ORDER");
  const r = await readAudit(page);
  record("4_resourceOrder", {
    summary: r.summary,
    rowCount: r.rowCount,
    distinctWhat: [...new Set(r.rows.map((c) => c[3].split("\n")[0].trim()))],
    anyUserLogin: r.rows.some((c) => /LOGIN/i.test(c[1])),
    allOrder: r.rows.every((c) => c[3].startsWith("ORDER")),
  });
  await shot(page, "r05-filter-resource");
}

// A CONTRADICTORY combination: an action that can never carry this resource type.
// The prover asserted this in a test; nobody drove it on the screen.
const userishAction = facetOptions.actions.find((a) => /LOGIN|USER_/i.test(a));
if (userishAction && facetOptions.resources.includes("ORDER")) {
  await pickAction(userishAction);
  await page.waitForTimeout(6000);
  const r = await readAudit(page);
  record("4_contradictoryCombo", {
    action: userishAction, resource: "ORDER",
    summary: r.summary, rowCount: r.rowCount,
    bodyMentionsEmpty: await page.evaluate(() => /Nothing has been recorded yet|No .* match/i.test(document.body.innerText)),
    trouble: await trouble(page),
  });
  await shot(page, "r06-contradictory-combo");
}

// clear
await page.locator("[data-testid=audit-clear-filters]").click().catch(() => {});
await page.waitForTimeout(6000);

// ── PAGING ─────────────────────────────────────────────────────────────────
log("\n=== 5. paging and the stated total ===");
const p1 = await readAudit(page);
await page.locator("[data-testid=audit-next-page]").click();
await page.waitForTimeout(7000);
const p2 = await readAudit(page);
await page.locator("[data-testid=audit-next-page]").click();
await page.waitForTimeout(7000);
const p3 = await readAudit(page);
record("5_paging", {
  p1: { summary: p1.summary, page: p1.pageNumber, first: p1.rows[0]?.[0], prevDisabled: p1.prevDisabled },
  p2: { summary: p2.summary, page: p2.pageNumber, first: p2.rows[0]?.[0], prevDisabled: p2.prevDisabled },
  p3: { summary: p3.summary, page: p3.pageNumber, first: p3.rows[0]?.[0] },
  allThreeDistinct: new Set([p1.rows[0]?.[0], p2.rows[0]?.[0], p3.rows[0]?.[0]]).size === 3,
});
await shot(page, "r07-page-3");

// back to page 1
await page.locator("[data-testid=audit-prev-page]").click();
await page.waitForTimeout(4000);
await page.locator("[data-testid=audit-prev-page]").click();
await page.waitForTimeout(6000);
record("5_backToPage1", (await readAudit(page)).pageNumber);

// ── BACKWARDS RANGE ────────────────────────────────────────────────────────
log("\n=== 6. a range that cannot match ===");
await page.fill("[data-testid=audit-filter-from]", "2026-08-12");
await page.waitForTimeout(1200);
await page.fill("[data-testid=audit-filter-to]", "2026-08-01");
await page.waitForTimeout(2500);
record("6_backwardsRange", await page.evaluate(() => ({
  alert: document.querySelector("[data-testid=audit-range-error]")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
  role: document.querySelector("[data-testid=audit-range-error]")?.getAttribute("role") ?? null,
  fromInvalid: document.querySelector("[data-testid=audit-filter-from]")?.getAttribute("aria-invalid"),
  toInvalid: document.querySelector("[data-testid=audit-filter-to]")?.getAttribute("aria-invalid"),
  rowsStillOnScreen: document.querySelectorAll('table[aria-label="Audit log"] tbody tr').length,
  clearButton: Boolean(document.querySelector("[data-testid=audit-clear-filters]")),
})));
await shot(page, "r08-backwards-range");
await page.locator("[data-testid=audit-clear-filters]").click().catch(() => {});
await page.waitForTimeout(5000);

// ── THE DAY BOUNDARY, ON THE READER ────────────────────────────────────────
// A row stored between 19:00Z and 24:00Z belongs to the NEXT Karachi day. Filtering to that
// Karachi day must include it, and filtering to the UTC day must not — that is the whole of the
// branch-timezone claim, measured on real rows rather than asserted.
log("\n=== 7. the day boundary is the BRANCH's ===");
const dayProbe = await page.evaluate(async ({ tok }) => {
  const H = { Authorization: `Bearer ${tok}` };
  const j = async (u) => {
    const r = await fetch(`http://localhost:8080${u}`, { headers: H, credentials: "include" });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  // find a row in the 19:00–24:00 UTC band (i.e. after Karachi midnight of the next day)
  const wide = await j("/api/v1/audit/events?page=0&size=200");
  const rows = wide.body?.data ?? [];
  const late = rows.find((r) => {
    const h = new Date(r.occurredAt).getUTCHours();
    return h >= 19;
  });
  if (!late) return { note: "no row in the 19:00-24:00Z band on the newest 200", scanned: rows.length };
  const iso = late.occurredAt;
  const utcDay = iso.slice(0, 10);
  const karachiDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(iso));
  const inKarachiDay = await j(`/api/v1/audit/events?from=${karachiDay}&to=${karachiDay}&zone=Asia/Karachi&size=200`);
  const inUtcDay = await j(`/api/v1/audit/events?from=${utcDay}&to=${utcDay}&zone=UTC&size=200`);
  const has = (res) => (res.body?.data ?? []).some((r) => r.id === late.id);
  return {
    rowId: late.id, storedUtc: iso, utcDay, karachiDay,
    presentWhenCutInKarachi: has(inKarachiDay),
    presentWhenCutInUtc: has(inUtcDay),
    karachiTotal: inKarachiDay.body?.meta?.totalCount ?? null,
    utcTotal: inUtcDay.body?.meta?.totalCount ?? null,
  };
}, { tok });
record("7_dayBoundaryProbe", dayProbe);

// ── API HONESTY PROBES (owner token) ───────────────────────────────────────
log("\n=== 8. contract probes with the owner's own token ===");
const probes = {};
probes.bogusZone = await apiGet(page, "/api/v1/audit/events?zone=Mars/Olympus&size=5", tok);
probes.hugeSize = await apiGet(page, "/api/v1/audit/events?size=99999", tok);
probes.unknownResource = await apiGet(page, "/api/v1/audit/events?resourceType=NOT_A_THING&size=5", tok);
probes.tenantParamInjection = await apiGet(page, "/api/v1/audit/events?tenantId=00000000-0000-0000-0000-000000000000&size=3", tok);
probes.facets = await apiGet(page, "/api/v1/audit/facets", tok);
record("8_apiProbes", {
  bogusZone: { status: probes.bogusZone.status, code: probes.bogusZone.body?.error?.code ?? probes.bogusZone.body?.code ?? null, msg: JSON.stringify(probes.bogusZone.body).slice(0, 240) },
  hugeSize: { status: probes.hugeSize.status, returned: probes.hugeSize.body?.data?.length ?? null, pageSize: probes.hugeSize.body?.meta?.page?.size ?? null },
  unknownResource: { status: probes.unknownResource.status, rows: probes.unknownResource.body?.data?.length ?? null, total: probes.unknownResource.body?.meta?.totalCount ?? null },
  tenantInjection: { status: probes.tenantParamInjection.status, rows: probes.tenantParamInjection.body?.data?.length ?? null, total: probes.tenantParamInjection.body?.meta?.totalCount ?? null },
  facets: { status: probes.facets.status, actions: probes.facets.body?.data?.actions?.length ?? null, resourceTypes: probes.facets.body?.data?.resourceTypes ?? null },
});

// last page: does the pager admit an end?
const total = probes.hugeSize.body?.meta?.totalCount ?? 0;
if (total > 0) {
  const lastPage = Math.floor((total - 1) / 200);
  const lp = await apiGet(page, `/api/v1/audit/events?size=200&page=${lastPage}`, tok);
  const beyond = await apiGet(page, `/api/v1/audit/events?size=200&page=${lastPage + 5}`, tok);
  record("8_endOfList", {
    total, lastPage,
    lastPageRows: lp.body?.data?.length ?? null,
    lastPageNextCursor: lp.body?.meta?.page?.nextCursor ?? null,
    beyondRows: beyond.body?.data?.length ?? null,
    beyondStatus: beyond.status,
  });
}

record("1_ownerConsoleErrors", [...new Set(page.__errors)].slice(0, 10));
record("1_ownerAuditApiCalls", page.__api.filter((r) => r.u.includes("/audit/")).slice(-14));

await browser.close();
log("\ndone — part 1");
