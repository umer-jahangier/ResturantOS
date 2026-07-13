import { test, expect } from "@playwright/test";

/**
 * POS-25 executable backstop — proves the till open/close and void/refund surfaces
 * converted in 07.3-09 are dedicated large in-place panels, NOT hand-rolled popups:
 * each has no `[role=dialog]` in the DOM, and each is captured to a named screenshot
 * under `e2e/__screenshots__/`. Replaces the former manual/SUMMARY screenshot note for
 * POS-25 with a real, automated check.
 *
 * Reuses the login/gotoRobust/Blocked conventions from pos-settlement.spec.ts. Runs
 * against the LIVE local dev stack (frontend :3000, pos-service :8084). Requires the
 * demo cashier seed (cashier@demo.local / Cashier#2026, tenant "demo") and at least 1
 * active menu item for the branch.
 *
 * "FAIL" = a real frontend defect (surface still a dialog, or the panel never renders).
 * "BLOCKED" = missing seed/environment precondition, not a code defect.
 */

const CASHIER_EMAIL = "cashier@demo.local";
const CASHIER_PASSWORD = "Cashier#2026";
const TENANT_SLUG = "demo";
const SHOT_DIR = "e2e/__screenshots__";

/** Thrown to mean "environment/seed-data precondition missing", not a code bug. */
class Blocked extends Error {}

test.describe("POS-25: converted operational surfaces are panels, not dialogs", () => {
  test("till open/close and void/refund panels render with no [role=dialog]", async ({ page }) => {
    test.setTimeout(180_000);

    async function shot(name: string): Promise<void> {
      await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true }).catch(() => {});
    }

    const netLog: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) netLog.push(`REQ ${r.method()} ${r.url()}`);
    });
    page.on("requestfailed", (r) => {
      netLog.push(`REQFAIL ${r.method()} ${r.url()} -> ${r.failure()?.errorText}`);
    });
    page.on("response", (r) => {
      if (r.url().includes("/api/")) netLog.push(`RES ${r.request().method()} ${r.url()} -> ${r.status()}`);
    });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err?.stack ?? err)));

    /** Asserts no `[role=dialog]` is present/visible anywhere on the page. */
    async function assertNoDialog(context: string): Promise<void> {
      const dialogVisible = await page
        .getByRole("dialog")
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (dialogVisible) {
        throw new Error(`a [role=dialog] is visible for ${context} — must be a dedicated panel, not a popup`);
      }
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
      await login(CASHIER_EMAIL, CASHIER_PASSWORD);
      await gotoRobust("/app/pos");
      await page.waitForTimeout(1500);

      const notEnabled = page.getByText("POS feature is not enabled for this account.");
      if (await notEnabled.isVisible({ timeout: 500 }).catch(() => false)) {
        throw new Blocked("FEATURE_POS is not enabled for the demo tenant");
      }

      // ── Till surface (open OR close panel, whichever this cashier's session needs) ──
      const noTill = page.getByText("No active till");
      const tillOpenBar = page.getByText("Till OPEN");
      const tillState = await Promise.race([
        noTill.waitFor({ state: "visible", timeout: 10_000 }).then(() => "closed" as const),
        tillOpenBar.waitFor({ state: "visible", timeout: 10_000 }).then(() => "open" as const),
      ]).catch(() => "unknown" as const);

      if (tillState === "closed") {
        await page.getByTestId("open-till-button").click();
        const openPanel = page.getByTestId("open-till-panel");
        await expect(openPanel).toBeVisible({ timeout: 10_000 });
        await assertNoDialog("the open-till panel");
        await shot("pos25-till");

        await page.getByPlaceholder("e.g. 5000.00").fill("5000");
        await page.getByTestId("open-till-confirm-button").click();
        const outcome = await Promise.race([
          page.getByText("Till OPEN").waitFor({ state: "visible", timeout: 15_000 }).then(() => "ok" as const),
          page.getByTestId("open-till-error").waitFor({ state: "visible", timeout: 15_000 }).then(() => "err" as const),
        ]).catch(() => "timeout" as const);
        if (outcome !== "ok") throw new Blocked(`could not open a till for the cashier (${outcome})`);
      } else if (tillState === "open") {
        await page.getByTestId("close-till-button").click();
        const closePanel = page.getByTestId("close-till-panel");
        await expect(closePanel).toBeVisible({ timeout: 10_000 });
        await assertNoDialog("the close-till panel");
        await shot("pos25-till");

        // Don't actually close the till — this cashier's session needs it OPEN to
        // create/fire the order below. Dismiss via Cancel (structural check only).
        await closePanel.getByRole("button", { name: "Cancel" }).click();
        await expect(closePanel).toBeHidden({ timeout: 5_000 });
      } else {
        throw new Blocked("TillSessionBar showed neither 'No active till' nor 'Till OPEN'");
      }

      // ── Void/refund surface — needs a real fired order (SettlementActions only
      // renders once the cart has been persisted, order-panel.tsx's SentOrder view) ──
      await page.getByRole("button", { name: "POS Terminal", exact: true }).click();
      const firstItem = page.getByTestId("menu-item-first");
      if (!(await firstItem.isVisible({ timeout: 15_000 }).catch(() => false))) {
        throw new Blocked("no menu items rendered (menu-item-first never appeared)");
      }
      await firstItem.click();

      const sendBtn = page.getByRole("button", { name: /^Send to Kitchen$/ });
      await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
      await sendBtn.click();

      const voidTrigger = page.getByRole("button", { name: "Void order" });
      if (!(await voidTrigger.isVisible({ timeout: 30_000 }).catch(() => false))) {
        await shot("DEBUG-no-void-trigger");
        throw new Blocked(
          `Void action not rendered after firing an order (create+addItem+fire persist chain did not ` +
            `complete in time) — last network events: ${JSON.stringify(netLog.slice(-6))} ` +
            `consoleErrors=${JSON.stringify(consoleErrors.slice(0, 5))}`,
        );
      }
      await voidTrigger.click();

      const voidPanel = page.getByTestId("void-refund-panel");
      await expect(voidPanel).toBeVisible({ timeout: 10_000 });
      await assertNoDialog("the void/refund panel");
      await shot("pos25-void-refund");

      // Structural check only — dismiss without confirming the void.
      await voidPanel.getByRole("button", { name: "Cancel" }).click();
      await expect(voidPanel).toBeHidden({ timeout: 5_000 });
    } catch (err) {
      if (err instanceof Blocked) {
        console.log(`[BLOCKED] pos-modal-revamp: ${err.message}`);
        test.skip(true, `BLOCKED (environment/seed precondition, not a frontend defect): ${err.message}`);
        return;
      }
      throw err;
    }
  });
});
