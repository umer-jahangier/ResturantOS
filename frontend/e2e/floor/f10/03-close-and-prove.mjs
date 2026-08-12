/*
 * F10 step 3 — close the already-paid check, then read the ledger as the owner.
 *
 * Step 2's close was refused with "The service is temporarily unavailable. Please try again
 * later." while pos-service was being restarted by another agent. The check is PAID and open; this
 * closes it for real and then drives the DONE MEANS path.
 *
 * Pass the order number and id as argv, or leave them out to use the ones step 2 recorded.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, log,
} from "./lib.mjs";

const st = loadState();
const ORDER_NO = process.argv[2] ?? st.prove?.orderNo;
const ORDER_ID = process.argv[3] ?? st.prove?.orderId;
if (!ORDER_NO || !ORDER_ID) throw new Error("no order to close — run 02 first");

const browser = await newBrowser();
const out = { orderNo: ORDER_NO, orderId: ORDER_ID };

try {
  log(`\n=== close ${ORDER_NO} ===`);
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);

  let closed = false;
  for (let i = 0; i < 8; i++) {
    await go(cash, `/app/pos/orders/${ORDER_ID}/charge`, { waitMs: 6000, allowTrouble: true });
    const state = await cash.evaluate(() => {
      const t = document.body.innerText;
      return {
        chips: Array.from(t.matchAll(/In Progress|Paid|Closed|Served|Voided/g)).map((m) => m[0]),
        closeBtn: !!Array.from(document.querySelectorAll("button")).find((b) =>
          /close order/i.test(b.textContent || ""),
        ),
        err: /The service is temporarily unavailable[^\n]*/.exec(t)?.[0] ?? null,
      };
    });
    log(`  attempt ${i + 1}: ${JSON.stringify(state)}`);
    if (!state.closeBtn) {
      closed = true;
      break;
    }
    await cash
      .locator("button")
      .filter({ hasText: /close order/i })
      .first()
      .click();
    await cash.waitForTimeout(8000);
    const after = await cash.evaluate(
      () => /The service is temporarily unavailable[^\n]*/.exec(document.body.innerText)?.[0] ?? null,
    );
    if (!after) {
      closed = true;
      log("  ✓ close accepted");
      break;
    }
    log("  ! close refused:", after);
    await cash.waitForTimeout(6000);
  }
  await shot(cash, "03a-after-close");
  out.closed = closed;
  if (!closed) throw new Error("could not close the check — pos-service refused every attempt");

  // ── the owner reads the ledger ─────────────────────────────────────────────
  log("\n=== owner opens /app/finance/journal-entries ===");
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  let seen = null;
  for (let i = 0; i < 15; i++) {
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
  await shot(owner, "03b-journal-list-unfiltered");

  log("\n=== owner searches for the order number ===");
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box.fill(ORDER_NO);
  await owner.waitForTimeout(4000);
  await shot(owner, "03c-journal-search-hit");
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

  // Open the row — the description and the resolved source reference must agree.
  const firstRow = owner.locator("tbody tr").first();
  await firstRow.click();
  await owner.waitForTimeout(5000);
  await shot(owner, "03d-journal-entry-detail");
  out.detail = await owner.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
  );
  log("  detail page:", out.detail.slice(0, 400));

  await go(owner, "/app/finance/journal-entries", { waitMs: 4000 });
  const box2 = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box2.fill("ORD-19990101-0001");
  await owner.waitForTimeout(3500);
  await shot(owner, "03e-journal-search-no-match");
  out.noMatch = await owner.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }));
  log("  no-match:", JSON.stringify(out.noMatch).slice(0, 400));

  const api = await apiGet(
    owner,
    `/api/v1/finance/journal-entries?q=${encodeURIComponent(ORDER_NO)}`,
  );
  out.apiSearch = {
    status: api.status,
    rows: (api.body?.data ?? []).map((j) => `${j.entryNo} ${j.sourceType} :: ${j.description}`),
  };
  log("  API ?q= :", api.status, JSON.stringify(out.apiSearch.rows));

  saveState({ prove3: out });
} finally {
  await browser.close();
}
