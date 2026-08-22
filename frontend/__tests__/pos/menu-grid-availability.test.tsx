import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MenuGrid } from "@/components/pos/menu-grid";
import { menuItemAvailability, setHasAvailabilitySignal } from "@/components/pos/menu-availability";

/**
 * 38-04 task 3 — the product card's availability channel (UI-SPEC §9.2).
 *
 * <p>`menu-grid.tsx` had no availability channel at all before this: `grep -n 'avail'` returned
 * nothing. The channel added is deliberately NOT the demo's three-state stock dot — two of those
 * three states have no source in this system (see `menu-availability.ts`) — so what is asserted
 * here is the one state that is real, plus the fact that a set with nothing to report spends no
 * pixels reporting it.
 */

const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";

const rawCategories = [
  { id: CATEGORY_ID, name: "Mains", description: null, sortOrder: 1, active: true },
];

const SELLABLE = {
  id: "a1000001-0000-4000-8000-000000000001",
  categoryId: CATEGORY_ID,
  name: "Cheeseburger",
  description: null,
  basePricePaisa: 45000,
  taxRatePct: "5",
  kdsStation: "GRILL",
  active: true,
};

const PULLED = {
  id: "a1000001-0000-4000-8000-000000000002",
  categoryId: CATEGORY_ID,
  name: "Seasonal Mango Lassi",
  description: null,
  basePricePaisa: 35000,
  taxRatePct: "5",
  kdsStation: "DRINKS",
  active: false,
};

function renderGrid(items: unknown[]) {
  seedSession({ branchId: "branch-1" });
  server.use(
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({ data: items, meta: null, warnings: [] }),
    ),
  );
  const Wrapper = createQueryWrapper();
  const onItemSelect = vi.fn();
  render(
    <Wrapper>
      <MenuGrid onItemSelect={onItemSelect} cart={[]} onRemove={vi.fn()} onClearCart={vi.fn()} />
    </Wrapper>,
  );
  return { onItemSelect };
}

describe("menuItemAvailability", () => {
  it("reports the one availability fact this system actually holds", () => {
    expect(menuItemAvailability({ active: true })).toBe("available");
    expect(menuItemAvailability({ active: false })).toBe("unavailable");
  });

  it("says a set has nothing to report when everything in it is sellable", () => {
    expect(setHasAvailabilitySignal([{ active: true }, { active: true }])).toBe(false);
    expect(setHasAvailabilitySignal([{ active: true }, { active: false }])).toBe(true);
  });
});

describe("MenuGrid availability channel", () => {
  afterEach(() => clearSession());

  it("spends no pixels on availability when every visible dish is sellable", async () => {
    renderGrid([SELLABLE]);
    await waitFor(() => expect(screen.getByText("Cheeseburger")).toBeInTheDocument());
    // The channel exists; it is simply silent. A row reading "Available" on all 44 tiles is not
    // information, it is furniture — and it is a third of a touchscreen.
    expect(screen.queryByTestId(`menu-item-availability-${SELLABLE.id}`)).not.toBeInTheDocument();
  });

  it("renders a pulled dish as unavailable rather than deleting it from the grid", async () => {
    renderGrid([SELLABLE, PULLED]);
    await waitFor(() => expect(screen.getByText("Seasonal Mango Lassi")).toBeInTheDocument());

    // Icon + literal words, not hue alone (§4.2 / D-38-13).
    const chip = screen.getByTestId(`menu-item-availability-${PULLED.id}`);
    expect(chip).toHaveTextContent("Unavailable");

    // Once a set carries a signal, EVERY tile carries the row — a ragged grid is one a thumb
    // misses, which is the same argument the photo slot is decided on.
    expect(screen.getByTestId(`menu-item-availability-${SELLABLE.id}`)).toHaveTextContent(
      "Available",
    );
  });

  it("refuses to ring an unavailable dish — the tile is disabled, not merely greyed", async () => {
    const { onItemSelect } = renderGrid([SELLABLE, PULLED]);
    await waitFor(() => expect(screen.getByText("Seasonal Mango Lassi")).toBeInTheDocument());

    const tile = screen.getByText("Seasonal Mango Lassi").closest("button");
    expect(tile).toBeDisabled();

    const user = userEvent.setup();
    await user.click(tile!);
    // Nothing reached the cart. A dish that is off the card must not be sellable by a tap that
    // merely looks discouraged.
    expect(onItemSelect).not.toHaveBeenCalled();

    // …and the sellable one still rings, so "disabled" has not leaked across the grid.
    await user.click(screen.getByText("Cheeseburger").closest("button")!);
    expect(onItemSelect).toHaveBeenCalledTimes(1);
  });
});
