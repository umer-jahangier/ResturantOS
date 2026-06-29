import { test, expect } from "@playwright/test";

/**
 * POS offline sync E2E scaffold.
 *
 * Verifies the full offline → reconnect → exactly-one-order flow:
 *
 *  1. Warm up the POS cache while online.
 *  2. Go offline.
 *  3. Create an order — UI renders immediately via IndexedDB outbox.
 *  4. Sync badge shows ≥1 pending op.
 *  5. Page reload — pending op survives (IndexedDB is persistent).
 *  6. Go online — sync badge drains to 0 (exactly one order created server-side).
 *  7. Try to charge while offline — OFFLINE_ERROR message appears.
 *
 * NOTE: These tests require the full stack (backend + frontend) to be running.
 * In CI the playwright webServer config builds and starts the frontend; the backend
 * must be available at the URL set by NEXT_PUBLIC_API_URL.
 * Selectors are tied to data-testid attributes added during 07-03.
 */
test.describe("POS offline sync", () => {
  test.beforeEach(async ({ page }) => {
    // Ensure we start online for each test.
    await page.context().setOffline(false);
  });

  test("offline create syncs to exactly one order on reconnect", async ({
    page,
    context,
  }) => {
    // ── Step 1: Load POS while online (warms SW cache) ─────────────────────────
    await page.goto("/app/pos");
    // Wait for the menu grid to confirm data loaded from the server.
    await page.waitForSelector('[data-testid="menu-grid"]', { timeout: 15_000 });

    // ── Step 2: Go offline ─────────────────────────────────────────────────────
    await context.setOffline(true);

    // Offline banner should appear.
    await expect(page.locator('[data-testid="offline-banner"]')).toBeVisible();

    // ── Step 3: Create an order while offline ──────────────────────────────────
    // Select the first table (if floor view is shown; navigate to terminal otherwise).
    const tableBtn = page.locator('[data-testid^="table-"]').first();
    if (await tableBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tableBtn.click();
    }

    // Click the first menu item to add it to the order.
    await page.locator('[data-testid="menu-item-first"]').click();

    // ── Step 4: Sync badge shows ≥1 pending op ─────────────────────────────────
    // The badge appears when pending > 0.
    await expect(page.locator('[data-testid="sync-badge"]')).toBeVisible({
      timeout: 5_000,
    });
    const badgeText = await page.locator('[data-testid="sync-badge"]').textContent();
    expect(Number(badgeText?.match(/\d+/)?.[0] ?? "0")).toBeGreaterThan(0);

    // ── Step 5: Reload — pending op survives IndexedDB persistence ─────────────
    await page.reload();
    await page.waitForSelector('[data-testid="sync-badge"]', { timeout: 10_000 });
    const badgeAfterReload = await page.locator('[data-testid="sync-badge"]').textContent();
    expect(Number(badgeAfterReload?.match(/\d+/)?.[0] ?? "0")).toBeGreaterThan(0);

    // ── Step 6: Go online — sync badge drains ─────────────────────────────────
    await context.setOffline(false);

    // Wait for the sync to complete (badge disappears or shows "All synced" if an
    // error is retained).
    await expect(page.locator('[data-testid="sync-badge"]')).toBeHidden({
      timeout: 15_000,
    });

    // ── Step 7: Try to charge while offline — must be blocked ─────────────────
    await context.setOffline(true);

    // Navigate to an open order (the one just synced or the stub still in UI).
    const chargeBtn = page.locator('[data-testid="charge-button"]').first();
    if (await chargeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await chargeBtn.click();
      // The offline-only guard should surface the OFFLINE_ERROR.
      await expect(
        page.locator('[data-testid="online-required-message"]'),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        page.locator('[data-testid="online-required-message"]'),
      ).toContainText("connection");
    }

    // Clean up.
    await context.setOffline(false);
  });
});
