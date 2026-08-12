import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MenuGrid } from "@/components/pos/menu-grid";

/**
 * S1-09 — what the till says when pos-service is not running.
 *
 * <h3>The behaviour this pins, and what it looked like before</h3>
 *
 * Driven live in Chromium on 2026-08-12 with pos-service stopped: `/app/pos` issued four requests
 * that all came back `503 {"error":{"code":"SERVICE_UNAVAILABLE"}}` — `/pos/tills`, `/pos/tables`,
 * `/pos/menu/categories`, `/pos/menu/items` — and the page rendered "Your till is closed. Open your
 * till from the bar above… Orders can't be created without an open drawer." with
 * `[role="alert"]` count **zero**.
 *
 * <p>`MenuGrid` was the second half of it. Its two reads were destructured
 * `{ data: items = [], isLoading }` — `isError` never taken — so a rejected query became a
 * zero-length array one line later and the grid printed "No items available". Both sentences are
 * confident, both are wrong, and both send the reader somewhere useless.
 *
 * <h3>Why the negative assertions carry the weight</h3>
 *
 * Asserting only that an alert appears would pass on a page that shows the alert AND still says
 * the menu is empty — which is the same lie with a banner over it. The three
 * `not.toBeInTheDocument()` assertions are what make this a test of the DEFECT rather than of the
 * remedy.
 */

const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";

function serviceUnavailable() {
  return HttpResponse.json(
    {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable. Please try again later.",
      },
    },
    { status: 503 },
  );
}

function renderGridWith(handlers: Parameters<typeof server.use>) {
  seedSession({ branchId: "branch-1" });
  server.use(...handlers);
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <MenuGrid onItemSelect={() => {}} cart={[]} onRemove={() => {}} onClearCart={() => {}} />
    </Wrapper>,
  );
}

afterEach(() => {
  clearSession();
});

describe("POS terminal when pos-service is unavailable", () => {
  it("shows a service-outage alert instead of an empty menu", async () => {
    renderGridWith([
      http.get("*/api/v1/pos/menu/categories", () => serviceUnavailable()),
      http.get("*/api/v1/pos/menu/items", () => serviceUnavailable()),
    ]);

    const alert = await screen.findByTestId("query-service-outage");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("role", "alert");

    // Names what is unavailable, in the reader's words — not a status line and not a module id.
    expect(alert).toHaveTextContent(/the menu is unavailable right now/i);
    // Says what still works. This is the sentence that decides whether the cashier turns the
    // queue away or walks to the pass.
    expect(alert).toHaveTextContent(/kitchen display keeps working/i);
    // And offers the retry, which for a 503 — unlike a 403 — is genuinely the remedy.
    expect(screen.getByTestId("query-error-retry")).toBeInTheDocument();

    // The defect itself: none of these may be on screen at the same time.
    expect(screen.queryByText(/no items available/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no items match your search/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("menu-item-count")).not.toBeInTheDocument();
  });

  it("still says the menu is empty when the service answers with an empty menu", async () => {
    // The positive control. Without it, a MenuGrid that rendered the outage alert unconditionally
    // would pass the test above — which is exactly the class of gate this repository keeps
    // discovering was never able to fail.
    renderGridWith([
      http.get("*/api/v1/pos/menu/categories", () =>
        HttpResponse.json({
          data: [{ id: CATEGORY_ID, name: "Mains", description: null, sortOrder: 1, active: true }],
          meta: null,
          warnings: [],
        }),
      ),
      http.get("*/api/v1/pos/menu/items", () =>
        HttpResponse.json({ data: [], meta: null, warnings: [] }),
      ),
    ]);

    expect(await screen.findByText(/no items available/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("query-service-outage")).not.toBeInTheDocument(),
    );
  });
});
