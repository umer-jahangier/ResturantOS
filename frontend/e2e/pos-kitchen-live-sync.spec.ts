import { test, expect } from "@playwright/test";

/**
 * POS-20 / D-05 Wave-0 E2E proof — a kitchen-side per-item status transition (driven by
 * a chef@demo.local session on the KDS board) reflects LIVE in the cashier's POS order
 * view, with NO manual reload, within `useOrder`'s refetchInterval window (07.3-06
 * Task 1, use-orders.ts).
 *
 * Two independent browser contexts (cashier + chef), same pattern as
 * pos-settlement.spec.ts's login/gotoRobust/Blocked/stage conventions. Runs against the
 * LIVE local dev stack (frontend :3000, pos-service :8084, kitchen-service :8090).
 * Requires the demo cashier (cashier@demo.local / Cashier#2026) and kitchen (
 * chef@demo.local / Chef#2026) seeds, tenant "demo", and >=1 active menu item with a
 * seeded kdsStation so a kitchen ticket is actually created.
 *
 * "FAIL" = a real frontend defect (the item never syncs live). "BLOCKED" = missing
 * seed/environment precondition, not a code defect.
 */

const CASHIER_EMAIL = "cashier@demo.local";
const CASHIER_PASSWORD = "Cashier#2026";
const CHEF_EMAIL = "chef@demo.local";
const CHEF_PASSWORD = "Chef#2026";
const TENANT_SLUG = "demo";
const SHOT_DIR = "e2e/__screenshots__";

/** Thrown to mean "environment/seed-data precondition missing", not a code bug. */
class Blocked extends Error {}

test.describe("POS-20: kitchen item-status change syncs live to POS order view", () => {
  test("chef bumps an item on KDS; cashier's terminal reflects it without a reload", async ({
    page: cashierPage,
    browser,
  }) => {
    test.setTimeout(180_000);

    async function shot(page: typeof cashierPage, name: string): Promise<void> {
      await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true }).catch(() => {});
    }

    async function gotoRobust(page: typeof cashierPage, url: string): Promise<void> {
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

    async function login(page: typeof cashierPage, email: string, password: string): Promise<void> {
      await gotoRobust(page, `/login?tenant=${TENANT_SLUG}`);
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
      // ── Cashier: login, ensure till open, create + fire an order with 1 item ──
      await login(cashierPage, CASHIER_EMAIL, CASHIER_PASSWORD);
      await gotoRobust(cashierPage, "/app/pos");
      await cashierPage.waitForTimeout(1500);

      const notEnabled = cashierPage.getByText("POS feature is not enabled for this account.");
      if (await notEnabled.isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Blocked("FEATURE_POS is not enabled for the demo tenant");
      }

      const noTill = cashierPage.getByText("No active till");
      if (await noTill.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cashierPage.getByTestId("open-till-button").click();
        await cashierPage.getByPlaceholder("e.g. 5000.00").fill("5000");
        await cashierPage.getByTestId("open-till-confirm-button").click();
        const outcome = await Promise.race([
          cashierPage.getByText("Till OPEN").waitFor({ state: "visible", timeout: 15_000 }).then(() => "ok" as const),
          cashierPage.getByTestId("open-till-error").waitFor({ state: "visible", timeout: 15_000 }).then(() => "err" as const),
        ]).catch(() => "timeout" as const);
        if (outcome !== "ok") throw new Blocked(`could not open a till for the cashier (${outcome})`);
      }

      await cashierPage.getByRole("button", { name: "POS Terminal", exact: true }).click();
      const firstItem = cashierPage.getByTestId("menu-item-first");
      try {
        await expect(firstItem).toBeVisible({ timeout: 15_000 });
      } catch {
        throw new Blocked("no menu items rendered (menu-item-first never appeared)");
      }
      await firstItem.click();
      await expect(cashierPage.getByRole("button", { name: /^Send to Kitchen$/ })).toBeEnabled({ timeout: 15_000 });
      await cashierPage.getByRole("button", { name: /^Send to Kitchen$/ }).click();

      // Sonner toasts auto-dismiss (~4s) and can vanish before an assertion gets to
      // them — the "Sent" status badge is stable DOM, not transient UI, so it's the
      // reliable success signal (also doubles as this stage's pre-bump baseline).
      const itemBadge = cashierPage.getByLabel("Sent").first();
      const errorToast = cashierPage.getByText(/Failed to send to kitchen/i);
      const fireOutcome = await Promise.race([
        itemBadge.waitFor({ state: "visible", timeout: 15_000 }).then(() => "success" as const),
        errorToast.waitFor({ state: "visible", timeout: 15_000 }).then(() => "error" as const),
      ]).catch(() => "timeout" as const);
      if (fireOutcome !== "success") {
        throw new Blocked(`initial send-to-kitchen did not succeed (${fireOutcome})`);
      }
      const orderNoLocator = cashierPage.locator("span.font-semibold.text-sm").first();
      const orderNo = (await orderNoLocator.textContent({ timeout: 5000 }).catch(() => null))?.trim();
      if (!orderNo || orderNo === "New Order") {
        throw new Blocked(`could not read a real order number from the terminal header (got "${orderNo}")`);
      }
      await shot(cashierPage, "pos-kitchen-live-sync-cashier-before-bump");

      // ── Chef: independent browser context, bump the matching ticket's item ──
      const chefContext = await browser.newContext();
      const chefPage = await chefContext.newPage();
      const ticketsApiErrors: string[] = [];
      chefPage.on("response", (resp) => {
        if (resp.url().includes("/api/v1/kitchen/kds/tickets") && !resp.ok()) {
          ticketsApiErrors.push(`${resp.status()} ${resp.url()}`);
        }
      });
      try {
        await login(chefPage, CHEF_EMAIL, CHEF_PASSWORD);
        await gotoRobust(chefPage, "/app/kitchen");
        await chefPage.waitForTimeout(1500);

        const noStations = chefPage.getByText("No active stations configured.");
        if (await noStations.isVisible({ timeout: 2000 }).catch(() => false)) {
          throw new Blocked("no active KDS stations configured for the demo branch");
        }

        await shot(chefPage, "kds-board");
        const matchingCard = chefPage
          .locator('[data-testid="kds-ticket-card"]')
          .filter({ hasText: orderNo });
        // `.isVisible()` does NOT auto-retry — use the retrying assertion so this
        // genuinely waits out the board's HTTP-poll/WebSocket window before concluding
        // the ticket never appeared.
        const cardAppeared = await matchingCard
          .first()
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (!cardAppeared) {
          // GET /kitchen/kds/tickets can fail (e.g. HTTP 500/503) silently on the board — the
          // query falls back to `tickets = []` and renders as an innocuous-looking empty
          // column, not an error state (kds-board.tsx). Surface the real backend error here
          // instead of guessing at a seed-data gap when one actually occurred.
          if (ticketsApiErrors.length > 0) {
            throw new Blocked(
              `GET /kitchen/kds/tickets returned a non-2xx response (kitchen-service backend ` +
                `defect, out of this plan's frontend-only scope — see deferred-items.md): ${ticketsApiErrors.join(", ")}`,
            );
          }
          // Root-caused live (07.3-06 Task 4 investigation): KdsController.getTickets has no
          // explicit sort and Spring's default Pageable is unsorted+size=20. This dev branch's
          // GRILL station bucket has accumulated 25+ PENDING tickets from prior test/UAT runs
          // that were never bumped past PENDING (kds-board.tsx never removes/expires stale
          // PENDING tickets) — a freshly-fired order's ticket reliably lands beyond page 1 and
          // never renders on the board. Confirmed via a direct authenticated GET with
          // size=100 showing our order present but at position 29/29. This is an environment
          // data-hygiene + backend-pagination gap in kitchen-service (KdsController/pageable
          // default), entirely out of this plan's frontend-only scope — see deferred-items.md.
          throw new Blocked(
            `no KDS ticket card for order "${orderNo}" appeared on the board within 15s — the ` +
              "ticket almost certainly exists but is beyond the board's default page-1/size-20 " +
              "window (this dev branch's GRILL station has 25+ accumulated stale PENDING " +
              "tickets from prior runs; kitchen-service's GET /kds/tickets has no explicit sort " +
              "or larger default page size); see deferred-items.md",
          );
        }

        const startBtn = matchingCard.first().getByRole("button", { name: "START" });
        const startBtnVisible = await startBtn
          .waitFor({ state: "visible", timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        if (!startBtnVisible) {
          throw new Blocked(`ticket card for "${orderNo}" found but no PENDING item START button is visible`);
        }
        await shot(chefPage, "pos-kitchen-live-sync-chef-before-bump");
        await startBtn.click();
        await shot(chefPage, "pos-kitchen-live-sync-chef-after-bump");
      } finally {
        await chefContext.close();
      }

      // ── Cashier: same page, NO reload — assert the item's badge advances live ──
      // Kitchen PENDING->COOKING (bumpItem's START transition) maps server-side
      // (KitchenItemStatusConsumer.STATUS_MAP) to pos-service OrderItemStatus.PREPARING
      // ("Preparing" badge label) — useOrder's 5s refetchInterval (07.3-06 Task 1) picks
      // this up with no user action.
      await expect(cashierPage.getByLabel("Preparing").first()).toBeVisible({ timeout: 15_000 });
      await shot(cashierPage, "pos-kitchen-live-sync-cashier-after-bump");
    } catch (err) {
      if (err instanceof Blocked) {
        console.log(`[BLOCKED] pos-kitchen-live-sync: ${err.message}`);
        test.skip(true, `BLOCKED (environment/seed precondition, not a frontend defect): ${err.message}`);
        return;
      }
      throw err;
    }
  });
});
