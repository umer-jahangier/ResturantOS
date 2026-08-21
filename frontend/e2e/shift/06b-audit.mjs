/*
 * SHIFT STEP 6b — is the void in the audit log, with an actor? And what does the
 * "Voided" row on the order list actually attribute the void to?
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, tokenOf, log } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
await go(owner, "/app/dashboard", { waitMs: 4000 });
const tok = await tokenOf(owner);

// Everything the audit service recorded in the window my shift ran.
for (const q of [
  "/api/v1/audit/events?size=200",
  "/api/v1/audit/events?action=ORDER_VOIDED&size=20",
  "/api/v1/audit/events?resourceType=ORDER&size=40",
]) {
  const r = await apiGet(owner, q, tok);
  const rows = r.body?.data ?? [];
  log(`\n  ${q} → ${r.status}, ${Array.isArray(rows) ? rows.length : "?"} rows`);
  if (Array.isArray(rows) && rows.length) {
    const kinds = {};
    for (const e of rows) kinds[e.action] = (kinds[e.action] ?? 0) + 1;
    log("   actions:", JSON.stringify(kinds));
    const posish = rows.filter((e) => /ORDER|VOID|DISCOUNT|PAYMENT|REFUND|TILL/i.test(e.action ?? "") || /ORDER|TILL/i.test(e.resourceType ?? ""));
    log("   pos-shaped events:", posish.length);
    for (const e of posish.slice(0, 6)) log("     ", JSON.stringify({ at: e.occurredAt, a: e.action, rt: e.resourceType, rid: e.resourceId, u: e.userId }));
    saveState({ [`audit_${q.split("?")[1].split("&")[0]}`]: { count: rows.length, kinds } });
  } else {
    log("   body:", JSON.stringify(r.body).slice(0, 300));
  }
}

// what a reports/audit URL actually renders
const t = await go(owner, "/app/reports/audit", { waitMs: 6000, allowTrouble: true });
log("\n  /app/reports/audit trouble:", JSON.stringify(t));
await shot(owner, "06d-reports-audit");
const rep = await owner.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 600));
log("  renders:", rep);
saveState({ reportsAudit: rep });

// the reports index — is there an audit/void/discount report at all?
await go(owner, "/app/reports", { waitMs: 6000 });
await shot(owner, "06e-reports-index");
const reports = await owner.evaluate(() => ({
  links: Array.from(document.querySelectorAll("a")).map((a) => ({ t: a.textContent.replace(/\s+/g, " ").trim(), h: a.getAttribute("href") })).filter((x) => x.h?.includes("/app/reports/")),
  body: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
}));
log("\n  reports available:", JSON.stringify(reports.links.map((l) => l.t), null, 1));
saveState({ reportsIndex: reports.links });

// the Voided row — who does it say voided it?
await go(owner, "/app/pos", { waitMs: 7000 });
await owner.getByText("Order Management", { exact: true }).click();
await owner.waitForTimeout(4000);
const allBtn = owner.locator("[data-testid=toggle-all-branch]");
if (await allBtn.count()) { await allBtn.click(); await owner.waitForTimeout(3000); }
await owner.locator('[data-testid="status-filter-VOIDED"]').click();
await owner.waitForTimeout(4000);
await shot(owner, "06f-voided-rows");
const voidRows = await owner.evaluate((nums) => {
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const out = [];
  for (const n of nums) {
    const r = rows.find((x) => x.innerText.includes(n));
    if (r) out.push({ no: n, cells: Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()) });
  }
  return { headers: Array.from(document.querySelectorAll("thead th")).map((n) => n.textContent.trim()), out };
}, [st.order3No, "ORD-20260812-0168"]);
log("\n  voided rows:", JSON.stringify(voidRows, null, 1));
saveState({ voidedRows: voidRows });

// expand one to see the settlement detail (who + reason)
const det = owner.locator(`[data-testid="settlement-detail-${st.order3Id}"]`);
log("  settlement-detail control:", await det.count());
if (await det.count()) {
  await det.click();
  await owner.waitForTimeout(2500);
  await shot(owner, "06g-void-detail");
  const d = await owner.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    return rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()).filter((x) => /void|refund|by |reason/i.test(x)).slice(0, 5);
  });
  log("  void detail rows:", JSON.stringify(d, null, 1));
  saveState({ voidDetail: d });
}

await browser.close();
log("\nstep 6b done");
