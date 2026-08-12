/*
 * Close the paid check by clicking, patiently, and then read the CLOSED-state notice as both
 * personas. My earlier pass queried the Mark Served buttons before the drawer had rendered them
 * and counted zero — a harness fact that looks exactly like a dead button. Wait for the control.
 */
import {
  PEOPLE, newBrowser, newPage, orderRow, openInOrderManagement, log, BASE, shot, loadState, saveState,
} from "./lib.mjs";

async function signIn(page, who) {
  for (let a = 0; a < 3; a++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    for (let i = 0; i < 25; i++) { await page.waitForTimeout(1000); if (!page.url().includes("/login")) break; }
    if (!page.url().includes("/login")) { log(`  ✓ ${who.email}`); return; }
  }
  throw new Error("login failed " + who.email);
}
async function probe(page, where) {
  return page.evaluate((w) => {
    const n = document.querySelector("[data-testid=void-blocked-paid-notice]");
    const row = n?.parentElement ?? null;
    return {
      where: w,
      notice: n?.textContent?.trim() ?? null,
      readerCanRefundAttr: n?.getAttribute("data-reader-can-refund") ?? null,
      refundTrigger: !!document.querySelector('[aria-label="Refund order"]'),
      voidTrigger: !!document.querySelector('[aria-label="Void order"]'),
      paidChip: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
      emptyActionRow: row ? row.children.length === 0 : null,
      actionRowButtons: row ? Array.from(row.querySelectorAll("button")).map((b) => b.getAttribute("aria-label") || b.textContent.trim()) : null,
      chip: (document.body.innerText.match(/\b(Closed|In Progress|Served|Voided|Refunded)\b/) || [null])[0],
    };
  }, where);
}
const results = []; const fails = [];
const check = (n, ok, d) => { results.push({ n, ok, d }); log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

const st = loadState();
const ORDER_NO = st.bOrderNo;
const browser = await newBrowser();
const cashier = await newPage(browser);
const serveCalls = [];
cashier.on("response", (r) => { if (/\/serve/.test(r.url())) serveCalls.push({ s: r.status(), u: r.url().replace("http://localhost:8080", "") }); });
await signIn(cashier, PEOPLE.cashier);
await openInOrderManagement(cashier, ORDER_NO);

for (let round = 0; round < 8; round++) {
  const row = await orderRow(cashier, ORDER_NO);
  const status = row?.status ?? row?.settlementStatus;
  if (status === "CLOSED") { log(`  round ${round}: already CLOSED`); break; }
  const btn = cashier.locator('button:text-is("Mark Served")');
  let n = 0;
  try { await btn.first().waitFor({ state: "visible", timeout: 20000 }); n = await btn.count(); }
  catch { n = 0; }
  log(`  round ${round}: server=${status} markServed=${n}`);
  if (!n) break;
  await btn.first().click();
  await cashier.waitForTimeout(5000);
}
await cashier.waitForTimeout(4000);
const row = await orderRow(cashier, ORDER_NO);
const status = row?.status ?? row?.settlementStatus;
log("  serve calls:", JSON.stringify(serveCalls.slice(-6)));
check("the paid check settles to CLOSED by clicking Mark Served", status === "CLOSED", `status=${status}`);

await cashier.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
await cashier.waitForTimeout(6000);
await openInOrderManagement(cashier, ORDER_NO);
const p = await probe(cashier, "cashier-closed");
log("  cashier:", JSON.stringify(p));
await shot(cashier, "r9-cashier-closed-drawer");
if (status === "CLOSED") {
  check("CLOSED: the cashier's action row is not empty", p.emptyActionRow === false, JSON.stringify(p.actionRowButtons));
  check("CLOSED: told a manager must refund", /manager/i.test(p.notice ?? ""), JSON.stringify(p.notice));
  check("CLOSED: not told to press Refund", !/use refund/i.test(p.notice ?? ""), JSON.stringify(p.notice));
  check("CLOSED: no Refund button for the cashier", p.refundTrigger === false);
}
const manager = await newPage(browser);
await signIn(manager, PEOPLE.manager);
await openInOrderManagement(manager, ORDER_NO);
const pm = await probe(manager, "manager-closed");
log("  manager:", JSON.stringify(pm));
await shot(manager, "r9-manager-closed-drawer");
if (status === "CLOSED") check("CLOSED: the manager has the Refund button", pm.refundTrigger === true, JSON.stringify(pm.actionRowButtons));

await browser.close();
saveState({ reopenB_closedRetry: { status, cashier: p, manager: pm, results } });
log("\n" + (fails.length ? `FAILED (${fails.length}): ${fails.join(" | ")}` : "ALL CHECKS PASS"));
process.exit(fails.length ? 1 : 0);
