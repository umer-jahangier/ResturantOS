/*
 * F4 RE-OPEN, part 2 — the wrong personas, the adjacent right one, and the other tenant.
 *
 *  - MANAGER, CASHIER, ACCOUNTANT: no nav entry, refused by name at the URL, 403 at the API.
 *  - TENANT_ADMIN: the OTHER role the copy claims holds audit.log.view — must actually work.
 *  - CONTROL BISTRO's OWNER: reads their own log and none of Floating Terrace's.
 */
import { launch, ctx, signIn, shot, trouble, readAudit, record, log, apiGet, token, PEOPLE, BASE } from "./f4-reopen-lib.mjs";

const browser = await launch();

async function persona(key, who, { expectAllowed }) {
  log(`\n=== ${key} (${who.email}) — expect ${expectAllowed ? "ALLOWED" : "REFUSED"} ===`);
  const page = await ctx(browser, { tz: "America/New_York" });
  await signIn(page, who);
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const nav = await page.evaluate(() =>
    Array.from(document.querySelectorAll("nav a, aside a"))
      .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
      .filter((n) => /audit/i.test(`${n.t} ${n.h}`)),
  );

  await page.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  const screen = await readAudit(page);
  const tok = await token(page);
  const api = await apiGet(page, "/api/v1/audit/events?size=5", tok);
  const facets = await apiGet(page, "/api/v1/audit/facets", tok);

  const out = {
    navEntries: nav,
    h1: screen.h1,
    namesThePermission: /audit\.log\.view/.test(body),
    saysEmptyLog: /Nothing has been recorded yet|0 events/.test(body),
    tableRows: screen.rowCount,
    apiStatus: api.status,
    apiRows: api.body?.data?.length ?? null,
    facetsStatus: facets.status,
    facetsLeaked: facets.body?.data?.actions?.length ?? null,
    trouble: await trouble(page),
  };
  record(`P_${key}`, out);
  await shot(page, `r10-${key}`);
  await page.context().close();
  return out;
}

// ── refused ────────────────────────────────────────────────────────────────
const mgr = await persona("manager", PEOPLE.manager, { expectAllowed: false });
const cash = await persona("cashier", PEOPLE.cashier, { expectAllowed: false });
const acct = await persona("accountant", PEOPLE.accountant, { expectAllowed: false });

// ── the OTHER role the refusal copy names ─────────────────────────────────
const admin = await persona("tenantAdmin", PEOPLE.tenantAdmin, { expectAllowed: true });

// ── the other tenant ───────────────────────────────────────────────────────
log("\n=== CONTROL BISTRO's owner reads their own log, and only their own ===");
const cb = await ctx(browser, { tz: "America/New_York" });
await signIn(cb, PEOPLE.controlOwner);
await cb.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await cb.waitForTimeout(10_000);
let cbTrouble = await trouble(cb);
if (cbTrouble.bad.length) {
  await cb.reload({ waitUntil: "domcontentloaded" });
  await cb.waitForTimeout(9000);
  cbTrouble = await trouble(cb);
}
const cbScreen = await readAudit(cb);
const cbTok = await token(cb);
const cbAll = await apiGet(cb, "/api/v1/audit/events?size=200", cbTok);
const cbRows = cbAll.body?.data ?? [];

// Ask for a Floating Terrace resource id explicitly — the one row the other tenant must never see.
const ftOrderId = "d71d67c0-b0b0-4bc1-9aff-3d775118117f"; // from the prover's own void
const cbSearchForFt = cbRows.filter((r) => r.resourceId === ftOrderId);

record("X_controlBistro", {
  trouble: cbTrouble,
  h1: cbScreen.h1,
  summary: cbScreen.summary,
  zoneNote: cbScreen.zoneNote,
  rowCount: cbScreen.rowCount,
  apiStatus: cbAll.status,
  apiTotal: cbAll.body?.meta?.totalCount ?? null,
  rowsReturned: cbRows.length,
  anyFloatingTerraceOrderRow: cbSearchForFt.length,
  distinctActorNames: [...new Set(cbRows.map((r) => r.userName).filter(Boolean))].slice(0, 12),
  anyTerraceLocalActor: [...new Set(cbRows.map((r) => r.userName).filter(Boolean))].filter((n) => /Terrace/i.test(n)),
});
await shot(cb, "r11-control-bistro-audit");

await browser.close();
log("\ndone — part 2");
