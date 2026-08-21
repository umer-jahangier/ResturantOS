/* DAY 2 — step 6: THE OWNER'S VIEW. Takings on the branch-local business date; a
 * transaction drilled to its journal entries; debits vs credits; the audit log. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const B = S.branchId;
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

// ── takings, today and yesterday ─────────────────────────────────────────────
for (const d of ["2026-08-12", "2026-08-11"]) {
  const tr = await go(owner, `/app/finance/takings?date=${d}`, { waitMs: 7000 });
  const t = await owner.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  const slice = t.slice(t.indexOf("Takings"), t.indexOf("Takings") + 1500);
  log(`\n=== TAKINGS ${d} (trouble ${JSON.stringify(tr.bad)}) ===`);
  log(" ", slice.slice(0, 1300));
  await shot(owner, `06a-takings-${d}`);
  saveState({ [`takings_${d}`]: slice });
}

// ── transactions ─────────────────────────────────────────────────────────────
let tr = await go(owner, "/app/finance/transactions", { waitMs: 7000 });
log("\n=== TRANSACTIONS (trouble", JSON.stringify(tr.bad), ") ===");
await shot(owner, "06b-transactions");
const txRows = await owner.evaluate(() =>
  Array.from(document.querySelectorAll("tr")).slice(0, 8).map((r) => r.innerText.replace(/\s*\n\s*/g, " | ").trim()),
);
log("  rows:", JSON.stringify(txRows, null, 1).slice(0, 1400));

// find my cash payment row and open it
const target = await owner.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("tr"));
  const r = rows.find((x) => x.innerText.includes("2,362.28"));
  if (!r) return null;
  const btn = r.querySelector("button, a");
  return { text: r.innerText.replace(/\s*\n\s*/g, " | ").trim(), btn: btn?.innerText.trim() ?? null, label: btn?.getAttribute("aria-label") ?? null };
});
log("  my cash row:", JSON.stringify(target));
if (target) {
  const openBtn = owner.locator("tr", { hasText: "2,362.28" }).locator("button, a").first();
  await openBtn.click();
  await owner.waitForTimeout(5000);
  await shot(owner, "06c-transaction-drilled");
  const je = await owner.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 2000));
  const i = je.indexOf("JE-");
  log("  DRILLED:", je.slice(Math.max(0, i - 700), i + 900));
  saveState({ drilled: je });
}

// ── audit log ────────────────────────────────────────────────────────────────
tr = await go(owner, "/app/settings/audit", { waitMs: 7000 });
log("\n=== AUDIT LOG (trouble", JSON.stringify(tr.bad), ") ===");
await shot(owner, "06d-audit-log");
const audit = await owner.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1600));
log("  ", audit.slice(0, 1200));

// filter to ORDER_VOIDED and DISCOUNT
for (const action of ["ORDER_VOIDED", "ORDER_DISCOUNT_APPLIED", "ORDER_DISCOUNTED"]) {
  const r = await apiGet(owner, `/api/v1/audit/events?action=${action}&size=5`);
  const rows = r.body?.data ?? [];
  log(`  API ${action} -> ${r.status} n=${Array.isArray(rows) ? rows.length : "?"}`,
    JSON.stringify((rows || []).slice(0, 2).map((e) => ({ a: e.action, at: e.occurredAt, actor: e.actorName ?? e.actorId, res: e.resourceType, meta: JSON.stringify(e.metadata ?? e.details ?? {}).slice(0, 200) }))).slice(0, 700));
}
// what the SCREEN can filter to
const filters = await owner.evaluate(() =>
  Array.from(document.querySelectorAll("select")).map((s) => ({ id: s.id, opts: Array.from(s.options).map((o) => o.textContent.trim()).slice(0, 40) })),
);
log("  audit screen filters:", JSON.stringify(filters).slice(0, 1200));
saveState({ auditScreen: audit, auditFilters: filters });
await browser.close();
