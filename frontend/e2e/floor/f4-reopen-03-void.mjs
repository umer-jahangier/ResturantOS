/*
 * F4 RE-OPEN, part 3 — the question an audit log exists to answer.
 *
 * The MANAGER rings a check on the POS and voids it with a reason nobody else could have typed.
 * The OWNER, in a different browser context pinned to America/New_York, then finds that row:
 * named actor, the reason verbatim, and a timestamp that is Karachi's rather than the browser's.
 *
 * Also: does the DETAIL panel open the row it was pressed on, and does the ORDER's resourceId let
 * a reader pivot from the Order Management screen to the audit row and back.
 */
import { launch, ctx, signIn, shot, trouble, readAudit, record, log, apiGet, token, PEOPLE, BASE } from "./f4-reopen-lib.mjs";

const browser = await launch();
const REASON = `F4 RE-OPEN independent check ${new Date().toISOString().slice(11, 19)} ${Math.random().toString(36).slice(2, 7)}`;

// ── 1. MANAGER rings and voids ─────────────────────────────────────────────
log("\n=== MANAGER rings a takeaway check and voids it ===");
const mgr = await ctx(browser, { tz: "America/New_York" });
await signIn(mgr, PEOPLE.manager);

async function ringAndVoid() {
  await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(11_000);
  if (await mgr.locator("[data-testid=query-service-outage]").count()) throw new Error("pos outage on terminal");
  await mgr.locator("[data-testid=order-type-takeaway]").click({ timeout: 25_000 });
  await mgr.waitForTimeout(1000);
  const tiles = mgr.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30_000 });
  await tiles.nth(1).click();
  await mgr.waitForTimeout(1000);
  await mgr.locator("[data-testid=send-to-kitchen-button]").click({ timeout: 25_000 });
  await mgr.waitForTimeout(9000);
  const nums = await mgr.evaluate(() =>
    Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))));
  if (!nums.length) throw new Error("no order number after Send to Kitchen");
  const no = nums[0];
  log(`  rang ${no}`);

  await mgr.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(8000);
  await mgr.getByText("Order Management", { exact: true }).click();
  await mgr.waitForTimeout(5000);
  await mgr.locator("[data-testid=order-management-search]").first().fill(no);
  await mgr.waitForTimeout(6500);
  await mgr.locator('[data-testid^="open-order-"]').first().click({ timeout: 30_000 });
  await mgr.waitForTimeout(4000);
  await mgr.getByLabel("Void order").first().click({ timeout: 25_000 });
  await mgr.waitForTimeout(2000);
  const ta = mgr.locator("[data-testid=void-refund-panel] textarea");
  if (await ta.count()) await ta.first().fill(REASON);
  else await mgr.locator("[data-testid=void-refund-panel] input").first().fill(REASON);
  await mgr.waitForTimeout(500);
  await mgr.locator("[data-testid=void-refund-panel] button", { hasText: /Confirm Void|Void Order|Void/i }).last().click();
  await mgr.waitForTimeout(7500);
  const outcome = await mgr.evaluate(() => ({
    err: document.querySelector("[data-testid=void-error]")?.textContent?.trim() ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
    body: /VOIDED/i.test(document.body.innerText),
  }));
  return { no, outcome };
}

let voided = null;
for (let i = 1; i <= 3 && !voided; i++) {
  try {
    voided = await ringAndVoid();
  } catch (e) {
    log(`  attempt ${i} failed: ${e.message}`);
    if (i === 3) throw e;
    await mgr.waitForTimeout(6000);
  }
}
record("V_voidByManager", { ...voided, reason: REASON });
await shot(mgr, "r20-manager-voided");
await mgr.context().close();

// ── 2. OWNER finds it ──────────────────────────────────────────────────────
log("\n=== OWNER finds that void in the audit log ===");
const owner = await ctx(browser, { tz: "America/New_York" });
await signIn(owner, PEOPLE.owner);
await owner.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
await owner.waitForTimeout(11_000);
let t = await trouble(owner);
if (t.bad.length) {
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(9000);
  t = await trouble(owner);
}
record("V_ownerScreenTrouble", t);

await owner.selectOption("#audit-action", "ORDER_VOIDED");
await owner.waitForTimeout(7000);
const filtered = await readAudit(owner);
const hit = filtered.rows.find((cells) => cells.some((c) => c.includes(REASON)));
record("V_rowOnScreen", {
  found: Boolean(hit),
  cells: hit ?? null,
  summary: filtered.summary,
  searchedRows: filtered.rowCount,
});
await shot(owner, "r21-owner-sees-the-void");

if (!hit) throw new Error("REOPENED: the void the manager just made is not on the owner's audit screen");

// the same row over the API, to compare the stored instant with what was rendered
const tok = await token(owner);
const api = await apiGet(owner, "/api/v1/audit/events?action=ORDER_VOIDED&size=25&zone=Asia/Karachi", tok);
const apiRow = (api.body?.data ?? []).find((r) => (r.metadata || "").includes(REASON) || (r.afterState || "").includes(REASON));
const zoneMath = apiRow
  ? await owner.evaluate(({ iso }) => ({
      browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      storedUtc: iso,
      utc: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)),
      karachi: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Karachi" }).format(new Date(iso)),
      newYork: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/New_York" }).format(new Date(iso)),
    }), { iso: apiRow.occurredAt })
  : null;
record("V_apiRow", apiRow ? { id: apiRow.id, action: apiRow.action, resourceType: apiRow.resourceType, resourceId: apiRow.resourceId, userId: apiRow.userId, userName: apiRow.userName } : null);
record("V_zoneMath", { ...zoneMath, renderedOnScreen: hit?.[0] ?? null });

// ── 3. the Details panel opens THIS row ────────────────────────────────────
const rowIndex = filtered.rows.findIndex((cells) => cells.some((c) => c.includes(REASON)));
await owner.locator('table[aria-label="Audit log"] tbody tr').nth(rowIndex).locator("button", { hasText: "Details" }).click();
await owner.waitForTimeout(2500);
record("V_detailPanel", await owner.evaluate(() => {
  const p = document.querySelector("[data-testid=audit-detail-panel]");
  return p ? (p.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700) : null;
}));
await shot(owner, "r22-owner-void-detail");

// ── 4. does the count of ORDER_VOIDED go UP by exactly this one? ───────────
record("V_totalNow", (await readAudit(owner)).summary);

record("V_ownerConsoleErrors", [...new Set(owner.__errors)].slice(0, 8));
await browser.close();
log("\ndone — part 3");
