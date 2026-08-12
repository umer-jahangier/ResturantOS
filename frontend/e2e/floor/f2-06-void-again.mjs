/*
 * F2 step 6 — the void in step 4 did not land; find out what the screen actually did, then do it
 * again with the panel read out loud at every step. An unexplained no-op is exactly the shape
 * this whole repair is about, so it gets diagnosed rather than retried blind.
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
  saveState,
  log,
} from "./f2-lib.mjs";

const st = loadState();
const TARGET = st.rung?.dineInNoTable;
const LONG = st.longReason;

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.manager);
  await openOrderManagement(page);
  const token = await tokenOf(page);
  const branchId = st.branchId;

  const list = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=30`, token);
  const row = (list.body?.data ?? []).find((r) => r.orderNo === TARGET);
  log(`  ${TARGET} on the server now: status=${row?.settlementStatus} type=${row?.type}`);

  // Find it on screen and open its drawer.
  await page.locator('[data-testid="order-management-search"]').fill(TARGET);
  await page.waitForTimeout(2500);
  await shot(page, "20-search-target");

  await page.locator(`button[aria-label^="Open order ${TARGET}"]`).first().click();
  await page.waitForTimeout(3500);
  const drawer = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      voidTriggers: Array.from(document.querySelectorAll("button"))
        .map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim())
        .filter((s) => /void|refund/i.test(s)),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
      mentionsDineIn: /Dine-in/.test(t),
    };
  });
  log("  drawer:", JSON.stringify(drawer, null, 1));
  await shot(page, "21-drawer");

  await page.locator('button[aria-label*="Void order" i]').first().click();
  await page.waitForTimeout(1500);
  await shot(page, "22-void-panel");

  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll("textarea, input")).map((n) => ({
      tag: n.tagName,
      ph: n.getAttribute("placeholder"),
      label: n.getAttribute("aria-label"),
      visible: !!(n.offsetWidth || n.offsetHeight),
    })),
  );
  log("  fields in the void panel:", JSON.stringify(boxes));

  const reason = page.locator("textarea").first();
  await reason.fill(LONG);
  await page.waitForTimeout(500);
  const filled = await reason.inputValue();
  log(`  reason typed: ${filled.length} chars`);

  const confirmButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .map((b) => ({ t: (b.textContent || "").trim(), disabled: b.disabled }))
      .filter((b) => /confirm|void/i.test(b.t)),
  );
  log("  confirm controls:", JSON.stringify(confirmButtons));

  await page.locator('button:has-text("Confirm Void")').first().click();
  await page.waitForTimeout(6000);
  await shot(page, "23-after-confirm");
  const after = await page.evaluate(() => ({
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) =>
      n.innerText.trim(),
    ),
  }));
  log("  after confirm:", JSON.stringify(after));

  const list2 = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&status=VOIDED&size=30`, token);
  const voided = (list2.body?.data ?? []).find((r) => r.orderNo === TARGET);
  log(`  ${TARGET} after: status=${voided?.settlementStatus} type=${voided?.type} reason=${JSON.stringify(voided?.settlement?.reason)}`);
  saveState({ voidedTarget: TARGET, voidLanded: !!voided });

  const posts = page.__requests.filter((r) => r.u.includes("/void"));
  log("  void calls on the wire:", JSON.stringify(posts));
} finally {
  await page.context().close();
  await browser.close();
}
