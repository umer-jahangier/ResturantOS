/*
 * F10 — INDEPENDENT RE-OPEN ATTEMPT (second reviewer).
 *
 * Assume the fix is incomplete. Drive the whole path myself, then attack the edges:
 *   A. cashier rings + settles a fresh check                (my own order, my own number)
 *   B. owner reads /app/finance/journal-entries             (row named, no UUID) + RELOAD persists
 *   C. search: exact / lowercase / partial / entry-no / "%" / no-match
 *   D. click through to the entry detail page
 *   E. pagination: page 2 must not repeat page 1
 *   F. adjacent recipes: COGS / refund descriptions
 *   G. wrong persona: cashier on the screen and on the new ?q= endpoint
 *   H. other tenant: Control Bistro must not find a Floating Terrace order
 *   I. other branch: the same owner scoped elsewhere
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log,
} from "./lib.mjs";
import { writeFileSync } from "node:fs";

const OUTJSON =
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F10/91-reopen-b.json";

const CONTROL_ACCOUNTANT = {
  slug: "control-bistro-isolation-test-tenant",
  email: "accountant@control.local",
  password: "Control#Accountant1",
  totpSecret: "EJBVEEJHZ5EISVP64TLCT54G52PKWWV2",
};

const browser = await newBrowser();
const out = {};
const fail = [];
const pass = [];
function must(cond, what) {
  if (cond) { log(`  PASS  ${what}`); pass.push(what); }
  else { log(`  FAIL  ${what}`); fail.push(what); }
}
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function readList(page) {
  return page.evaluate(() => {
    const table = document.querySelector("table");
    const rows = table
      ? Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim()))
      : [];
    return {
      rows,
      count: document.querySelector('[data-testid="je-result-count"]')?.textContent?.trim() ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
      bodySnip: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500),
    };
  });
}

try {
  // ───────────────────────── A. ring + settle ─────────────────────────
  log("\n=== A. cashier rings and settles a fresh check ===");
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);

  let till = null;
  for (let i = 0; i < 12; i++) {
    try {
      const t = await go(cash, "/app/pos", { waitMs: 8000, allowTrouble: true });
      till = await cash.evaluate(() =>
        /Till [A-Z]+[^\n]*/.exec(document.body.innerText)?.[0] ??
        /No active till/.exec(document.body.innerText)?.[0] ?? null);
      if (till && !/unavailable/i.test((t.alerts ?? []).join(" "))) break;
      log(`  attempt ${i + 1}: terminal not usable — ${JSON.stringify(t?.alerts).slice(0, 140)}`);
    } catch (e) { log(`  attempt ${i + 1}: raced (${e.message.slice(0, 70)})`); }
    await cash.waitForTimeout(7000);
  }
  out.tillStrip = till;
  log("  till strip:", till);
  if (!till) throw new Error("POS terminal never became usable");

  out.orderTypes = await cash.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid^=order-type-]"))
      .map((n) => n.getAttribute("data-testid")));
  log("  order types on the terminal:", JSON.stringify(out.orderTypes));

  // Deliberately NOT the takeaway chip the first proof used.
  const chip = out.orderTypes.includes("order-type-dine-in")
    ? "order-type-dine-in" : out.orderTypes[0];
  out.orderTypeUsed = chip;
  await cash.locator(`[data-testid=${chip}]`).click();
  await cash.waitForTimeout(1200);

  // Dine-in wants a table; pick one if the screen offers it.
  const tableBtn = cash.locator("[data-testid^=table-card-], [data-testid^=table-tile-]");
  if (await tableBtn.count()) {
    await tableBtn.first().click();
    await cash.waitForTimeout(1200);
    log("  picked a table");
  }

  const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(1).click(); await cash.waitForTimeout(400);
  await tiles.nth(4).click(); await cash.waitForTimeout(400);
  await tiles.nth(4).click(); await cash.waitForTimeout(900);
  await shot(cash, "91a-cart");

  await cash.locator("[data-testid=send-to-kitchen-button]").click();
  await cash.waitForTimeout(9000);
  out.orderNo = await cash.evaluate(
    () => /ORD-\d{8}-\d{4}/.exec(document.body.innerText)?.[0] ?? null);
  await shot(cash, "91b-fired");
  if (!out.orderNo) throw new Error("no order number after Send to Kitchen");
  log(`  fired: ${out.orderNo}`);

  await cash.locator("button, a").filter({ hasText: /charge/i }).first().click();
  await cash.waitForTimeout(7000);
  out.orderId = /\/orders\/([0-9a-f-]{36})\//.exec(cash.url())?.[1] ?? null;
  log("  orderId:", out.orderId);

  const fillBtn = cash.locator("[data-testid=fill-full-amount-button]");
  if (await fillBtn.count()) { await fillBtn.first().click(); await cash.waitForTimeout(800); }
  const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    const amount = await cash.locator('[aria-label="Amount (Rs)"]').first().inputValue();
    out.amountOnCharge = amount;
    await tendered.fill(String(Math.ceil(Number(amount) || 0) + 100));
    await cash.waitForTimeout(800);
  }
  await cash.locator("[data-testid=record-payment-button]").click();
  await cash.waitForTimeout(9000);
  out.payErr = await cash.evaluate(
    () => document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null);
  await shot(cash, "91c-paid");
  log("  payment error:", out.payErr);

  for (let i = 0; i < 6; i++) {
    const closeBtn = cash.locator("[data-testid=close-order-button]");
    if (!(await closeBtn.count())) break;
    await closeBtn.first().click();
    await cash.waitForTimeout(9000);
    const err = await cash.evaluate(
      () => /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null);
    if (!err) break;
    log("  ! close refused:", err);
    await cash.waitForTimeout(6000);
    await go(cash, `/app/pos/orders/${out.orderId}/charge`, { waitMs: 6000, allowTrouble: true });
  }
  await shot(cash, "91d-closed");

  // ───────────────────────── B. owner reads the ledger ─────────────────────────
  log("\n=== B. owner opens /app/finance/journal-entries ===");
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  let view = null;
  for (let i = 0; i < 18; i++) {
    const t = await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
    if (t.bad.length) log("  ! page trouble:", JSON.stringify(t));
    view = await readList(owner);
    if (view.rows.some((r) => r.some((c) => c.includes(out.orderNo)))) break;
    log(`  attempt ${i + 1}: not visible yet (first row ${JSON.stringify(view.rows[0])})`);
    await owner.waitForTimeout(5000);
  }
  out.unfiltered = view;
  await shot(owner, "91e-list-unfiltered");
  const myRow = view.rows.find((r) => r.some((c) => c.includes(out.orderNo))) ?? null;
  out.myRow = myRow;
  log("  my row:", JSON.stringify(myRow));
  log("  count line:", view.count);

  must(myRow != null, `the UNFILTERED first page carries a row naming ${out.orderNo}`);
  must((myRow ?? []).includes(`Order revenue ${out.orderNo}`),
    `its description is exactly "Order revenue ${out.orderNo}"`);
  must(!(myRow ?? []).some((c) => UUID_RE.test(c)), "no UUID anywhere in that row");
  must((view.alerts ?? []).length === 0, "no [role=alert] on the ledger screen");
  must(view.count != null && /Showing \d+ of \d+ entr/.test(view.count),
    `the screen says how much of the ledger it is showing (${view.count})`);
  // debits == credits on my row (money invariant)
  const dr = (myRow ?? [])[4], cr = (myRow ?? [])[5];
  out.drcr = { dr, cr };
  must(dr != null && dr === cr, `debits equal credits on my row (${dr} / ${cr})`);

  log("\n--- B2. reload: does it persist? ---");
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(5000);
  const afterReload = await readList(owner);
  out.afterReload = { count: afterReload.count, has: afterReload.rows.some((r) => r.some((c) => c.includes(out.orderNo))) };
  must(out.afterReload.has, "after a full reload the row is still named by the order number");

  // ───────────────────────── C. search ─────────────────────────
  log("\n=== C. search box ===");
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  must((await box.count()) === 1, "there is exactly one search box with an accessible name");

  async function search(term, waitMs = 4500) {
    await box.fill(term);
    await owner.waitForTimeout(waitMs);
    return readList(owner);
  }

  const exact = await search(out.orderNo);
  out.searchExact = exact;
  await shot(owner, "91f-search-exact");
  log("  exact:", exact.count, JSON.stringify(exact.rows));
  must(exact.rows.length >= 1, "exact order number finds the row");
  must(exact.rows.every((r) => r.some((c) => c.includes(out.orderNo))),
    "and every returned row is about that order");

  const lower = await search(out.orderNo.toLowerCase());
  out.searchLower = { count: lower.count, n: lower.rows.length };
  log("  lowercase:", lower.count, lower.rows.length);
  must(lower.rows.length >= 1, "the search is case-insensitive (lowercased order number still finds it)");

  const partial = await search(out.orderNo.slice(-4));
  out.searchPartial = { count: partial.count, n: partial.rows.length,
    mine: partial.rows.some((r) => r.some((c) => c.includes(out.orderNo))) };
  log("  partial (last 4):", partial.count, partial.rows.length);
  must(out.searchPartial.mine, "a partial order number (last 4 digits) still finds the row");

  const entryNo = (myRow ?? [])[0];
  out.entryNo = entryNo;
  const byEntry = await search(entryNo);
  out.searchByEntryNo = { count: byEntry.count, n: byEntry.rows.length,
    mine: byEntry.rows.some((r) => r[0] === entryNo) };
  log("  by entry no:", entryNo, byEntry.count, byEntry.rows.length);
  must(out.searchByEntryNo.mine, `searching the entry number ${entryNo} finds the same row`);

  const pct = await search("%");
  out.searchPercent = { count: pct.count, n: pct.rows.length, snip: pct.bodySnip.slice(0, 160) };
  log("  '%':", pct.count, pct.rows.length);
  must(pct.rows.length === 0, "a bare '%' is treated as text, not as a wildcard matching the ledger");

  const none = await search("ORD-19990101-0001");
  out.searchNoMatch = { snip: none.bodySnip, alerts: none.alerts };
  await shot(owner, "91g-search-no-match");
  must(/No entry matches/.test(none.bodySnip), 'a no-match term says "No entry matches …"');
  must(!/No journal entries/.test(none.bodySnip), "and does NOT claim the ledger is empty");

  // ───────────────────────── D. entry detail ─────────────────────────
  log("\n=== D. open the entry ===");
  await search(out.orderNo);
  await owner.locator("table tbody tr").first().click();
  await owner.waitForTimeout(5000);
  out.detail = await owner.evaluate((no) => ({
    url: location.href,
    namesOrder: (document.body.innerText || "").includes(no),
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }), out.orderNo);
  await shot(owner, "91h-entry-detail");
  log("  detail url:", out.detail.url);
  must(/journal-entries\/[0-9a-f-]{36}/.test(out.detail.url), "the row opens a real entry page");
  must(out.detail.namesOrder, "the entry page names the order number too");
  must((out.detail.alerts ?? []).length === 0, "no error state on the entry page");

  // ───────────────────────── E. pagination ─────────────────────────
  log("\n=== E. pagination: page 2 must not repeat page 1 ===");
  await go(owner, "/app/finance/journal-entries", { waitMs: 5000 });
  const p1 = await readList(owner);
  const nextBtn = owner.locator("button", { hasText: /^Next$/ });
  out.hasNext = (await nextBtn.count()) > 0 && !(await nextBtn.first().isDisabled());
  log("  page 1 rows:", p1.rows.length, "count:", p1.count, "next enabled:", out.hasNext);
  if (out.hasNext) {
    await nextBtn.first().click();
    await owner.waitForTimeout(5000);
    const p2 = await readList(owner);
    await shot(owner, "91i-page-2");
    const ids1 = new Set(p1.rows.map((r) => r[0]));
    const dupes = p2.rows.map((r) => r[0]).filter((e) => ids1.has(e));
    out.pagination = { p1: p1.rows.length, p2: p2.rows.length, dupes, p1First: p1.rows[0]?.[0], p2First: p2.rows[0]?.[0] };
    log("  page 2 rows:", p2.rows.length, "overlap with page 1:", dupes.length);
    must(p2.rows.length > 0, "Next actually loads a second page");
    must(dupes.length === 0, "page 2 repeats none of page 1's entry numbers");
    const prevBtn = owner.locator("button", { hasText: /^Previous$/ });
    await prevBtn.first().click();
    await owner.waitForTimeout(5000);
    const back = await readList(owner);
    out.pagination.backFirst = back.rows[0]?.[0];
    must(back.rows[0]?.[0] === p1.rows[0]?.[0], "Previous returns to the same page 1");
  } else {
    out.pagination = { note: "Next was absent/disabled — the ledger fits on one page" };
    log("  (no second page)");
  }

  // sort order sanity: dates must be non-increasing down page 1
  const dates = p1.rows.map((r) => r[1]);
  out.dateOrderOk = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
  must(out.dateOrderOk, "page 1 is sorted newest-first by date");

  // ───────────────────────── F. adjacent recipes ─────────────────────────
  log("\n=== F. adjacent auto-posting recipes ===");
  const bySource = await apiGet(
    owner, `/api/v1/finance/journal-entries/by-source/${out.orderId}`);
  out.bySource = {
    status: bySource.status,
    rows: (bySource.body?.data ?? []).map((j) => `${j.entryNo} ${j.sourceType} :: ${j.description}`),
  };
  log("  every entry this order produced:", JSON.stringify(out.bySource, null, 1));
  const uuidNamed = out.bySource.rows.filter((r) => UUID_RE.test(r));
  out.uuidNamedSiblings = uuidNamed;
  log("  siblings still named by UUID:", JSON.stringify(uuidNamed));

  // a wider sweep: how much of the branch's ledger still reads as a UUID today?
  const sweep = await apiGet(owner, "/api/v1/finance/journal-entries?q=Order&size=200");
  const sweepRows = (sweep.body?.data ?? []).map((j) => j.description ?? "");
  out.sweep = {
    status: sweep.status,
    total: sweep.body?.meta?.totalCount ?? null,
    n: sweepRows.length,
    uuidDescribed: sweepRows.filter((d) => UUID_RE.test(d)).length,
    sampleUuid: sweepRows.filter((d) => UUID_RE.test(d)).slice(0, 6),
    sampleNamed: sweepRows.filter((d) => /ORD-\d{8}-\d{4}/.test(d)).slice(0, 4),
  };
  log("  sweep of 'Order…' entries:", JSON.stringify(out.sweep, null, 1));

  // ───────────────────────── G. wrong persona ─────────────────────────
  log("\n=== G. wrong persona — cashier ===");
  const t2 = await go(cash, "/app/finance/journal-entries", { waitMs: 5000, allowTrouble: true });
  out.cashierScreen = { ...t2, text: await cash.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300)) };
  await shot(cash, "91j-cashier-ledger");
  log("  cashier sees:", JSON.stringify(out.cashierScreen).slice(0, 400));
  const cashierApi = await apiGet(cash, `/api/v1/finance/journal-entries?q=${encodeURIComponent(out.orderNo)}`);
  out.cashierApi = { status: cashierApi.status, code: cashierApi.body?.error?.code ?? null,
    n: (cashierApi.body?.data ?? []).length };
  log("  cashier GET ?q= :", JSON.stringify(out.cashierApi));
  must(out.cashierApi.status === 403 || out.cashierApi.status === 401,
    `the new ?q= endpoint refuses a cashier (got ${out.cashierApi.status})`);
  must(out.cashierApi.n === 0, "and returns no ledger rows to a cashier");

  // ───────────────────────── H. other tenant ─────────────────────────
  log("\n=== H. other tenant — Control Bistro ===");
  const ctrl = await newPage(browser);
  try {
    await login(ctrl, CONTROL_ACCOUNTANT);
    const ct = await go(ctrl, "/app/finance/journal-entries", { waitMs: 5000, allowTrouble: true });
    const cview = await readList(ctrl);
    out.controlUnfiltered = { count: cview.count, n: cview.rows.length, bad: ct.bad };
    const cbox = ctrl.getByRole("textbox", {
      name: "Search journal entries by entry number or description" });
    let crossRows = [];
    if (await cbox.count()) {
      await cbox.fill(out.orderNo);
      await ctrl.waitForTimeout(4500);
      const cs = await readList(ctrl);
      crossRows = cs.rows;
      out.controlSearch = { count: cs.count, n: cs.rows.length, snip: cs.bodySnip.slice(0, 200) };
    }
    await shot(ctrl, "91k-control-search");
    const capi = await apiGet(ctrl, `/api/v1/finance/journal-entries?q=${encodeURIComponent(out.orderNo)}`);
    out.controlApi = { status: capi.status, n: (capi.body?.data ?? []).length,
      rows: (capi.body?.data ?? []).map((j) => j.description) };
    log("  control tenant search:", JSON.stringify(out.controlSearch), JSON.stringify(out.controlApi));
    must(crossRows.length === 0, "Control Bistro's accountant finds NO row for a Floating Terrace order");
    must(out.controlApi.n === 0, "and the ?q= endpoint returns them nothing either");
  } catch (e) {
    out.controlError = e.message.slice(0, 300);
    log("  ! control tenant leg failed:", out.controlError);
    fail.push(`cross-tenant leg could not be driven: ${out.controlError}`);
  }

  out.pass = pass;
  out.failures = fail;
  writeFileSync(OUTJSON, JSON.stringify(out, null, 2));
  log(`\n=== ${fail.length === 0 ? `ALL ${pass.length} CHECKS PASSED` : `${fail.length} CHECK(S) FAILED`} ===`);
  fail.forEach((f) => log(`  - ${f}`));
} catch (e) {
  out.fatal = `${e.message}\n${e.stack}`.slice(0, 1500);
  out.failures = fail;
  writeFileSync(OUTJSON, JSON.stringify(out, null, 2));
  log("FATAL:", out.fatal);
} finally {
  await browser.close();
}
