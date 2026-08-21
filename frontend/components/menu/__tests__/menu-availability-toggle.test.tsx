import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { toast } from "sonner";
import MenuItemsPage from "@/app/(tenant)/app/menu/items/page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * menu-availability-toggle.test.tsx — plan 38-07 task 6.
 *
 * <p>"Immediate optimistic visual feedback plus a toast; on failure, revert and say why." All
 * three halves are asserted, and the failure case is the one that matters: a toggle that stays
 * flipped after the server refused is a screen telling a manager a dish is off the menu when the
 * till is still selling it.
 */

const CAT_MAINS = "c1000001-0000-4000-8000-000000000001";
const ITEM_ID = "a1000001-0000-4000-8000-000000000001";

const rawCategories = [
  { id: CAT_MAINS, name: "Mains", description: null, sortOrder: 1, active: true },
];
const rawItems = [
  {
    id: ITEM_ID,
    categoryId: CAT_MAINS,
    categoryName: "Mains",
    name: "Chicken Karahi",
    description: null,
    basePricePaisa: 65000,
    taxRatePct: "0",
    kdsStation: null,
    active: true,
  },
];

function renderPage() {
  seedSession({ permissions: ["pos.menu.manage"] });
  server.use(
    http.get("*/api/v1/pos/menu/categories/admin", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items/admin", () =>
      HttpResponse.json({ data: rawItems, meta: null, warnings: [] }),
    ),
  );
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <MenuItemsPage />
    </Wrapper>,
  );
}

describe("Menu availability toggle", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("theTileCarriesAvailabilityAsWordIconAndPressedStateNotColourAlone", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", { name: /^Available$/ });

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent("Available");
    expect(toggle.querySelector("svg")).not.toBeNull();
  });

  it("flipsBeforeTheServerAnswersAndConfirmsWithAToast", async () => {
    renderPage();
    const user = userEvent.setup();

    server.use(
      http.patch(`*/api/v1/pos/menu/items/${ITEM_ID}/deactivate`, async () => {
        // Slow enough that an un-optimistic screen would still read "Available" here.
        await delay(400);
        return HttpResponse.json({
          data: { ...rawItems[0], active: false },
          meta: null,
          warnings: [],
        });
      }),
    );

    const toggle = await screen.findByRole("button", { name: /^Available$/ });
    await user.click(toggle);

    // Immediate, and asserted WITHOUT waitFor on purpose: the point is that the tile has already
    // flipped by the time the click returns, not that it flips eventually.
    expect(screen.getByRole("button", { name: /^Unavailable$/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Deactivated Chicken Karahi"),
    );
  }, 20000);

  it("revertsAndNamesTheReasonWhenTheMenuServiceRefuses", async () => {
    renderPage();
    const user = userEvent.setup();

    server.use(
      http.patch(`*/api/v1/pos/menu/items/${ITEM_ID}/deactivate`, async () => {
        await delay(60);
        return HttpResponse.json(
          {
            error: {
              code: "ITEM_ON_OPEN_ORDER",
              message: "Chicken Karahi is on 3 open orders.",
            },
          },
          { status: 409 },
        );
      }),
    );

    const toggle = await screen.findByRole("button", { name: /^Available$/ });
    await user.click(toggle);

    // Optimistic first…
    expect(screen.getByRole("button", { name: /^Unavailable$/ })).toBeTruthy();

    // …then the revert. If this ever stops reverting, the screen is claiming a dish is off the
    // menu while the till is still selling it.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Available$/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    // And it SAYS WHY — the server's own message, not "something went wrong".
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const calls = (toast.error as unknown as { mock: { calls: string[][] } }).mock.calls;
    const message = calls[0]?.[0] ?? "";
    expect(message).toContain("Chicken Karahi");
    expect(message).toContain("3 open orders");
  }, 20000);
});
