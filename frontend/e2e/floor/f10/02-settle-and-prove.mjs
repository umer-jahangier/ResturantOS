/*
 * F10 step 2 — the DONE MEANS, driven end to end.
 *
 *   a. Cashier rings a takeaway check and fires it     → ORD-YYYYMMDD-NNNN
 *   b. Cashier settles it in cash and closes the order → ORDER_CLOSED → finance posts ORDER_REVENUE
 *   c. Owner opens /app/finance/journal-entries        → the new row must NAME that order number
 *   d. Owner types the order number into the search    → the row must be found
 *
 * Nothing is asserted from a payload: every claim below is read off the screen the persona is
 * looking at, and the ledger row is cross-read over HTTP on the owner's OWN bearer.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, log,
} from "./lib.mjs";

const browser = await newBrowser();
const out = {};

try {
  // ── a. ring a check ────────────────────────────────────────────────────────
  log("\n=== a. cashier rings a takeaway check ===");
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);

  // An outage looks exactly like a missing feature in a screenshot. The terminal is not scored
  // until the till strip actually reads — this run has already caught pos-service mid-restart
  // once, announcing "The till is unavailable right now" where a careless harness would have
  // recorded an empty page.
  let t = null;
  let till = null;
  for (let i = 0; i < 20; i++) {
    try {
      t = await go(cash, "/app/pos", { waitMs: 8000, allowTrouble: true });
      till = await cash.evaluate(() => {
        const txt = document.body.innerText;
        return /Till [A-Z]+[^\n]*/.exec(txt)?.[0] ?? /No active till/.exec(txt)?.[0] ?? null;
      });
      if (till && !/unavailable/i.test((t.alerts ?? []).join(" "))) break;
      log(`  attempt ${i + 1}: terminal not usable yet — ${JSON.stringify(t?.alerts).slice(0, 160)}`);
    } catch (e) {
      // A reload landing mid-navigation destroys the evaluate context. That is a harness race,
      // not a product fact, and must not be recorded as one.
      log(`  attempt ${i + 1}: probe raced a navigation (${e.message.slice(0, 80)})`);
    }
    await cash.waitForTimeout(10000);
  }
  log("  /app/pos:", JSON.stringify(t));
  log("  till strip:", till);
  if (!till) throw new Error("the POS terminal never became usable — pos-service is down");
  out.tillStrip = till;
  await shot(cash, "02a-pos-till");

  await cash.locator("[data-testid=order-type-takeaway]").click();
  await cash.waitForTimeout(600);

  const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(0).click();
  await cash.waitForTimeout(300);
  await tiles.nth(1).click();
  await cash.waitForTimeout(900);
  await shot(cash, "02b-cart");

  await cash.locator("[data-testid=send-to-kitchen-button]").click();
  await cash.waitForTimeout(8000);
  await shot(cash, "02c-fired");

  // The order number is on the panel the cashier is looking at — read it there rather than
  // trusting a list endpoint to be sorted the way the screen is.
  out.orderNo = await cash.evaluate(
    () => /ORD-\d{8}-\d{4}/.exec(document.body.innerText)?.[0] ?? null,
  );
  if (!out.orderNo) throw new Error("no order number on the terminal after Send to Kitchen");
  log(`  fired: ${out.orderNo}`);

  // ── b. settle it ───────────────────────────────────────────────────────────
  log("\n=== b. cashier settles it in cash and closes it ===");
  const charge = await cash.evaluate(() =>
    Array.from(document.querySelectorAll("button,a"))
      .filter((n) => /charge/i.test((n.textContent || "").trim()))
      .map((n) => ({
        tag: n.tagName,
        text: (n.textContent || "").trim(),
        testid: n.getAttribute("data-testid"),
        href: n.getAttribute("href"),
        disabled: n.disabled ?? null,
      })),
  );
  log("  charge controls on the panel:", JSON.stringify(charge));
  await cash.locator("button, a").filter({ hasText: /charge/i }).first().click();
  await cash.waitForTimeout(7000);
  out.orderId = /\/orders\/([0-9a-f-]{36})\//.exec(cash.url())?.[1] ?? null;
  log("  charge url:", cash.url());
  await shot(cash, "02d-charge-page");

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
  await cash.waitForTimeout(8000);
  await shot(cash, "02e-after-payment");

  const paid = await cash.evaluate(() => ({
    err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
    paid: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
  }));
  log("  after payment:", JSON.stringify(paid));
  out.payment = paid;

  const closeBtn = cash.locator("[data-testid=close-order-button]");
  if (await closeBtn.count()) {
    await closeBtn.first().click();
    await cash.waitForTimeout(9000);
    await shot(cash, "02f-after-close");
    log("  pressed Mark served & close order");
  }

  // ── c. the owner reads the ledger ──────────────────────────────────────────
  log("\n=== c. owner opens the journal list ===");
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  // The auto-posting consumer is asynchronous. Poll the SCREEN, not the database.
  let seen = null;
  for (let i = 0; i < 12; i++) {
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
        uuidDescriptions: rows.filter((r) =>
          r.some((c) =>
            /Order revenue [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(c),
          ),
        ).length,
      };
    }, out.orderNo);
    if (seen.rowWithOrder) break;
    log(`  attempt ${i + 1}: not posted yet (first row: ${JSON.stringify(seen.firstRow)})`);
    await owner.waitForTimeout(5000);
  }
  log("  journal list:", JSON.stringify(seen, null, 1));
  out.listView = seen;
  await shot(owner, "02g-journal-list-unfiltered");

  // ── d. search for it ───────────────────────────────────────────────────────
  log("\n=== d. owner searches the list for the order number ===");
  const box = owner.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });
  await box.fill(out.orderNo);
  await owner.waitForTimeout(4000);
  await shot(owner, "02h-journal-search-hit");

  const searched = await owner.evaluate(() => {
    const table = document.querySelector("table");
    const rows = table
      ? Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim()),
        )
      : [];
    return {
      rows,
      countLine:
        document.querySelector('[data-testid="je-result-count"]')?.textContent?.trim() ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        n.textContent.trim(),
      ),
    };
  });
  log("  after searching:", JSON.stringify(searched, null, 1));
  out.searchView = searched;

  // A term that matches nothing must say so, and must not look like an outage.
  await box.fill("ORD-19990101-0001");
  await owner.waitForTimeout(3500);
  await shot(owner, "02i-journal-search-no-match");
  out.noMatchText = await owner.evaluate(() =>
    document.body.innerText.replace(/\s+/g, " ").slice(0, 600),
  );
  log("  no-match screen:", out.noMatchText.slice(0, 260));

  // Cross-read the ledger row over HTTP on the owner's own bearer.
  const api = await apiGet(
    owner,
    `/api/v1/finance/journal-entries?q=${encodeURIComponent(out.orderNo)}`,
  );
  out.apiSearch = { status: api.status, rows: api.body?.data ?? [] };
  log(
    "  API ?q= :",
    api.status,
    JSON.stringify((api.body?.data ?? []).map((j) => `${j.entryNo} ${j.sourceType} :: ${j.description}`)),
  );

  saveState({ prove: out });
} finally {
  await browser.close();
}
