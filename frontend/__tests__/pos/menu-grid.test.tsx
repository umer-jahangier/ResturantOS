import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MenuGrid } from "@/components/pos/menu-grid";

const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";

const rawCategories = [
  { id: CATEGORY_ID, name: "Mains", description: null, sortOrder: 1, active: true },
];

const rawItems = [
  {
    id: "a1000001-0000-4000-8000-000000000001",
    categoryId: CATEGORY_ID,
    name: "Cheeseburger",
    description: null,
    basePricePaisa: 45000,
    taxRatePct: "5",
    kdsStation: "GRILL",
    active: true,
  },
  {
    id: "a1000001-0000-4000-8000-000000000002",
    categoryId: CATEGORY_ID,
    name: "Chicken Wings",
    description: null,
    basePricePaisa: 35000,
    taxRatePct: "5",
    kdsStation: "FRYER",
    active: true,
  },
  {
    id: "a1000001-0000-4000-8000-000000000003",
    categoryId: CATEGORY_ID,
    name: "Iced Tea",
    description: null,
    basePricePaisa: 15000,
    taxRatePct: "5",
    kdsStation: "DRINKS",
    active: true,
  },
];

function mockMenuEndpoints() {
  server.use(
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({ data: rawItems, meta: null, warnings: [] }),
    ),
  );
}

function renderGrid() {
  seedSession({ branchId: "branch-1" });
  mockMenuEndpoints();
  const Wrapper = createQueryWrapper();
  const onItemSelect = vi.fn();
  render(
    <Wrapper>
      <MenuGrid onItemSelect={onItemSelect} />
    </Wrapper>,
  );
  return { onItemSelect };
}

describe("MenuGrid search", () => {
  afterEach(() => clearSession());

  it("filters the grid to matching items as the user types (debounced)", async () => {
    renderGrid();
    const user = userEvent.setup();

    await screen.findByText("Cheeseburger");
    expect(screen.getByText("Chicken Wings")).toBeInTheDocument();
    expect(screen.getByText("Iced Tea")).toBeInTheDocument();

    const searchInput = screen.getByLabelText("Search menu");
    await user.type(searchInput, "chick");

    await waitFor(() => {
      expect(screen.queryByText("Cheeseburger")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Chicken Wings")).toBeInTheDocument();
    expect(screen.queryByText("Iced Tea")).not.toBeInTheDocument();
  });

  it("clearing the search restores the full item list", async () => {
    renderGrid();
    const user = userEvent.setup();

    await screen.findByText("Cheeseburger");

    const searchInput = screen.getByLabelText("Search menu");
    await user.type(searchInput, "iced");

    await waitFor(() => {
      expect(screen.queryByText("Cheeseburger")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Iced Tea")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Clear search"));

    await waitFor(() => {
      expect(screen.getByText("Cheeseburger")).toBeInTheDocument();
    });
    expect(screen.getByText("Chicken Wings")).toBeInTheDocument();
    expect(screen.getByText("Iced Tea")).toBeInTheDocument();
  });

  it("shows a search-specific empty state when no item matches", async () => {
    renderGrid();
    const user = userEvent.setup();

    await screen.findByText("Cheeseburger");

    const searchInput = screen.getByLabelText("Search menu");
    await user.type(searchInput, "nonexistent-item-xyz");

    await waitFor(() => {
      expect(screen.getByText("No items match your search")).toBeInTheDocument();
    });
  });
});
