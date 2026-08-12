/*
 * F10 final proof — driven after finance-service was rebuilt from the restored source and
 * restarted (pid checked fresh by scripts/check-stale-jars.sh), so nothing below is measuring a
 * jar that no longer matches the tree.
 *
 * The DONE MEANS, in order:
 *   a. cashier rings and fires a check                  → ORD-YYYYMMDD-NNNN
 *   b. cashier settles it in cash and closes the order  → ORDER_CLOSED
 *   c. owner opens /app/finance/journal-entries         → the ORDER_REVENUE row NAMES that order
 *   d. owner types the order number into the search     → the row is found
 *
 * Every claim is read off the screen the persona is looking at. The ledger row is then cross-read
 * over HTTP on the owner's OWN bearer, so "the screen renders it" and "the server stores it" are
 * separately established.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, log,
} from "./lib.mjs";

const browser = await newBrowser();
const out = {};
const fail = [];

function must(cond, what) {
  if (cond) {
    log(`  PASS  ${what}`);
  } else {
    log(`  FAIL  ${what}`);
    fail.push(what);
  }
}

try {
  // ── a. ring a check ────────────────────────────────────────────────────────
  log("\n=== a. cashier rings a dine-in check ===");
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);

  let t = null;
  let till = null;
  for (let i = 0; i < 15; i++) {
    try {
      t = await go(cash, "/app/pos", { waitMs: 8000, allowTrouble: true });
      till = await cash.evaluate(() => {
        const txt = document.body.innerText;
        return /Till [A-Z]+[^\n]*/.exec(txt)?.[0] ?? /No active till/.exec(txt)?.[0] ?? null;
      });
      if (till && !/unavailable/i.test((t.alerts ?? []).join(" "))) break;
      log(`  attempt ${i + 1}: terminal not usable yet — ${JSON.stringify(t?.alerts).slice(0, 160)}`);
    } catch (e) {
      log(`  attempt ${i + 1}: probe raced a navigation (${e.message.slice(0, 80)})`);
    }
    await cash.waitForTimeout(8000);
  }
  log("  till strip:", till);
  if (!till) throw new Error("the POS terminal never became usable — pos-service is down");
  out.tillStrip = till;
  await shot(cash, "05a-pos-till");

  await cash.locator("[data-testid=order-type-takeaway]").click();
  await cash.waitForTimeout(600);

  const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(2).click();
  await cash.waitForTimeout(400);
  await tiles.nth(3).click();
  await cash.waitForTimeout(900);
  await shot(cash, "05b-cart");

  await cash.locator("[data-testid=send-to-kitchen-button]").click();
  await cash.waitForTimeout(9000);
  await shot(cash, "05c-fired");

  out.orderNo = await cash.evaluate(
    () => /ORD-\d{8}-\d{4}/.exec(document.body.innerText)?.[0] ?? null,
  );
  if (!out.orderNo) throw new Error("no order number on the terminal after Send to Kitchen");
  log(`  fired: ${out.orderNo}`);

  // ── b. settle it ───────────────────────────────────────────────────────────
  log("\n=== b. cashier settles it in cash and closes it ===");
  await cash.locator("button, a").filter({ hasText: /charge/i }).first().click();
  await cash.waitForTimeout(7000);
  out.orderId = /\/orders\/([0-9a-f-]{36})\//.exec(cash.url())?.[1] ?? null;
  await shot(cash, "05d-charge-page");

  const fill = cash.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await cash.waitForTimeout(800);
  }
  const tendered = cash.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    const amount = await cash.locator('[aria-label="Amount (Rs)"]').first().inputValue();
    await tendered.fill(String(Math.ceil(Number(amount) || 0) + 100));
    await cash.waitForTimeout(800);
  }
  await cash.locator("[data-testid=record-payment-button]").click();
  await cash.waitForTimeout(9000);
  await shot(cash, "05e-after-payment");
  out.payment = await cash.evaluate(() => ({
    err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
    paid: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
  }));
  log("  after payment:", JSON.stringify(out.payment));

  for (let i = 0; i < 6; i++) {
    const closeBtn = cash.locator("[data-testid=close-order-button]");
    if (!(await closeBtn.count())) break;
    await closeBtn.first().click();
    await cash.waitForTimeout(9000);
    const err = await cash.evaluate(
      () => /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null,
    );
    if (!err) break;
    log("  ! close refused:", err);
    await cash.waitForTimeout(6000);
    await go(cash, `/app/pos/orders/${out.orderId}/charge`, { waitMs: 6000, allowTrouble: true });
  }
  await shot(cash, "05f-after-close");

  // ── c. the owner reads the ledger ──────────────────────────────────────────
  log("\n=== c. owner opens /app/finance/journal-entries ===");
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  let seen = null;
  for (let i = 0; i < 15; i++) {
    t = await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
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
      };
    }, out.orderNo);
    if (seen.rowWithOrder) break;
    log(`  attempt ${i + 1}: not posted yet (first row: ${JSON.stringify(seen.firstRow)})`);
    await owner.waitForTimeout(5000);
  }
  log("  journal list:", JSON.stringify(seen, null, 1));
  out.listView = seen;
  await shot(owner, "05g-journal-list-unfiltered");

  must(
    seen.rowWithOrder != null,
    `the unfiltered list carries a row naming ${out.orderNo}`,
  );
  must(
    (seen.rowWithOrder ?? []).some((c) => c === `Order revenue ${out.orderNo}`),
    `that row's description is exactly "Order revenue ${out.orderNo}"`,
  );
  must(
    !(seen.rowWithOrder ?? []).some((c) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(c),
    ),
    "and no UUID is left in it",
  );

  // ── d. search for it ───────────────────────────────────────────────────────
  log("\n=== d. owner searches the list for the order number ===");
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box.fill(out.orderNo);
  await owner.waitForTimeout(4500);
  await shot(owner, "05h-journal-search-hit");

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
    out.searchView.rows.every((r) => r.some((c) => c.includes(out.orderNo))),
    "and every row it returns is about that order",
  );
  must((out.searchView.alerts ?? []).length === 0, "with no error state on the page");

  // A term that matches nothing must say so, and must not look like an outage or an empty ledger.
  await box.fill("ORD-19990101-0001");
  await owner.waitForTimeout(4000);
  await shot(owner, "05i-journal-search-no-match");
  out.noMatch = await owner.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, " "),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }));
  must(
    /No entry matches/.test(out.noMatch.text),
    'a term with no match says "No entry matches …"',
  );
  must(
    !/No journal entries/.test(out.noMatch.text),
    "and does NOT claim the ledger is empty",
  );

  // ── cross-read on the owner's own bearer ───────────────────────────────────
  const api = await apiGet(
    owner,
    `/api/v1/finance/journal-entries?q=${encodeURIComponent(out.orderNo)}`,
  );
  out.apiSearch = {
    status: api.status,
    rows: (api.body?.data ?? []).map((j) => `${j.entryNo} ${j.sourceType} :: ${j.description}`),
  };
  log("  API ?q= :", api.status, JSON.stringify(out.apiSearch.rows));
  must(api.status === 200, "GET /api/v1/finance/journal-entries?q= answers 200 on the owner's bearer");
  must(
    out.apiSearch.rows.some((r) => r.includes(`ORDER_REVENUE :: Order revenue ${out.orderNo}`)),
    "and the stored row itself carries the order number",
  );

  out.failures = fail;
  saveState({ finalProof: out });
  log(`\n=== ${fail.length === 0 ? "ALL CHECKS PASSED" : `${fail.length} CHECK(S) FAILED`} ===`);
  if (fail.length) fail.forEach((f) => log(`  - ${f}`));
} finally {
  await browser.close();
}
