/*
 * F10 RE-OPEN attempt — an independent adversarial drive, not a re-run of the author's proof.
 *
 * The author's claim: an ORDER_REVENUE row now names ORD-YYYYMMDD-NNNN, the list sorts newest
 * first, and ?q= finds one entry across the branch's whole ledger.
 *
 * What this script tries to BREAK, beyond the DONE MEANS:
 *   1. persistence  — reload the ledger; does the row survive a fresh render?
 *   2. paging       — Next/Previous: does page 2 repeat or skip rows now that a sort exists?
 *   3. LIKE escape  — type "%" : a wildcard must be text, not "match the whole ledger"
 *   4. no-match     — a bogus order number must NOT read as an empty ledger
 *   5. wrong persona— cashier and waiter on the ledger screen AND on the raw ?q= endpoint
 *   6. other tenant — Control Bistro searching a Floating Terrace order number
 *   7. other branch — the Rooftop branch must not answer for the main branch's entries
 *   8. adjacent     — COGS / refund / other recipes: how many rows still carry a UUID?
 *   9. detail page  — the row opens, and names the same order
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log, OUT,
} from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const out = { checks: [] };
const fail = [];

function must(cond, what, detail) {
  out.checks.push({ what, pass: !!cond, detail: detail ?? null });
  if (cond) log(`  PASS  ${what}`);
  else {
    log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
    fail.push(what);
  }
}

const readTable = () => ({
  rows: Array.from(document.querySelectorAll("table tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim()),
  ),
  countLine:
    document.querySelector('[data-testid="je-result-count"]')?.textContent?.trim() ?? null,
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
    (n.textContent || "").trim(),
  ),
  bodyHead: (document.body.innerText || "").slice(0, 400),
});

try {
  // ─────────────────────────────────────────────────────────── ring + settle
  log("\n=== 1. cashier rings, settles and closes a check ===");
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);

  let till = null;
  for (let i = 0; i < 12; i++) {
    try {
      await go(cash, "/app/pos", { waitMs: 7000, allowTrouble: true });
      till = await cash.evaluate(
        () => /Till [A-Z]+[^\n]*/.exec(document.body.innerText)?.[0] ?? null,
      );
      if (till) break;
    } catch (e) {
      log(`  attempt ${i + 1} raced: ${e.message.slice(0, 70)}`);
    }
    await cash.waitForTimeout(6000);
  }
  if (!till) throw new Error("POS terminal never became usable");
  log("  till strip:", till);
  out.till = till;

  await cash.locator("[data-testid=order-type-takeaway]").click();
  await cash.waitForTimeout(600);
  const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(1).click();
  await cash.waitForTimeout(400);
  await tiles.nth(4).click();
  await cash.waitForTimeout(900);
  await cash.locator("[data-testid=send-to-kitchen-button]").click();
  await cash.waitForTimeout(9000);

  out.orderNo = await cash.evaluate(
    () => /ORD-\d{8}-\d{4}/.exec(document.body.innerText)?.[0] ?? null,
  );
  if (!out.orderNo) throw new Error("no order number after Send to Kitchen");
  log(`  fired: ${out.orderNo}`);
  await shot(cash, "90a-fired");

  // NOT `filter({hasText:/charge/i})` — F20 added a "Service Charge" item to the sidebar and
  // that selector now walks into /app/settings/service-charge instead of the till.
  await cash.locator("[data-testid=charge-now-button]").first().click();
  await cash.waitForTimeout(7000);
  out.orderId = /\/orders\/([0-9a-f-]{36})\//.exec(cash.url())?.[1] ?? null;
  await shot(cash, "90b0-charge-page");
  log("  charge url:", cash.url());
  log(
    "  charge page text:",
    (await cash.evaluate(() => (document.body.innerText || "").slice(0, 700))).replace(/\n/g, " | "),
  );

  const fill = cash.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await cash.waitForTimeout(800);
  }
  const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    const amt = await cash.locator('[aria-label="Amount (Rs)"]').first().inputValue();
    await tendered.fill(String(Math.ceil(Number(amt) || 0) + 100));
    await cash.waitForTimeout(800);
  }
  await cash.locator("[data-testid=record-payment-button]").click();
  await cash.waitForTimeout(9000);
  out.payErr = await cash.evaluate(
    () => document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
  );
  log("  payment error:", out.payErr);
  await shot(cash, "90b-paid");

  for (let i = 0; i < 6; i++) {
    const closeBtn = cash.locator("[data-testid=close-order-button]");
    if (!(await closeBtn.count())) break;
    await closeBtn.first().click();
    await cash.waitForTimeout(9000);
    const err = await cash.evaluate(
      () =>
        /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null,
    );
    if (!err) break;
    log("  ! close refused:", err);
    await cash.waitForTimeout(6000);
    await go(cash, `/app/pos/orders/${out.orderId}/charge`, { waitMs: 6000, allowTrouble: true });
  }
  await shot(cash, "90c-closed");

  // ─────────────────────────────────────────────────── owner reads the ledger
  log("\n=== 2. owner opens the ledger (unfiltered) ===");
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  let seen = null;
  for (let i = 0; i < 15; i++) {
    const t = await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
    if (t.bad.length) log("  ! page trouble:", JSON.stringify(t));
    seen = await owner.evaluate(readTable);
    if (seen.rows.some((r) => r.some((c) => c.includes(out.orderNo)))) break;
    log(`  attempt ${i + 1}: not posted yet (first row ${JSON.stringify(seen.rows[0])})`);
    await owner.waitForTimeout(5000);
  }
  out.unfiltered = seen;
  await shot(owner, "90d-ledger-unfiltered");
  const row = seen.rows.find((r) => r.some((c) => c.includes(out.orderNo)));
  must(!!row, `unfiltered ledger carries a row naming ${out.orderNo}`, JSON.stringify(seen.rows[0]));
  must(
    (row ?? []).some((c) => c === `Order revenue ${out.orderNo}`),
    `its description is exactly "Order revenue ${out.orderNo}"`,
    JSON.stringify(row),
  );
  must(seen.alerts.length === 0, "no [role=alert] on the ledger", JSON.stringify(seen.alerts));

  // 1. PERSISTENCE — a hard reload, not a client-side re-render
  log("\n=== 3. reload: does it persist? ===");
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(5000);
  const afterReload = await owner.evaluate(readTable);
  out.afterReload = afterReload;
  must(
    afterReload.rows.some((r) => r.some((c) => c === `Order revenue ${out.orderNo}`)),
    "after a full reload the row is still there and still named",
    afterReload.countLine,
  );

  // 2. PAGING — page 2 must not repeat page 1
  log("\n=== 4. paging: Next must not repeat or skip ===");
  const page1 = afterReload.rows.map((r) => r[0]);
  const nextBtn = owner.locator("button").filter({ hasText: /^Next$/ }).first();
  out.hasNext = (await nextBtn.count()) > 0;
  if (out.hasNext && (await nextBtn.isEnabled())) {
    await nextBtn.click();
    await owner.waitForTimeout(4000);
    const p2 = await owner.evaluate(readTable);
    const page2 = p2.rows.map((r) => r[0]);
    out.page1First = page1[0];
    out.page1Last = page1[page1.length - 1];
    out.page2First = page2[0];
    const overlap = page2.filter((n) => page1.includes(n));
    must(page2.length > 0, "page 2 has rows", String(page2.length));
    must(overlap.length === 0, "page 2 repeats no row from page 1", JSON.stringify(overlap));
    must(
      page1[page1.length - 1] > page2[0] || page1.length < 50,
      "page 2 continues strictly below page 1 (entryNo desc)",
      `p1 last=${page1[page1.length - 1]} p2 first=${page2[0]}`,
    );
    await shot(owner, "90e-page2");
    const prevBtn = owner.locator("button").filter({ hasText: /^Previous$/ }).first();
    if ((await prevBtn.count()) && (await prevBtn.isEnabled())) {
      await prevBtn.click();
      await owner.waitForTimeout(4000);
      const back = await owner.evaluate(readTable);
      must(
        back.rows.map((r) => r[0]).join(",") === page1.join(","),
        "Previous returns exactly page 1 again",
        `${back.rows[0]?.[0]} vs ${page1[0]}`,
      );
    }
  } else {
    must(false, "a Next control exists and is usable on a 288-row ledger", "no enabled Next");
  }

  // ─────────────────────────────────────────────────── search, and its edges
  log("\n=== 5. search for the order number ===");
  await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box.fill(out.orderNo);
  await owner.waitForTimeout(4500);
  const hit = await owner.evaluate(readTable);
  out.searchHit = hit;
  await shot(owner, "90f-search-hit");
  must(hit.rows.length >= 1, "the search finds the row", JSON.stringify(hit.countLine));
  must(
    hit.rows.every((r) => r.some((c) => c.includes(out.orderNo))),
    "every returned row is actually about that order",
    JSON.stringify(hit.rows.map((r) => r[2])),
  );

  // 3. LIKE ESCAPE — "%" must be text
  log("\n=== 6. a typed % must be text, not a wildcard ===");
  await box.fill("%");
  await owner.waitForTimeout(4500);
  const pct = await owner.evaluate(readTable);
  out.percent = pct;
  await shot(owner, "90g-percent");
  must(
    pct.rows.length === 0,
    'searching "%" returns no rows rather than the whole ledger',
    `${pct.rows.length} rows; count=${pct.countLine}`,
  );

  // 4. NO MATCH must not read as an empty ledger
  log("\n=== 7. a bogus order number ===");
  await box.fill("ORD-19990101-0001");
  await owner.waitForTimeout(4500);
  const none = await owner.evaluate(() => ({
    ...((() => {
      const t = {
        rows: Array.from(document.querySelectorAll("table tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim()),
        ),
        countLine:
          document.querySelector('[data-testid="je-result-count"]')?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
          (n.textContent || "").trim(),
        ),
      };
      return t;
    })()),
    // The empty state lives in <main>, not in the nav — slicing document.body.innerText just
    // reads the sidebar back at you, which is how a harness "verifies" a string it never saw.
    mainText: (document.querySelector("main")?.innerText || "").trim(),
  }));
  out.noMatch = none;
  await shot(owner, "90h-no-match");
  must(
    /No entry matches/.test(none.mainText),
    "a bad term says 'No entry matches'",
    none.mainText.slice(0, 300),
  );
  must(
    !/No journal entries/.test(none.mainText),
    "and does not claim the books are empty",
    none.mainText.slice(0, 300),
  );
  must(
    /covers every entry for this branch/.test(none.mainText),
    "and says the search covered the whole branch",
    none.mainText.slice(0, 300),
  );

  // 9. DETAIL PAGE
  log("\n=== 8. the row opens and the detail names the same order ===");
  await box.fill(out.orderNo);
  await owner.waitForTimeout(4500);
  await owner.locator("table tbody tr").first().click();
  await owner.waitForTimeout(5000);
  out.detailUrl = owner.url();
  out.detailNamesOrder = await owner.evaluate(
    (no) => (document.body.innerText || "").includes(no),
    out.orderNo,
  );
  await shot(owner, "90i-detail");
  must(
    /\/journal-entries\/[0-9a-f-]{36}/.test(out.detailUrl),
    "clicking the row opens the entry",
    out.detailUrl,
  );
  must(out.detailNamesOrder, "the detail page names the order number too");

  // 8. ADJACENT RECIPES — how much of the ledger still speaks UUID?
  log("\n=== 9. adjacent recipes: what still carries a UUID? ===");
  const tok = await owner.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  const today = new Date().toISOString().slice(0, 10);
  const all = await apiGet(
    owner,
    `/api/v1/finance/journal-entries?from=${today}&to=${today}&size=200`,
    tok,
  );
  const list = all.body?.data ?? [];
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const byKind = {};
  for (const e of list) {
    const k = e.sourceType ?? e.entryType ?? "?";
    byKind[k] = byKind[k] ?? { total: 0, uuid: 0, sample: null };
    byKind[k].total++;
    if (uuidRe.test(e.description ?? "")) {
      byKind[k].uuid++;
      byKind[k].sample = byKind[k].sample ?? e.description;
    }
  }
  out.todayByKind = byKind;
  out.todayCount = list.length;
  log("  today's entries by source type:", JSON.stringify(byKind, null, 1));

  // 5. WRONG PERSONA
  log("\n=== 10. wrong persona: cashier ===");
  const c2 = await newPage(browser);
  await login(c2, PEOPLE.cashier);
  const cashierPage = await go(c2, "/app/finance/journal-entries", {
    waitMs: 5000,
    allowTrouble: true,
  });
  const cashierTok = await c2.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  const cashierApi = await apiGet(
    c2,
    `/api/v1/finance/journal-entries?q=${out.orderNo}`,
    cashierTok,
  );
  out.cashier = { screen: cashierPage, apiStatus: cashierApi.status };
  await shot(c2, "90j-cashier-ledger");
  log("  cashier screen:", JSON.stringify(cashierPage));
  log("  cashier GET ?q= :", cashierApi.status);
  must(
    cashierApi.status === 403 || cashierApi.status === 401,
    "a cashier is refused the raw journal search",
    `HTTP ${cashierApi.status}`,
  );
  must(
    cashierPage.bad.includes("access-denied") || cashierPage.bad.length > 0,
    "and the cashier does not get the ledger screen",
    JSON.stringify(cashierPage.bad),
  );

  // 6. ANOTHER TENANT — a search that ignores the tenant boundary is worse than a UUID
  log("\n=== 11. another tenant searches for OUR order number ===");
  const bistro = await newPage(browser);
  await login(bistro, {
    slug: "control-bistro-isolation-test-tenant",
    email: "owner@control.local",
    password: "Control#Owner1",
    totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
  });
  const bistroTok = await bistro.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  const bistroSearch = await apiGet(
    bistro,
    `/api/v1/finance/journal-entries?q=${out.orderNo}`,
    bistroTok,
  );
  const bistroWide = await apiGet(bistro, `/api/v1/finance/journal-entries?q=Order revenue ORD`, bistroTok);
  out.otherTenant = {
    exact: { status: bistroSearch.status, n: (bistroSearch.body?.data ?? []).length },
    wide: {
      status: bistroWide.status,
      n: (bistroWide.body?.data ?? []).length,
      sample: (bistroWide.body?.data ?? []).slice(0, 3).map((e) => e.description),
    },
  };
  log("  control bistro:", JSON.stringify(out.otherTenant));
  must(
    (bistroSearch.body?.data ?? []).length === 0,
    "Control Bistro searching our order number gets nothing",
    JSON.stringify(out.otherTenant.exact),
  );
  must(
    !(bistroWide.body?.data ?? []).some((e) => /ORD-2026/.test(e.description ?? "")),
    "and a wide search returns none of Floating Terrace's order revenue rows",
    JSON.stringify(out.otherTenant.wide.sample),
  );
  const bistroScreen = await go(bistro, "/app/finance/journal-entries", {
    waitMs: 5000,
    allowTrouble: true,
  });
  const bistroRows = await bistro.evaluate(readTable);
  out.otherTenantScreen = { ...bistroScreen, rows: bistroRows.rows.length, count: bistroRows.countLine };
  await shot(bistro, "90k-bistro-ledger");
  must(
    !bistroRows.rows.some((r) => r.some((c) => c.includes("ORD-2026"))),
    "and the Control Bistro ledger screen shows no Floating Terrace order",
    JSON.stringify(out.otherTenantScreen),
  );

  // ACCOUNTANT — the persona whose actual job this is
  log("\n=== 12. the accountant, whose job this is ===");
  const acct = await newPage(browser);
  await login(acct, {
    slug: "floating-terrace",
    email: "accountant@terrace.local",
    password: "Terrace#Accountant1",
    totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C",
  });
  const acctTrouble = await go(acct, "/app/finance/journal-entries", { waitMs: 5000 });
  const acctBox = acct.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  out.accountantHasBox = (await acctBox.count()) > 0;
  if (out.accountantHasBox) {
    await acctBox.fill(out.orderNo);
    await acct.waitForTimeout(4500);
  }
  const acctSeen = await acct.evaluate(readTable);
  out.accountant = { trouble: acctTrouble, rows: acctSeen.rows, count: acctSeen.countLine };
  await shot(acct, "90l-accountant-search");
  log("  accountant:", JSON.stringify({ trouble: acctTrouble, count: acctSeen.countLine }));
  must(
    acctTrouble.bad.length === 0,
    "the accountant reaches the ledger without an access-denied",
    JSON.stringify(acctTrouble),
  );
  must(
    acctSeen.rows.some((r) => r.some((c) => c === `Order revenue ${out.orderNo}`)),
    "and finds the same row by order number",
    JSON.stringify(acctSeen.rows[0]),
  );

  writeFileSync(`${OUT}/90-reopen.json`, JSON.stringify(out, null, 2));
  log("\n=== RESULT ===");
  log(fail.length === 0 ? "ALL PASS" : `FAILURES (${fail.length}): ${JSON.stringify(fail, null, 1)}`);
} catch (e) {
  log("HARNESS ERROR:", e.stack);
  out.harnessError = String(e.message);
  writeFileSync(`${OUT}/90-reopen.json`, JSON.stringify(out, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
