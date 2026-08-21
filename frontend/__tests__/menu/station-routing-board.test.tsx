import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StationRoutingBoard } from "@/components/menu/station-routing-board";
import type { CategoryRoute, ItemRoute } from "@/lib/models/menu-routing.model";
import type { Station } from "@/lib/models/pos.model";

/*
 * The station-routing board says three things, and each of them is a thing the product got wrong
 * before this screen existed (register S1 #10).
 *
 *   1. WHERE a dish fires — including "DEFAULT", which is a destination and not a blank.
 *   2. WHICH RULE sent it there, so an inherited route and a per-item exception do not look alike.
 *   3. What a control will actually DO. The "follow the category" option is the one place this
 *      screen can lie: pos-service leaves the pre-28-05 columns in place when an item route is
 *      cleared, so an item that once had a route does NOT return to its category. A control
 *      reading "Follow category — BAR" over a dish whose tickets go to the grill is this
 *      codebase's signature defect — structurally present, behaviourally absent — rebuilt by hand.
 */

const BAR: Station = {
  id: "11111111-1111-4111-8111-111111111111",
  branchId: "b0000000-0000-4000-8000-000000000001",
  code: "BAR",
  name: "Main bar",
  active: true,
  stationType: "BAR",
  displayFamily: "BAR",
};
const GRILL: Station = {
  ...BAR,
  id: "22222222-2222-4222-8222-222222222222",
  code: "GRILL",
  name: "Hot line",
  stationType: "KITCHEN",
  displayFamily: "KITCHEN",
};

const drinks: CategoryRoute = {
  categoryId: "c0000000-0000-4000-8000-000000000001",
  categoryName: "Drinks",
  sortOrder: 1,
  active: true,
  stationId: BAR.id,
  stationCode: "BAR",
  stationName: "Main bar",
};

function item(overrides: Partial<ItemRoute>): ItemRoute {
  return {
    itemId: "i0000000-0000-4000-8000-000000000001",
    itemName: "Fresh Lime",
    categoryId: drinks.categoryId,
    categoryName: "Drinks",
    active: true,
    stationId: null,
    effectiveStationId: BAR.id,
    effectiveStationCode: "BAR",
    effectiveStationName: "Main bar",
    source: "CATEGORY",
    ...overrides,
  };
}

/*
 * Take the handler signatures FROM the component rather than restating them. `ReturnType<typeof
 * vi.fn>` was the bug: on a generic function TypeScript resolves to the constraint, not the
 * default, so it means `Mock<Procedure | Constructable>` — and a Constructable has no plain call
 * signature, so it matches neither prop. Restating the signatures by hand would typecheck but
 * would silently stop tracking the component the day a third argument is added.
 */
type BoardProps = ComponentProps<typeof StationRoutingBoard>;

function renderBoard(
  items: ItemRoute[],
  handlers: Partial<{
    onRouteCategory: Mock<BoardProps["onRouteCategory"]>;
    onRouteItem: Mock<BoardProps["onRouteItem"]>;
  }> = {},
) {
  const onRouteCategory = handlers.onRouteCategory ?? vi.fn<BoardProps["onRouteCategory"]>();
  const onRouteItem = handlers.onRouteItem ?? vi.fn<BoardProps["onRouteItem"]>();
  render(
    <StationRoutingBoard
      categories={[drinks]}
      items={items}
      stations={[BAR, GRILL]}
      pendingCategoryIds={new Set()}
      pendingItemIds={new Set()}
      onRouteCategory={onRouteCategory}
      onRouteItem={onRouteItem}
      canManage
    />,
  );
  return { onRouteCategory, onRouteItem };
}

function row(name: string) {
  return document.querySelector(
    `[data-testid="routing-item"][data-item-name="${name}"]`,
  ) as HTMLElement;
}

describe("StationRoutingBoard", () => {
  it("shows the category's own route, read back from the server", () => {
    renderBoard([item({})]);
    const select = screen.getByLabelText("Station for the Drinks category") as HTMLSelectElement;
    expect(select.value).toBe(BAR.id);
    expect(select.selectedOptions[0]?.textContent).toMatch(/Main bar \(BAR\)/);
  });

  it("labels an inherited route as inherited, not as a per-item choice", () => {
    renderBoard([item({})]);
    const lime = row("Fresh Lime");
    expect(within(lime).getByTestId("routing-item-destination").textContent).toMatch(
      /Fires to\s*BAR\s*· From the category/,
    );
    const select = within(lime).getByLabelText("Station for Fresh Lime") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.textContent).toBe("Follow category — Main bar (BAR)");
  });

  it("labels an item's own route as the item's own", () => {
    renderBoard([
      item({
        itemName: "Pinacolada",
        itemId: "i0000000-0000-4000-8000-000000000002",
        stationId: GRILL.id,
        effectiveStationId: GRILL.id,
        effectiveStationCode: "GRILL",
        effectiveStationName: "Hot line",
        source: "ITEM",
      }),
    ]);
    const pina = row("Pinacolada");
    expect(within(pina).getByTestId("routing-item-destination").textContent).toMatch(
      /Fires to\s*GRILL\s*· Set for this item/,
    );
    expect((within(pina).getByLabelText("Station for Pinacolada") as HTMLSelectElement).value).toBe(
      GRILL.id,
    );
  });

  it("renders an unrouted item as DEFAULT rather than as a blank cell", () => {
    renderBoard([
      item({
        stationId: null,
        effectiveStationId: null,
        effectiveStationCode: null,
        effectiveStationName: null,
        source: "NONE",
      }),
    ]);
    expect(within(row("Fresh Lime")).getByTestId("routing-item-destination").textContent).toMatch(
      /Fires to\s*DEFAULT\s*· Not routed/,
    );
  });

  /*
   * THE ONE THAT MATTERS. An item stranded on the pre-28-05 columns has no route of its own and
   * does not follow its category — it fires somewhere else entirely. The control must not claim
   * otherwise. This test fails the moment the option label goes back to being derived from the
   * category alone.
   */
  it("never offers “Follow category — BAR” to an item that a legacy setting sends elsewhere", () => {
    renderBoard([
      item({
        stationId: null,
        effectiveStationId: GRILL.id,
        effectiveStationCode: "GRILL",
        effectiveStationName: "Hot line",
        source: "LEGACY",
      }),
    ]);
    const lime = row("Fresh Lime");
    const select = within(lime).getByLabelText("Station for Fresh Lime") as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).not.toMatch(/Follow category — Main bar/);
    expect(select.selectedOptions[0]?.textContent).toBe(
      "No station of its own — an older setting sends it to GRILL",
    );
    expect(within(lime).getByTestId("routing-item-destination").textContent).toMatch(
      /Fires to\s*GRILL\s*· From older settings/,
    );
  });

  it("routes a category, and clears it with null rather than with a sentinel string", async () => {
    const user = userEvent.setup();
    const { onRouteCategory } = renderBoard([item({})]);
    const select = screen.getByLabelText("Station for the Drinks category");

    await user.selectOptions(select, GRILL.id);
    expect(onRouteCategory).toHaveBeenCalledWith(drinks, GRILL.id);

    await user.selectOptions(select, "");
    expect(onRouteCategory).toHaveBeenLastCalledWith(drinks, null);
  });

  it("routes a single item, and 'follow the category' sends null", async () => {
    const user = userEvent.setup();
    const lime = item({});
    const { onRouteItem } = renderBoard([lime]);
    const select = within(row("Fresh Lime")).getByLabelText("Station for Fresh Lime");

    await user.selectOptions(select, GRILL.id);
    expect(onRouteItem).toHaveBeenCalledWith(lime, GRILL.id);

    await user.selectOptions(select, "");
    expect(onRouteItem).toHaveBeenLastCalledWith(lime, null);
  });

  it("disables every control for a persona that may look but not write", () => {
    render(
      <StationRoutingBoard
        categories={[drinks]}
        items={[item({})]}
        stations={[BAR, GRILL]}
        pendingCategoryIds={new Set()}
        pendingItemIds={new Set()}
        onRouteCategory={vi.fn()}
        onRouteItem={vi.fn()}
        canManage={false}
      />,
    );
    expect(screen.getByLabelText("Station for the Drinks category")).toBeDisabled();
    expect(screen.getByLabelText("Station for Fresh Lime")).toBeDisabled();
  });

  it("says 'Saving…' on the row being written and nowhere else", () => {
    render(
      <StationRoutingBoard
        categories={[drinks]}
        items={[item({})]}
        stations={[BAR, GRILL]}
        pendingCategoryIds={new Set([drinks.categoryId])}
        pendingItemIds={new Set()}
        onRouteCategory={vi.fn()}
        onRouteItem={vi.fn()}
        canManage
      />,
    );
    expect(screen.getByTestId("category-station-status").textContent).toBe("Saving…");
    expect(screen.getByTestId("item-station-status").textContent).toBe("");
  });
});
