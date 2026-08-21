import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";

/**
 * THE COMMAND PALETTE — 38-11, UI-SPEC §10.
 *
 * <h3>Status: written, NOT YET RUN</h3>
 *
 * This spec belongs to the `journeys` project, which `playwright.config.ts` gates behind
 * `E2E_STACK=1` because it needs a live sixteen-service stack plus a seeded database. The
 * implementing session had neither, so **these assertions have never been executed** and must not
 * be reported as passing. Everything they check that can be checked without a browser is already
 * covered and green in `__tests__/components/command-palette.test.tsx` (27 tests, with all six of
 * 38-11's negative controls observed red and restored); what only a browser can answer is the
 * three things below.
 *
 * Saying so explicitly rather than leaving it implied: a suite that reports success while
 * executing nothing is the most expensive kind of green there is.
 *
 * <h3>What only a real browser can answer</h3>
 *
 *   1. **`aria-modal` read off the DOM.** The audit measured `null` on the live palette while the
 *      component source looked correct — Radix sets `role="dialog"` and manages focus but does not
 *      set the attribute. It is read back from the browser here for exactly that reason.
 *   2. **Recents surviving a reload.** `localStorage` in jsdom is a Map; the thing worth proving is
 *      that a real profile, on a real origin, still has the list after a navigation.
 *   3. **Seeded entities.** The unit suite matches against an MSW fixture. Only a seeded database
 *      can show that a real order number typed into the box comes back.
 */

const TENANT = "terrace";

test.describe("command palette", () => {
  test("⌘K opens a modal dialog and Escape returns focus to the trigger", async ({ as }) => {
    const page = await as(persona(TENANT, "owner"));
    await page.goto("/app/dashboard");

    const trigger = page.getByRole("button", { name: "Open command palette" });
    await expect(trigger).toBeVisible({ timeout: 25_000 });
    await trigger.focus();
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByTestId("command-palette");
    await expect(dialog).toBeVisible();
    // The audit read `null` here. Assert the attribute, not the role.
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("typing `ord` finds order screens and never Dashboard", async ({ as }) => {
    const page = await as(persona(TENANT, "owner"));
    await page.goto("/app/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).click();

    await page.getByTestId("command-palette-input").fill("ord");
    await expect(page.getByTestId("command-palette-item-page.purchasing.purchase-orders")).toBeVisible();
    // The measured defect: a subsequence matcher returns Dashboard for `ord`.
    await expect(page.getByTestId("command-palette-item-page.dashboard")).toHaveCount(0);
  });

  test("a seeded order is findable by its number and opens its bill", async ({ as }) => {
    const page = await as(persona(TENANT, "manager"));
    await page.goto("/app/pos");

    // Read a real order number off Order Management rather than hard-coding one: order numbers
    // carry the seed date, so a literal here would rot the day after it was written.
    await page.getByRole("tab", { name: "Order Management" }).click();
    const firstOrderNo = await page.locator("text=/ORD-\\d{8}-\\d{4}/").first().innerText();

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-palette-input").fill(firstOrderNo);

    const group = page.getByTestId("command-palette-list");
    await expect(group.getByText("Orders", { exact: true })).toBeVisible();
    const row = group.locator('[data-testid^="command-palette-order-"]').first();
    await expect(row).toContainText(firstOrderNo);

    await row.click();
    await expect(page).toHaveURL(/\/app\/pos\/orders\/[0-9a-f-]+\/receipt$/);
  });

  test("results are grouped under labelled categories", async ({ as }) => {
    const page = await as(persona(TENANT, "owner"));
    await page.goto("/app/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).click();

    const headings = page.getByTestId("command-palette-list").locator("[cmdk-group-heading]");
    await expect(headings.filter({ hasText: "Quick actions" })).toHaveCount(1);
    await expect(headings.filter({ hasText: "Pages" })).toHaveCount(1);
    await expect(headings.filter({ hasText: "Settings" })).toHaveCount(1);
  });

  test("recents survive a reload, capped at five", async ({ as }) => {
    const page = await as(persona(TENANT, "owner"));
    await page.goto("/app/dashboard");

    for (const id of [
      "page.finance.gl",
      "page.inventory.stock",
      "page.reports",
      "page.hr.employees",
      "page.crm",
      "page.nlq",
    ]) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByTestId("command-palette-input").fill("");
      await page.getByTestId(`command-palette-item-${id}`).click();
      await page.waitForLoadState("networkidle");
    }

    await page.reload();
    await page.keyboard.press("ControlOrMeta+k");
    const recentHeading = page.getByTestId("command-palette-list").getByText(/^Recent/);
    await expect(recentHeading).toBeVisible();

    const recentRows = page
      .getByTestId("command-palette-list")
      .locator("[cmdk-group]")
      .first()
      .locator("[cmdk-item]");
    await expect(recentRows).toHaveCount(5);
    // Most recent first, and the sixth-oldest has fallen off.
    await expect(recentRows.first()).toContainText("Ask (NLQ)");
    await expect(recentRows.filter({ hasText: "General Ledger" })).toHaveCount(0);
  });

  test("a cashier's palette offers no finance route", async ({ as }) => {
    const page = await as(persona(TENANT, "cashier"));
    await page.goto("/app/dashboard");
    await page.keyboard.press("ControlOrMeta+k");

    await expect(page.getByTestId("command-palette-item-page.pos")).toBeVisible();
    await expect(page.getByTestId("command-palette-item-page.finance.gl")).toHaveCount(0);
    await expect(page.getByTestId("command-palette-item-settings.users")).toHaveCount(0);
  });

  test("the empty state names the query and the categories searched", async ({ as }) => {
    const page = await as(persona(TENANT, "cashier"));
    await page.goto("/app/dashboard");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-palette-input").fill("zzzzqq");

    await expect(page.getByText('Nothing matches "zzzzqq".')).toBeVisible();
    await expect(page.getByText(/^Searched /)).toContainText("Pages");
  });
});
