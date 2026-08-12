/*
 * F10 step 6 — close the already-paid check from step 5, then drive the DONE MEANS as the owner.
 *
 * Step 5's close was refused with "The service is temporarily unavailable. Please try again later."
 * six times running: a sibling agent was rebuilding and restarting pos-service through that exact
 * window (its jar went 481 KB / 0 BOOT-INF entries — an un-bootable partial build — then 108 MB
 * two minutes later). The check is PAID and still open. That refusal is pos-service being
 * restarted, not anything about the ledger, and it is recorded here rather than glossed.
 *
 * argv: [orderNo] [orderId], defaulting to the ones step 5 recorded.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, log,
} from "./lib.mjs";

const st = loadState();
const ORDER_NO = process.argv[2] ?? st.finalProof?.orderNo;
const ORDER_ID = process.argv[3] ?? st.finalProof?.orderId;
if (!ORDER_NO || !ORDER_ID) throw new Error("no order to close — run 05 first");

const browser = await newBrowser();
const out = { orderNo: ORDER_NO, orderId: ORDER_ID };
const fail = [];

function must(cond, what) {
  log(`  ${cond ? "PASS" : "FAIL"}  ${what}`);
  if (!cond) fail.push(what);
}

try {
  log(`\n=== close ${ORDER_NO} ===`);
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);

  let closed = false;
  for (let i = 0; i < 12; i++) {
    await go(cash, `/app/pos/orders/${ORDER_ID}/charge`, { waitMs: 6000, allowTrouble: true });
    const state = await cash.evaluate(() => ({
      closeBtn: !!document.querySelector("[data-testid=close-order-button]"),
      err: /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null,
    }));
    log(`  attempt ${i + 1}: ${JSON.stringify(state)}`);
    if (!state.closeBtn && !state.err) {
      closed = true;
      break;
    }
    if (state.closeBtn) {
      await cash.locator("[data-testid=close-order-button]").first().click();
      await cash.waitForTimeout(9000);
      const after = await cash.evaluate(
        () =>
          /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null,
      );
      if (!after) {
        closed = true;
        log("  ✓ close accepted");
        break;
      }
      log("  ! close refused:", after);
    }
    await cash.waitForTimeout(10000);
  }
  await shot(cash, "06a-after-close");
  out.closed = closed;
  if (!closed) throw new Error("pos-service refused every close attempt — cannot settle the check");

  // ── the owner reads the ledger ─────────────────────────────────────────────
  log("\n=== owner opens /app/finance/journal-entries ===");
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  let seen = null;
  for (let i = 0; i < 18; i++) {
    const t = await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
    if (t.bad.length) log("  ! page trouble:", JSON.stringify(t));
    seen = await owner.evaluate((no) => {
      const table = document.querySelector("table");
      const rows = table
        ? Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
            Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim()),
          )
        : [];
      return {
        firstRow: rows[0] ?? null,
        rowWithOrder: rows.find((r) => r.some((c) => c.includes(no))) ?? null,
        rowCount: rows.length,
        countLine:
          document.querySelector('[data-testid="je-result-count"]')?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
          n.textContent.trim(),
        ),
        uuidDescriptions: rows.filter((r) =>
          r.some((c) =>
            /Order (revenue|COGS|refund) [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
              c,
            ),
          ),
        ).length,
      };
    }, ORDER_NO);
    if (seen.rowWithOrder) break;
    log(`  attempt ${i + 1}: not posted yet (first row: ${JSON.stringify(seen.firstRow)})`);
    await owner.waitForTimeout(5000);
  }
  log("  journal list:", JSON.stringify(seen, null, 1));
  out.listView = seen;
  await shot(owner, "06b-journal-list-unfiltered");

  must(seen.rowWithOrder != null, `the unfiltered list carries a row naming ${ORDER_NO}`);
  must(
    (seen.rowWithOrder ?? []).some((c) => c === `Order revenue ${ORDER_NO}`),
    `that row's description is exactly "Order revenue ${ORDER_NO}"`,
  );
  must(
    !(seen.rowWithOrder ?? []).some((c) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(c),
    ),
    "and no UUID is left in it",
  );

  log("\n=== owner searches for the order number ===");
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box.fill(ORDER_NO);
  await owner.waitForTimeout(4500);
  await shot(owner, "06c-journal-search-hit");
  out.searchView = await owner.evaluate(() => {
    const table = document.querySelector("table");
    return {
      rows: table
        ? Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
            Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim()),
          )
        : [],
      countLine:
        document.querySelector('[data-testid="je-result-count"]')?.textContent?.trim() ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        n.textContent.trim(),
      ),
    };
  });
  log("  after searching:", JSON.stringify(out.searchView, null, 1));
  must(out.searchView.rows.length >= 1, "searching the list for the order number finds the row");
  must(
    out.searchView.rows.every((r) => r.some((c) => c.includes(ORDER_NO))),
    "and every row it returns is about that order",
  );
  must((out.searchView.alerts ?? []).length === 0, "with no error state on the page");

  // Open the row: the detail header must name the same order.
  await owner.locator("tbody tr").first().click();
  await owner.waitForTimeout(5000);
  await shot(owner, "06d-journal-entry-detail");
  out.detail = await owner.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 900));
  must(out.detail.includes(`Order revenue ${ORDER_NO}`), "the entry's own page names the order too");

  await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
  const box2 = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box2.fill("ORD-19990101-0001");
  await owner.waitForTimeout(4000);
  await shot(owner, "06e-journal-search-no-match");
  out.noMatch = await owner.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, " "),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }));
  must(/No entry matches/.test(out.noMatch.text), 'a term with no match says "No entry matches …"');
  must(!/No journal entries/.test(out.noMatch.text), "and does NOT claim the ledger is empty");

  const api = await apiGet(
    owner,
    `/api/v1/finance/journal-entries?q=${encodeURIComponent(ORDER_NO)}`,
  );
  out.apiSearch = {
    status: api.status,
    rows: (api.body?.data ?? []).map((j) => `${j.entryNo} ${j.sourceType} :: ${j.description}`),
  };
  log("  API ?q= :", api.status, JSON.stringify(out.apiSearch.rows));
  must(api.status === 200, "GET …/journal-entries?q= answers 200 on the owner's own bearer");
  must(
    out.apiSearch.rows.some((r) => r.includes(`ORDER_REVENUE :: Order revenue ${ORDER_NO}`)),
    "and the stored row itself carries the order number",
  );

  out.failures = fail;
  saveState({ finalProof6: out });
  log(`\n=== ${fail.length === 0 ? "ALL CHECKS PASSED" : `${fail.length} CHECK(S) FAILED`} ===`);
  fail.forEach((f) => log(`  - ${f}`));
} finally {
  await browser.close();
}
