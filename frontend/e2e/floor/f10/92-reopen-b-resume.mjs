/*
 * F10 independent re-open — part 2. Resumes from an already-fired check (argv[2] = ORD-…),
 * resolves its id through the POS API on the cashier's OWN bearer, settles and closes it, then
 * runs the whole owner-side battery: list, reload, search (exact/lower/partial/entry-no/%/none),
 * entry detail, pagination, adjacent recipes, wrong persona, other tenant.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, apiSend, log,
} from "./lib.mjs";
import { writeFileSync } from "node:fs";

const ORDER_NO = process.argv[2];
if (!ORDER_NO) throw new Error("pass the order number");
const OUTJSON =
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F10/91-reopen-b.json";

const CONTROL_ACCOUNTANT = {
  slug: "control-bistro-isolation-test-tenant",
  email: "accountant@control.local",
  password: "Control#Accountant1",
  totpSecret: "EJBVEEJHZ5EISVP64TLCT54G52PKWWV2",
};

const browser = await newBrowser();
const out = { orderNo: ORDER_NO };
const fail = [], pass = [];
function must(cond, what) {
  if (cond) { log(`  PASS  ${what}`); pass.push(what); }
  else { log(`  FAIL  ${what}`); fail.push(what); }
}
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Ten agents share this machine and the same seeded accounts. A concurrent sign-in as the same
 * principal makes the login POST answer 409 "This record changed while you were editing it" —
 * an optimistic-lock collision on the user row, not a bad credential. Retry rather than report
 * a failure that says nothing about the feature under test.
 */
async function loginFresh(who, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    const page = await newPage(browser);
    try { await login(page, who); return page; }
    catch (e) {
      last = e;
      log(`  login attempt ${i + 1} for ${who.email} failed: ${e.message.slice(0, 160)}`);
      await page.context().close().catch(() => {});
      await new Promise((r) => setTimeout(r, 8000 + i * 6000));
    }
  }
  throw last;
}

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
      bodySnip: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 600),
    };
  });
}

try {
  log(`\n=== A. settle ${ORDER_NO} ===`);
  const cash = await loginFresh(PEOPLE.cashier);

  const branchId = await cash.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    const tok = j?.accessToken ?? j?.data?.accessToken;
    return JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).branch_id;
  });
  out.branchId = branchId;
  let found = null;
  for (let i = 0; i < 12; i++) {
    const list = await apiGet(cash, `/api/v1/pos/orders?branchId=${branchId}&q=${ORDER_NO}`);
    found = (list.body?.data ?? []).find((o) => o.orderNo === ORDER_NO) ?? null;
    log(`  orders list attempt ${i + 1}: ${list.status} -> ${found ? found.orderId : "null"}`);
    if (found) break;
    // 503 here is pos-service being restarted by a sibling agent, not a missing order.
    await cash.waitForTimeout(10000);
  }
  out.orderId = found?.orderId ?? process.argv[3] ?? null;
  out.orderStatusBefore = found ? `${found.type}/${found.derivedStatus}/${found.paymentStatus}` : null;
  log("  resolved:", out.orderId, "status", out.orderStatusBefore);
  if (!out.orderId) throw new Error(`could not resolve ${ORDER_NO} from GET /api/v1/pos/orders`);
  if (found && found.paymentStatus === "PAID" && /CLOSED|SERVED/.test(found.derivedStatus)) {
    log("  (already paid; the close loop below will confirm nothing is left to do)");
  }

  for (let i = 0; i < 10; i++) {
    await go(cash, `/app/pos/orders/${out.orderId}/charge`, { waitMs: 7000, allowTrouble: true });
    const st = await cash.evaluate(() => ({
      payBtn: !!document.querySelector("[data-testid=record-payment-button]"),
      closeBtn: !!document.querySelector("[data-testid=close-order-button]"),
      err: /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null,
      snip: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 260),
    }));
    log(`  charge attempt ${i + 1}:`, JSON.stringify(st).slice(0, 320));
    if (st.payBtn) {
      const fillBtn = cash.locator("[data-testid=fill-full-amount-button]");
      if (await fillBtn.count()) { await fillBtn.first().click(); await cash.waitForTimeout(900); }
      const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
      if (await tendered.count()) {
        const amount = await cash.locator('[aria-label="Amount (Rs)"]').first().inputValue();
        out.amountOnCharge = amount;
        await tendered.fill(String(Math.ceil(Number(amount) || 0) + 100));
        await cash.waitForTimeout(800);
      }
      await shot(cash, "92a-charge");
      await cash.locator("[data-testid=record-payment-button]").first().click();
      await cash.waitForTimeout(9000);
      out.payErr = await cash.evaluate(
        () => document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null);
      log("  payment error:", out.payErr);
      continue;
    }
    if (st.closeBtn) {
      await cash.locator("[data-testid=close-order-button]").first().click();
      await cash.waitForTimeout(9000);
      const after = await cash.evaluate(
        () => /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null);
      if (!after) { out.closed = true; log("  ✓ close accepted"); break; }
      log("  ! close refused:", after);
      await cash.waitForTimeout(8000);
      continue;
    }
    if (!st.err) { out.closed = true; log("  ✓ nothing left to do — order is closed"); break; }
    await cash.waitForTimeout(8000);
  }
  await shot(cash, "92b-after-close");
  if (!out.closed) throw new Error("could not settle/close the check");

  // ───────────────── B. owner reads the ledger ─────────────────
  log("\n=== B. owner opens /app/finance/journal-entries ===");
  const owner = await loginFresh(PEOPLE.owner);

  let view = null;
  for (let i = 0; i < 18; i++) {
    const t = await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
    if (t.bad.length) log("  ! page trouble:", JSON.stringify(t));
    view = await readList(owner);
    if (view.rows.some((r) => r.some((c) => c.includes(ORDER_NO)))) break;
    log(`  attempt ${i + 1}: not visible yet (first row ${JSON.stringify(view.rows[0])})`);
    await owner.waitForTimeout(5000);
  }
  out.unfiltered = { count: view.count, n: view.rows.length, first: view.rows[0], alerts: view.alerts };
  await shot(owner, "92c-list-unfiltered");
  const myRow = view.rows.find((r) => r.some((c) => c.includes(ORDER_NO))) ?? null;
  out.myRow = myRow;
  log("  my row:", JSON.stringify(myRow), "| count:", view.count);

  must(myRow != null, `the UNFILTERED first page carries a row naming ${ORDER_NO}`);
  must((myRow ?? []).includes(`Order revenue ${ORDER_NO}`),
    `its description is exactly "Order revenue ${ORDER_NO}"`);
  must(!(myRow ?? []).some((c) => UUID_RE.test(c)), "no UUID anywhere in that row");
  must((view.alerts ?? []).length === 0, "no [role=alert] on the ledger screen");
  must(view.count != null && /Showing \d+ of \d+ entr/.test(view.count),
    `the screen says how much of the ledger it shows (${view.count})`);
  const dr = (myRow ?? [])[4], cr = (myRow ?? [])[5];
  out.drcr = { dr, cr };
  must(dr != null && dr === cr, `debits equal credits on my row (${dr} / ${cr})`);

  log("\n--- B2. reload ---");
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(5500);
  const rl = await readList(owner);
  out.afterReload = { count: rl.count, has: rl.rows.some((r) => r.some((c) => c.includes(ORDER_NO))) };
  must(out.afterReload.has, "after a full reload the row is still named by the order number");

  // ───────────────── C. search ─────────────────
  log("\n=== C. search ===");
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description" });
  must((await box.count()) === 1, "exactly one search box with an accessible name");
  async function search(term, waitMs = 4500) {
    await box.fill(term);
    await owner.waitForTimeout(waitMs);
    return readList(owner);
  }

  const exact = await search(ORDER_NO);
  out.searchExact = { count: exact.count, n: exact.rows.length, rows: exact.rows };
  await shot(owner, "92d-search-exact");
  log("  exact:", exact.count, JSON.stringify(exact.rows));
  must(exact.rows.length >= 1, "the exact order number finds the row");
  must(exact.rows.every((r) => r.some((c) => c.includes(ORDER_NO))),
    "and every returned row is about that order");

  const lower = await search(ORDER_NO.toLowerCase());
  out.searchLower = { count: lower.count, n: lower.rows.length };
  log("  lowercase:", lower.count, lower.rows.length);
  must(lower.rows.length >= 1, "case-insensitive: the lowercased order number still finds it");

  const partial = await search(ORDER_NO.slice(-4));
  out.searchPartial = { count: partial.count, n: partial.rows.length,
    mine: partial.rows.some((r) => r.some((c) => c.includes(ORDER_NO))) };
  log("  partial:", partial.count, partial.rows.length);
  must(out.searchPartial.mine, "a partial order number (last 4 digits) still finds the row");

  const entryNo = (myRow ?? [])[0];
  out.entryNo = entryNo;
  const byEntry = await search(entryNo);
  out.searchByEntryNo = { count: byEntry.count, n: byEntry.rows.length,
    mine: byEntry.rows.some((r) => r[0] === entryNo) };
  log("  by entry no:", entryNo, byEntry.count, byEntry.rows.length);
  must(out.searchByEntryNo.mine, `searching the entry number ${entryNo} finds the same row`);

  const pct = await search("%");
  out.searchPercent = { count: pct.count, n: pct.rows.length };
  log("  '%':", pct.count, pct.rows.length);
  must(pct.rows.length === 0, "a bare '%' is text, not a wildcard matching the whole ledger");

  const none = await search("ORD-19990101-0001");
  out.searchNoMatch = { snip: none.bodySnip, alerts: none.alerts };
  await shot(owner, "92e-search-no-match");
  must(/No entry matches/.test(none.bodySnip), 'a no-match term says "No entry matches …"');
  must(!/No journal entries/.test(none.bodySnip), "and does NOT claim the ledger is empty");

  // ───────────────── D. entry detail ─────────────────
  log("\n=== D. open the entry ===");
  await search(ORDER_NO);
  await owner.locator("table tbody tr").first().click();
  await owner.waitForTimeout(6000);
  out.detail = await owner.evaluate((no) => ({
    url: location.href,
    namesOrder: (document.body.innerText || "").includes(no),
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 800),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }), ORDER_NO);
  await shot(owner, "92f-entry-detail");
  log("  detail url:", out.detail.url);
  log("  detail text:", out.detail.text.slice(0, 320));
  must(/journal-entries\/[0-9a-f-]{36}/.test(out.detail.url), "the row opens a real entry page");
  must(out.detail.namesOrder, "the entry page names the order number too");
  must((out.detail.alerts ?? []).length === 0, "no error state on the entry page");

  // ───────────────── E. pagination ─────────────────
  log("\n=== E. pagination ===");
  await go(owner, "/app/finance/journal-entries", { waitMs: 5500 });
  const p1 = await readList(owner);
  const nextBtn = owner.locator("button", { hasText: /^Next$/ });
  const hasNext = (await nextBtn.count()) > 0 && !(await nextBtn.first().isDisabled());
  log("  page1 rows:", p1.rows.length, "count:", p1.count, "next:", hasNext);
  const dates = p1.rows.map((r) => r[1]);
  out.dateOrderOk = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
  must(out.dateOrderOk, "page 1 is sorted newest-first by date");
  if (hasNext) {
    await nextBtn.first().click();
    await owner.waitForTimeout(5500);
    const p2 = await readList(owner);
    await shot(owner, "92g-page2");
    const ids1 = new Set(p1.rows.map((r) => r[0]));
    const dupes = p2.rows.map((r) => r[0]).filter((e) => ids1.has(e));
    out.pagination = { p1: p1.rows.length, p2: p2.rows.length, dupes,
      p1First: p1.rows[0]?.[0], p2First: p2.rows[0]?.[0], p1Last: p1.rows.at(-1)?.[0] };
    log("  page2 rows:", p2.rows.length, "overlap:", dupes.length, JSON.stringify(out.pagination));
    must(p2.rows.length > 0, "Next actually loads a second page");
    must(dupes.length === 0, "page 2 repeats none of page 1's entry numbers");
    const prevBtn = owner.locator("button", { hasText: /^Previous$/ });
    await prevBtn.first().click();
    await owner.waitForTimeout(5500);
    const back = await readList(owner);
    out.pagination.backFirst = back.rows[0]?.[0];
    must(back.rows[0]?.[0] === p1.rows[0]?.[0], "Previous returns to the same page 1");
  } else {
    out.pagination = { note: "no second page" };
  }

  // ───────────────── F. adjacent recipes ─────────────────
  log("\n=== F. adjacent recipes ===");
  const bySource = await apiGet(owner, `/api/v1/finance/journal-entries/by-source/${out.orderId}`);
  out.bySource = { status: bySource.status,
    rows: (bySource.body?.data ?? []).map((j) => `${j.entryNo} ${j.sourceType} :: ${j.description}`) };
  log("  entries this order produced:", JSON.stringify(out.bySource, null, 1));
  out.uuidNamedSiblings = out.bySource.rows.filter((r) => UUID_RE.test(r));
  log("  siblings still UUID-named:", JSON.stringify(out.uuidNamedSiblings));

  const sweep = await apiGet(owner, "/api/v1/finance/journal-entries?q=Order%20&size=200");
  const sweepRows = (sweep.body?.data ?? []).map((j) => j.description ?? "");
  out.sweep = { status: sweep.status, total: sweep.body?.meta?.totalCount ?? null, n: sweepRows.length,
    uuidDescribed: sweepRows.filter((d) => UUID_RE.test(d)).length,
    sampleUuid: sweepRows.filter((d) => UUID_RE.test(d)).slice(0, 6),
    sampleNamed: sweepRows.filter((d) => /ORD-\d{8}-\d{4}/.test(d)).slice(0, 4) };
  log("  sweep:", JSON.stringify(out.sweep, null, 1));

  // ───────────────── G. wrong persona ─────────────────
  log("\n=== G. cashier on the ledger ===");
  const t2 = await go(cash, "/app/finance/journal-entries", { waitMs: 5500, allowTrouble: true });
  out.cashierScreen = { bad: t2.bad, alerts: t2.alerts,
    text: await cash.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300)) };
  await shot(cash, "92h-cashier-ledger");
  log("  cashier sees:", JSON.stringify(out.cashierScreen).slice(0, 380));
  const cashierApi = await apiGet(cash, `/api/v1/finance/journal-entries?q=${encodeURIComponent(ORDER_NO)}`);
  out.cashierApi = { status: cashierApi.status, code: cashierApi.body?.error?.code ?? null,
    n: (cashierApi.body?.data ?? []).length };
  log("  cashier GET ?q= :", JSON.stringify(out.cashierApi));
  must(out.cashierApi.status >= 400, `the ?q= endpoint refuses a cashier (got ${out.cashierApi.status})`);
  must(out.cashierApi.n === 0, "and returns no ledger rows to a cashier");

  // ───────────────── H. other tenant ─────────────────
  log("\n=== H. Control Bistro ===");
  let ctrl = null;
  try {
    ctrl = await loginFresh(CONTROL_ACCOUNTANT);
    const ct = await go(ctrl, "/app/finance/journal-entries", { waitMs: 5500, allowTrouble: true });
    const cview = await readList(ctrl);
    out.controlUnfiltered = { count: cview.count, n: cview.rows.length, bad: ct.bad };
    log("  control unfiltered:", JSON.stringify(out.controlUnfiltered));
    const cbox = ctrl.getByRole("textbox", {
      name: "Search journal entries by entry number or description" });
    let crossRows = [];
    if (await cbox.count()) {
      await cbox.fill(ORDER_NO);
      await ctrl.waitForTimeout(5000);
      const cs = await readList(ctrl);
      crossRows = cs.rows;
      out.controlSearch = { count: cs.count, n: cs.rows.length, snip: cs.bodySnip.slice(0, 220) };
    } else {
      out.controlSearch = { note: "no search box for this persona" };
    }
    await shot(ctrl, "92i-control-search");
    const capi = await apiGet(ctrl, `/api/v1/finance/journal-entries?q=${encodeURIComponent(ORDER_NO)}`);
    out.controlApi = { status: capi.status, n: (capi.body?.data ?? []).length,
      rows: (capi.body?.data ?? []).map((j) => j.description) };
    log("  control search:", JSON.stringify(out.controlSearch), JSON.stringify(out.controlApi));
    must(crossRows.length === 0, "Control Bistro finds NO row for a Floating Terrace order");
    must(out.controlApi.n === 0, "and the ?q= endpoint returns them nothing either");
  } catch (e) {
    out.controlError = e.message.slice(0, 400);
    log("  ! control leg failed:", out.controlError);
    fail.push(`cross-tenant leg could not be driven: ${out.controlError}`);
  }

  out.pass = pass; out.failures = fail;
  writeFileSync(OUTJSON, JSON.stringify(out, null, 2));
  log(`\n=== ${fail.length === 0 ? `ALL ${pass.length} CHECKS PASSED` : `${fail.length} of ${pass.length + fail.length} CHECKS FAILED`} ===`);
  fail.forEach((f) => log(`  - ${f}`));
} catch (e) {
  out.fatal = `${e.message}\n${e.stack}`.slice(0, 1500);
  out.pass = pass; out.failures = fail;
  writeFileSync(OUTJSON, JSON.stringify(out, null, 2));
  log("FATAL:", out.fatal);
} finally {
  await browser.close();
}
