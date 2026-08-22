import { expect, test } from "../fixtures/auth.fixture";
import { persona } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

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
    await expect(
      page.getByTestId("command-palette-item-page.purchasing.purchase-orders"),
    ).toBeVisible();
    // The measured defect: a subsequence matcher returns Dashboard for `ord`.
    await expect(page.getByTestId("command-palette-item-page.dashboard")).toHaveCount(0);
  });

  test("a seeded order is findable by its number and opens its bill", async ({ as, obs }) => {
    test.setTimeout(90_000);
    // E2E-D4: the POS live-orders socket is refused and reconnects in a loop, one console error
    // per attempt. Pinned in known-defects.spec.ts and tolerated in these same words by every
    // other spec that opens /app/pos. What this test is about is the palette finding an order.
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);

    const page = await as(persona(TENANT, "manager"));
    // `domcontentloaded`: /app/pos registers a service worker and holds a live socket, and
    // `prepareForPos`'s docblock records a 90-second hang from waiting on `load` here.
    await page.goto("/app/pos", { waitUntil: "domcontentloaded" });

    /*
     * `button`, NOT `tab`.
     *
     * <p>The POS view switcher is three plain `<button>`s: `app/(tenant)/app/pos/page.tsx:129-142`
     * renders them in a `<div>` with no `role="tablist"`, no `role="tab"` and no `aria-selected`
     * — the word "tabs" appears only in the comment above them. So `getByRole("tab", …)` could
     * never resolve, and this test spent its entire 30s timeout waiting for an element that has
     * never existed on the route. `operational-zone-containment.spec.ts:216` reaches the same
     * strip with `getByRole("button", { name: "POS Terminal", exact: true })` and passes.
     *
     * <p>Whether that strip OUGHT to carry ARIA tab semantics is a real question, and it is not
     * this test's to settle: a segmented group of buttons is a legitimate pattern, the visible
     * labels are correct either way, and rewriting the product's roles to satisfy a locator
     * would be the tail wagging the dog. Flagged for the accessibility review; the locator now
     * matches what ships.
     */
    // Read a real order number off Order Management rather than hard-coding one: order numbers
    // carry the seed date, so a literal here would rot the day after it was written.
    await page.getByRole("button", { name: "Order Management", exact: true }).click();
    const firstOrderNo = await page.locator("text=/ORD-\\d{8}-\\d{4}/").first().innerText();

    /*
     * BACK TO THE BACK-OFFICE SHELL BEFORE PRESSING ⌘K. There is no palette on /app/pos.
     *
     * <p>`app/(tenant)/layout.tsx:112-146` returns a different tree for an operator route with no
     * `<TopBar>` in it, and `TopBar` is the only thing that mounts `CommandPalette`
     * (`top-bar.tsx:540`) — UI-SPEC §4.1 calls the removal deliberate. So the chord landed on a
     * route with no listener and `command-palette-input` never attached; the test then spent its
     * whole timeout waiting for it. Nothing about the palette was being measured.
     *
     * <p>The order number still has to come from the POS screen, because a literal would carry
     * the seed date and rot the next day — so the read stays there and only the SEARCH moves to
     * a route that has a palette. That is the real journey anyway: a manager who was handed an
     * order number looks it up from wherever they happen to be in the back office.
     */
    await page.goto("/app/dashboard");
    await expect(
      page.getByRole("button", { name: "Open command palette" }),
      "the palette trigger is missing from the back-office shell, so ⌘K has nothing to open",
    ).toBeVisible({ timeout: 30_000 });

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
