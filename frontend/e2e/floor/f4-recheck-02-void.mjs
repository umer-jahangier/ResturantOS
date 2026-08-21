/*
 * F4 RE-CHECK 02 — the question the audit log exists to answer, and the same question asked of
 * every OTHER action type (a void fixed for one status is not fixed for the rest).
 *
 * 1. MANAGER rings a takeaway check on the POS and voids it with a reason nobody else could type.
 * 2. OWNER, in a separate context on a Lisbon clock, finds that row: NAME, reason, Karachi time.
 * 3. Then every action in the tenant's own facet list is filtered for, one at a time, and each
 *    result is checked: only that action, a non-null resource type, and how many rows carry a name.
 */
import {
  BASE, WHO, launch, tab, signIn, shot, note, say, health, readScreen, bearer, apiGet, settle,
} from "./f4-recheck-lib.mjs";

const browser = await launch();
const REASON = `F4 RECHECK verifier ${new Date().toISOString().slice(11, 19)} ${Math.random().toString(36).slice(2, 8)}`;

say("\n=== MANAGER rings and voids ===");
const mgr = await tab(browser, { tz: "Europe/Lisbon" });
await signIn(mgr, WHO.manager);

async function ringAndVoid() {
  await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(12_000);
  await mgr.locator("[data-testid=order-type-takeaway]").click({ timeout: 30_000 });
  await mgr.waitForTimeout(1200);
  const tiles = mgr.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 40_000 });
  await tiles.nth(2).click();
  await mgr.waitForTimeout(1200);
  await mgr.locator("[data-testid=send-to-kitchen-button]").click({ timeout: 30_000 });
  await mgr.waitForTimeout(10_000);
  const nums = await mgr.evaluate(() =>
    Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))));
  if (!nums.length) throw new Error("no order number after Send to Kitchen");
  const no = nums[0];
  say(`  rang ${no}`);

  await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(9000);
  await mgr.getByText("Order Management", { exact: true }).click();
  await mgr.waitForTimeout(6000);
  await mgr.locator("[data-testid=order-management-search]").first().fill(no);
  await mgr.waitForTimeout(7000);
  await mgr.locator('[data-testid^="open-order-"]').first().click({ timeout: 35_000 });
  await mgr.waitForTimeout(4500);
  await mgr.getByLabel("Void order").first().click({ timeout: 30_000 });
  await mgr.waitForTimeout(2200);
  const ta = mgr.locator("[data-testid=void-refund-panel] textarea");
  if (await ta.count()) await ta.first().fill(REASON);
  else await mgr.locator("[data-testid=void-refund-panel] input").first().fill(REASON);
  await mgr.waitForTimeout(600);
  await mgr.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void|Void Order|Void/i }).last().click();
  await mgr.waitForTimeout(8000);
  return {
    no,
    err: await mgr.evaluate(() => document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null),
    saysVoided: await mgr.evaluate(() => /VOIDED/i.test(document.body.innerText)),
  };
}

let v = null;
for (let i = 1; i <= 3 && !v; i++) {
  try { v = await ringAndVoid(); } catch (e) { say(`  attempt ${i}: ${e.message}`); if (i === 3) throw e; await mgr.waitForTimeout(7000); }
}
note("B1_void", { ...v, reason: REASON });
await shot(mgr, "b01-manager-voided");
await mgr.context().close();

say("\n=== OWNER finds it ===");
const o = await tab(browser, { tz: "Europe/Lisbon" });
await signIn(o, WHO.owner);
await o.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await o.waitForTimeout(11_000);
let h = await health(o);
if (h.bad.length) { await o.reload({ waitUntil: "domcontentloaded" }); await o.waitForTimeout(10_000); h = await health(o); }
note("B2_ownerHealth", h);

await o.selectOption("[data-testid=audit-filter-action]", "ORDER_VOIDED");
await settle(o, 7000);
const scr = await readScreen(o);
const idx = scr.rows.findIndex((cells) => cells.some((c) => c.includes(REASON)));
note("B3_rowOnScreen", { found: idx >= 0, cells: idx >= 0 ? scr.rows[idx] : null, summary: scr.summary, rowsSearched: scr.rowCount });
await shot(o, "b02-owner-sees-void");
if (idx < 0) throw new Error("REOPENED: the void the manager just made is not on the owner's audit screen");

const tok = await bearer(o);
const api = await apiGet(o, "/api/v1/audit/events?action=ORDER_VOIDED&size=25&zone=Asia%2FKarachi", tok);
const apiRow = (api.body?.data ?? []).find((r) => JSON.stringify(r).includes(REASON));
note("B4_apiRow", apiRow ? { id: apiRow.id, action: apiRow.action, resourceType: apiRow.resourceType, resourceId: apiRow.resourceId, userId: apiRow.userId, userName: apiRow.userName, occurredAt: apiRow.occurredAt } : null);

if (apiRow) {
  const zm = await o.evaluate(({ iso }) => {
    const d = new Date(iso);
    const at = (tz) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz }).format(d);
    return { browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone, utc: at("UTC"), karachi: at("Asia/Karachi"), lisbon: at("Europe/Lisbon") };
  }, { iso: apiRow.occurredAt });
  note("B5_zoneMath", { ...zm, renderedOnScreen: scr.rows[idx][0] });
}

await o.locator('table[aria-label="Audit log"] tbody tr').nth(idx).locator("button", { hasText: "Details" }).click();
await settle(o, 2200);
note("B6_detail", await o.evaluate(() => {
  const el = document.querySelector("[data-testid=audit-detail-panel]");
  return el ? (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700) : null;
}));
await shot(o, "b03-owner-void-detail");

say("\n=== every OTHER action the tenant has, one at a time ===");
const facets = await apiGet(o, "/api/v1/audit/facets?zone=Asia%2FKarachi", tok);
const actions = facets.body?.data?.actions ?? [];
const sweep = [];
for (const a of actions) {
  const r = await apiGet(o, `/api/v1/audit/events?action=${encodeURIComponent(a)}&size=25&zone=Asia%2FKarachi`, tok);
  const rows = r.body?.data ?? [];
  sweep.push({
    action: a,
    status: r.status,
    total: r.body?.meta?.totalCount ?? null,
    rows: rows.length,
    allSameAction: rows.every((x) => x.action === a),
    resourceTypes: [...new Set(rows.map((x) => x.resourceType))],
    withActorId: rows.filter((x) => x.userId).length,
    named: rows.filter((x) => x.userName).length,
    unnamedWithAnId: rows.filter((x) => x.userId && !x.userName).length,
    sampleName: rows.find((x) => x.userName)?.userName ?? null,
  });
}
note("B7_actionSweep", sweep);
note("B7_summary", {
  actionsChecked: sweep.length,
  anyFilterLeaked: sweep.filter((s) => !s.allSameAction).map((s) => s.action),
  anyNullResourceType: sweep.filter((s) => s.resourceTypes.includes(null)).map((s) => s.action),
  actionsWithAnIdButNoName: sweep.filter((s) => s.unnamedWithAnId > 0).map((s) => ({ a: s.action, n: s.unnamedWithAnId, of: s.withActorId })),
});

// resource-type sweep, the filter the walkthrough said was ignored
const resources = facets.body?.data?.resourceTypes ?? [];
const rsweep = [];
for (const rt of resources) {
  const r = await apiGet(o, `/api/v1/audit/events?resourceType=${encodeURIComponent(rt)}&size=25&zone=Asia%2FKarachi`, tok);
  const rows = r.body?.data ?? [];
  rsweep.push({ resourceType: rt, total: r.body?.meta?.totalCount ?? null, rows: rows.length, allMatch: rows.every((x) => x.resourceType === rt) });
}
note("B8_resourceSweep", rsweep);
note("B8_leaks", rsweep.filter((s) => !s.allMatch).map((s) => s.resourceType));

note("B9_consoleErrors", [...new Set(o.__errors)].slice(0, 8));
await browser.close();
say("\nDONE 02");
