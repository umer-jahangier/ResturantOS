/*
 * F2 step 7 — "Failed to void. Please try again." is not a diagnosis. Read the wire.
 *
 * The panel refused with no [role=alert] and no status code on screen. Before deciding whether
 * that belongs to this item, capture the actual response the browser got, on the manager's own
 * bearer, for the manager's own click.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  shot,
  openOrderManagement,
  apiGet,
  tokenOf,
  loadState,
  log,
} from "./f2-lib.mjs";

const st = loadState();
const TARGET = st.rung?.dineInNoTable;
const LONG = st.longReason;
const branchId = st.branchId;

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.manager);

  // Capture every void response body, not just its status.
  const voidResponses = [];
  page.on("response", async (r) => {
    if (r.url().includes("/void")) {
      let body = null;
      try {
        body = await r.text();
      } catch {
        body = "(unreadable)";
      }
      voidResponses.push({ status: r.status(), url: r.url(), body: body?.slice(0, 500) });
    }
  });

  await openOrderManagement(page);
  const token = await tokenOf(page);

  const perms = await page.evaluate(async (tok) => {
    const parts = tok.split(".");
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  }, token);
  log("  manager's live token carries:");
  log("    permissions:", JSON.stringify(perms.permissions ?? perms.perms ?? perms.scope));
  log("    roles:", JSON.stringify(perms.roles));

  // Ten agents share this stack and pos-service is being cycled by a sibling; retry the search
  // until the list actually answers rather than scoring a screen mid-outage.
  const openBtn = page.locator(`button[aria-label^="Open order ${TARGET}"]`);
  let found = 0;
  for (let attempt = 1; attempt <= 12 && found === 0; attempt++) {
    await page.locator('[data-testid="order-management-search"]').fill("");
    await page.waitForTimeout(700);
    await page.locator('[data-testid="order-management-search"]').fill(TARGET);
    await page.waitForTimeout(6000);
    found = await openBtn.count();
    const outage = await page.evaluate(
      () => !!document.querySelector('[data-testid="query-error"], [role="alert"]'),
    );
    log(`  attempt ${attempt}: openButtons=${found} outageOnScreen=${outage}`);
    if (found === 0) {
      const retry = page.locator('button:has-text("Try again")');
      if (await retry.count()) await retry.first().click();
      await page.waitForTimeout(6000);
    }
  }
  await shot(page, "24-search-settled");
  log("  open buttons found:", found);
  await openBtn.first().click();
  await page.waitForTimeout(3500);

  await page.locator('button[aria-label*="Void order" i]').first().click();
  await page.waitForTimeout(1200);
  await page.locator("textarea").first().fill(LONG);
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Confirm Void")').first().click();
  await page.waitForTimeout(6000);
  await shot(page, "25-void-result");

  log("\n  void calls on the wire:");
  for (const r of voidResponses) log("   ", JSON.stringify(r));

  const inline = await page.evaluate(() =>
    Array.from(document.querySelectorAll("p,div,span"))
      .map((n) => n.textContent?.trim())
      .filter((t) => t && /failed to void|permission|cannot be voided/i.test(t))
      .slice(0, 4),
  );
  log("  what the panel says:", JSON.stringify(inline));

  const after = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=30&q=${TARGET}`, token);
  const row = (after.body?.data ?? []).find((r) => r.orderNo === TARGET);
  log(`  ${TARGET} status now: ${row?.settlementStatus}`);
} finally {
  await page.context().close();
  await browser.close();
}
