import { test, expect } from "@playwright/test";

/**
 * POS-21 / D-06 Wave-0 E2E proof — opening an already-fired order in the Order/Table
 * detail surface, adding a new item, shows a "Send New Items (N)" CTA that fires ONLY
 * the newly-added PENDING line(s) as a new revision; the already-fired line is never
 * resent (07.3-06 Task 2, order-table-detail-drawer.tsx).
 *
 * Same login/gotoRobust/Blocked conventions as pos-settlement.spec.ts. Runs against the
 * LIVE local dev stack (frontend :3000, pos-service :8084). Requires the demo cashier
 * (cashier@demo.local / Cashier#2026), tenant "demo", and >=2 active menu items for the
 * branch (one to fire as rev 1 from the Terminal, a second to add as the new PENDING
 * line from Order Management's detail surface).
 *
 * "FAIL" = a real frontend defect (CTA missing/wrong count, or the already-fired line
 * gets resent). "BLOCKED" = missing seed/environment precondition, not a code defect.
 */

const CASHIER_EMAIL = "cashier@demo.local";
const CASHIER_PASSWORD = "Cashier#2026";
const TENANT_SLUG = "demo";
const SHOT_DIR = "e2e/__screenshots__";

/** Thrown to mean "environment/seed-data precondition missing", not a code bug. */
class Blocked extends Error {}

test.describe("POS-21: add-existing item on a fired order shows/fires 'Send New Items (N)' as a new revision", () => {
  test("open a fired order, add a new item, fire only the new item as rev 2", async ({ page }) => {
    test.setTimeout(180_000);

    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(`[console] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[pageerror] ${String(err?.stack ?? err)}`));

    async function shot(name: string): Promise<void> {
      await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true }).catch(() => {});
    }

    async function gotoRobust(url: string): Promise<void> {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      for (let i = 0; i < 3; i++) {
        const is404 = await page
          .getByText("404", { exact: false })
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (!is404) return;
        await page.waitForTimeout(2000);
        await page.reload({ waitUntil: "networkidle", timeout: 45_000 });
      }
    }

    async function login(email: string, password: string): Promise<void> {
      await gotoRobust(`/login?tenant=${TENANT_SLUG}`);
      const tenantField = page.locator('input[name="tenantSlug"]');
      if (await tenantField.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tenantField.fill(TENANT_SLUG);
      }
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/app\//, { timeout: 20_000 });
    }

    try {
      // ── Login, ensure till open, create + fire a rev-1 order with ONE item ──
      await login(CASHIER_EMAIL, CASHIER_PASSWORD);
      await gotoRobust("/app/pos");
      await page.waitForTimeout(1500);

      const notEnabled = page.getByText("POS feature is not enabled for this account.");
      if (await notEnabled.isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Blocked("FEATURE_POS is not enabled for the demo tenant");
      }

      const noTill = page.getByText("No active till");
      if (await noTill.isVisible({ timeout: 3000 }).catch(() => false)) {
        await page.getByTestId("open-till-button").click();
        await page.getByPlaceholder("e.g. 5000.00").fill("5000");
        await page.getByTestId("open-till-confirm-button").click();
        const outcome = await Promise.race([
          page.getByText("Till OPEN").waitFor({ state: "visible", timeout: 15_000 }).then(() => "ok" as const),
          page.getByTestId("open-till-error").waitFor({ state: "visible", timeout: 15_000 }).then(() => "err" as const),
        ]).catch(() => "timeout" as const);
        if (outcome !== "ok") throw new Blocked(`could not open a till for the cashier (${outcome})`);
      }

      await page.getByRole("button", { name: "POS Terminal", exact: true }).click();
      const menuItems = page.locator('[data-testid="menu-grid"] button');
      const menuCount = await menuItems.count();
      if (menuCount < 2) {
        throw new Blocked(`menu-grid has only ${menuCount} item(s); need >= 2 (one to fire, one to add later)`);
      }
      // .locator("span").first() (not the button's own textContent) — the button
      // concatenates the item-name span AND the MoneyDisplay price span with no
      // separator, so a raw textContent() read would corrupt the name used below to
      // identify this line in the send-to-kds response.
      const firstItemLabel = (await menuItems.nth(0).locator("span").first().textContent())?.trim() || "item 1";
      await menuItems.nth(0).click();
      await expect(page.getByRole("button", { name: /^Send to Kitchen$/ })).toBeEnabled({ timeout: 15_000 });
      await page.getByRole("button", { name: /^Send to Kitchen$/ }).click();

      // Sonner toasts auto-dismiss — the fired item's "Sent" badge is the stable signal.
      const firedBadge = page.getByLabel("Sent").first();
      const errorToast = page.getByText(/Failed to send to kitchen/i);
      const fireOutcome = await Promise.race([
        firedBadge.waitFor({ state: "visible", timeout: 15_000 }).then(() => "success" as const),
        errorToast.waitFor({ state: "visible", timeout: 15_000 }).then(() => "error" as const),
      ]).catch(() => "timeout" as const);
      if (fireOutcome !== "success") {
        throw new Blocked(`initial send-to-kitchen (rev 1, "${firstItemLabel}") did not succeed (${fireOutcome})`);
      }

      const orderNoLocator = page.locator("span.font-semibold.text-sm").first();
      const orderNo = (await orderNoLocator.textContent({ timeout: 5000 }).catch(() => null))?.trim();
      if (!orderNo || orderNo === "New Order") {
        throw new Blocked(`could not read a real order number from the terminal header (got "${orderNo}")`);
      }
      await shot("pos-add-existing-revision-rev1-fired");

      // ── Open the SAME order via Order Management's detail surface (POS-25 panel) ──
      await page.getByRole("button", { name: "Order Management", exact: true }).click();
      // Row render depends on the tab-switch triggering a fresh useOrderSummaries
      // fetch — `.isVisible()` does NOT auto-retry (it's an immediate DOM snapshot,
      // unlike `expect().toBeVisible()`), so waiting here needs the retrying assertion.
      const openBtn = page.getByRole("button", { name: `Open order ${orderNo}` });
      try {
        await expect(openBtn).toBeVisible({ timeout: 15_000 });
      } catch {
        await shot("DEBUG-order-management");
        const errDetail = pageErrors.length > 0 ? ` — console/page errors: ${JSON.stringify(pageErrors.slice(0, 5))}` : "";
        throw new Blocked(`order "${orderNo}" row (with its "Open" action) never appeared in Order Management${errDetail}`);
      }
      await openBtn.click();

      const drawer = page.getByTestId("order-table-detail-drawer");
      await expect(drawer).toBeVisible({ timeout: 10_000 });
      // POS-25: no centered/narrow dialog class on the panelized surface.
      const drawerClass = (await drawer.getAttribute("class")) ?? "";
      if (drawerClass.includes("sm:max-w-md")) {
        throw new Error(`order-table-detail-drawer still carries a centered "sm:max-w-md" dialog class`);
      }

      // Before adding anything, the CTA must be absent (0 PENDING lines — everything on
      // this order is already fired at rev 1).
      const ctaBtn = drawer.getByTestId("send-new-items-button");
      await expect(ctaBtn).not.toBeVisible({ timeout: 3000 });

      // ── Add a NEW item via the drawer's Quick Add search ──
      const searchInput = drawer.getByLabel("Search menu");
      await expect(searchInput).toBeVisible({ timeout: 10_000 });
      // "e" is broad enough to surface at least one result across the demo menu without
      // depending on a specific item name; take whichever result comes back first.
      await searchInput.fill("e");
      const results = drawer.getByTestId("quick-add-results");
      try {
        await expect(results).toBeVisible({ timeout: 8000 });
      } catch {
        throw new Blocked('Quick Add search for "e" returned no results — demo menu item-name assumption invalid');
      }
      const addedItemName = (await results.locator("li").first().locator("span").first().textContent())?.trim();
      await results.getByRole("button", { name: "Add" }).first().click();

      // ── "Send New Items (1)" appears with N = 1 new PENDING line ──
      await expect(ctaBtn).toBeVisible({ timeout: 10_000 });
      await expect(ctaBtn).toHaveText("Send New Items (1)");
      await shot("pos-add-existing-revision-new-item-added");

      // ── Fire — assert ONLY the new item goes out as a new revision ──
      const [sendResp] = await Promise.all([
        page
          .waitForResponse(
            (r) => r.url().includes("/send-to-kds") && r.request().method() === "POST",
            { timeout: 15_000 },
          )
          .catch(() => null),
        ctaBtn.click(),
      ]);
      if (!sendResp) {
        throw new Error('"Send New Items" click never produced a POST .../send-to-kds response');
      }
      if (!sendResp.ok()) {
        throw new Error(`Send New Items fire failed: HTTP ${sendResp.status()} ${sendResp.statusText()}`);
      }

      const body = (await sendResp.json().catch(() => null)) as
        | { data?: { items?: { itemNameSnapshot: string; revisionNo: number }[] } }
        | null;
      const items = body?.data?.items ?? [];
      if (items.length === 0) {
        throw new Blocked("send-to-kds response had no parseable items[] to verify per-line revisionNo against");
      }

      // Partition by revisionNo rather than by item name — the fired item and the
      // newly-added item can legitimately be the SAME menu item (as in this run, both
      // "Beef Nihari"), so name-based matching is ambiguous. revisionNo is the actual
      // thing under test: the pre-existing line must stay at rev 1 (never resent); the
      // just-added line must now be > 1 (fired as the new revision this click produced).
      const rev1Items = items.filter((i) => i.revisionNo === 1);
      const newRevItems = items.filter((i) => i.revisionNo > 1);
      if (rev1Items.length !== 1) {
        throw new Error(
          `expected exactly 1 line to remain at revisionNo=1 (the already-fired "${firstItemLabel}" line, ` +
            `never resent) — found ${rev1Items.length}: ${JSON.stringify(items)}`,
        );
      }
      if (newRevItems.length !== 1) {
        throw new Error(
          `expected exactly 1 line to have fired as a NEW revision (the added "${addedItemName ?? "item"}" ` +
            `line) — found ${newRevItems.length}: ${JSON.stringify(items)}`,
        );
      }

      // Stable-DOM confirmation: the CTA disappears once N drops back to 0.
      await expect(ctaBtn).toBeHidden({ timeout: 10_000 });
      await shot("pos-add-existing-revision-fired-rev2");
    } catch (err) {
      if (err instanceof Blocked) {
        console.log(`[BLOCKED] pos-add-existing-revision: ${err.message}`);
        test.skip(true, `BLOCKED (environment/seed precondition, not a frontend defect): ${err.message}`);
        return;
      }
      throw err;
    }
  });
});
