import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { dropEmptyColumns, isEmpty, isUuid } from "@/components/ui/data-grid/columns";

/**
 * `DataGrid` — the contract from UI-SPEC §7.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored (D-38-07)</h3>
 *
 * 1. Removed `sticky top-0` from `<thead>` → "sticky header" red ("expected class list to
 *    contain sticky"). Restored.
 * 2. Gave the two densities the same class (`comfortable` → `h-8`) → "one row height, and it is
 *    the density's" red. Restored.
 * 3. Deleted the `hidden md:block` wrapper so the table renders at every width → "renders cards,
 *    not a table, below md" red (the `<table>` was found in the card branch). Restored.
 * 4. Made the filtered-empty branch reuse the empty copy → "filtered-empty is not the same state
 *    as empty" red. Restored.
 * 5. Removed the `{n} selected` line while keeping the bulk actions → "selection count is always
 *    visible" red. Restored.
 * 6. Changed `dropEmptyColumns` to drop a column when *most* rows are empty rather than all →
 *    "keeps a column that one row populates" red, which is the 83-of-84 purchase-order case.
 */

interface Row {
  id: string;
  name: string;
  category: string | null;
  expected: string | null;
  total: number;
}

const ROWS: Row[] = [
  { id: "1", name: "Chicken", category: "Meat", expected: null, total: 100 },
  { id: "2", name: "Rice", category: "Dry", expected: null, total: 200 },
  { id: "3", name: "Oil", category: null, expected: "2026-08-09", total: 300 },
];

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "category", header: "Category" },
  { accessorKey: "total", header: "Total" },
];

function manyRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    name: `Item ${i}`,
    category: "C",
    expected: null,
    total: i,
  }));
}

describe("DataGrid — structure (UI-SPEC §7.2)", () => {
  it("makes every header CELL sticky — the element the contract measures", () => {
    // Measured across all 12 rendered tables in the audit sweep: sticky headers = 0. On the
    // 84-row purchase-order list, scrolling past row 12 lost every column meaning.
    //
    // Asserted on `th`, not `thead`, and that distinction is the whole point. The first cut put
    // `sticky top-0` on `<thead>`; this test passed, and Chromium then reported
    // `thead th { position: static }` — the exact property UI-SPEC §7.2 and the audit both
    // measure. The rule was in the stylesheet and absent from the measurement. A unit test that
    // asserts on a different element than the contract does is not testing the contract.
    const { container } = render(<DataGrid columns={COLUMNS} data={ROWS} />);
    const ths = Array.from(container.querySelectorAll("thead th"));
    expect(ths.length).toBeGreaterThan(0);
    for (const th of ths) {
      expect(th.className).toContain("sticky");
      expect(th.className).toContain("top-0");
      // A transparent sticky cell lets rows scroll visibly underneath it.
      expect(th.className).toContain("bg-surface-2");
    }
  });

  it("holds cells to one line, which is what actually holds a row to one height", () => {
    // `h-11` on the <tr> is a MINIMUM. Measured on /app/inventory/stock with wrapping cells:
    // 44px and 55px in one body — the defect the density prop is supposed to prevent.
    const { container } = render(<DataGrid columns={COLUMNS} data={ROWS} />);
    for (const td of Array.from(container.querySelectorAll("tbody td"))) {
      expect(td.className).toContain("whitespace-nowrap");
    }
  });

  it.each([
    { density: "compact" as const, cls: "h-8" },
    { density: "comfortable" as const, cls: "h-11" },
  ])("uses ONE row height for $density, and it is $cls", ({ density, cls }) => {
    // The audit measured 65px AND 81px inside a single table body.
    const { container } = render(<DataGrid columns={COLUMNS} data={ROWS} density={density} />);
    const bodyRows = Array.from(container.querySelectorAll("tbody tr"));
    expect(bodyRows.length).toBeGreaterThan(0);
    const heights = new Set(
      bodyRows.map((r) => (r.className.match(/\bh-\d+\b/) ?? ["none"])[0]),
    );
    expect(heights.size, "more than one row height in one table").toBe(1);
    expect([...heights][0]).toBe(cls);
  });

  it("renders a card list, hidden above md, and hides the table below it", () => {
    // Brief §57. At 390px the desktop table was dropped in unchanged — 100 elements past the
    // viewport on /app/inventory/stock, values sliced mid-word ("90 EACI", "-2987 K").
    const { container } = render(
      <DataGrid columns={COLUMNS} data={ROWS} card={{ primary: (r) => r.name }} />,
    );
    const tableWrapper = container.querySelector("table")!.closest("div")!;
    expect(tableWrapper.className).toContain("hidden");
    expect(tableWrapper.className).toContain("md:block");

    const cards = screen.getByTestId("data-grid-cards");
    expect(cards.className).toContain("md:hidden");
    expect(within(cards).getAllByRole("listitem")).toHaveLength(3);
  });

  it("column headers use the Label type role, not an ad-hoc size", () => {
    const { container } = render(<DataGrid columns={COLUMNS} data={ROWS} />);
    for (const th of Array.from(container.querySelectorAll("thead th"))) {
      expect(th.className).toContain("text-label");
    }
  });

  it("associates every header with its column for screen readers", () => {
    const { container } = render(<DataGrid columns={COLUMNS} data={ROWS} />);
    for (const th of Array.from(container.querySelectorAll("thead th"))) {
      expect(th.getAttribute("scope")).toBe("col");
    }
  });
});

describe("DataGrid — pagination (UI-SPEC §7.2)", () => {
  it("pages a long list and reports Page N of M", async () => {
    // /app/purchasing/purchase-orders rendered 84 rows in one ungated list.
    render(<DataGrid columns={COLUMNS} data={manyRows(84)} pageSize={25} />);
    expect(screen.getByText(/Page 1 of 4/)).toBeInTheDocument();
    const { container } = render(<DataGrid columns={COLUMNS} data={manyRows(84)} pageSize={25} />);
    expect(container.querySelectorAll("tbody tr").length).toBeLessThanOrEqual(25);
  });

  it("advances the page — the index is not pinned by controlled state", async () => {
    // Regression: putting `pagination` in `state` without an `onPaginationChange` handler pins
    // pageIndex at 0, so Next re-renders page 1 forever and the pager looks broken but silent.
    const user = userEvent.setup();
    render(<DataGrid columns={COLUMNS} data={manyRows(84)} pageSize={25} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Page 2 of 4/)).toBeInTheDocument();
  });

  it("stays quiet when a single page holds everything", () => {
    render(<DataGrid columns={COLUMNS} data={ROWS} />);
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});

describe("DataGrid — states (UI-SPEC §8.3)", () => {
  it("filtered-empty is NOT the same state as empty", async () => {
    // Showing "no purchase orders yet" to someone who typed a search is the product telling them
    // their business has nothing in it.
    const onClear = vi.fn();
    const { rerender } = render(
      <DataGrid columns={COLUMNS} data={[]} emptyTitle="No ingredients yet" />,
    );
    expect(screen.getByText("No ingredients yet")).toBeInTheDocument();

    rerender(
      <DataGrid
        columns={COLUMNS}
        data={[]}
        emptyTitle="No ingredients yet"
        isFiltered
        onClearFilters={onClear}
      />,
    );
    expect(screen.queryByText("No ingredients yet")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing matches these filters/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe("DataGrid — selection and bulk actions (UI-SPEC §7.4)", () => {
  it("shows the selected count whenever a selection exists", async () => {
    const user = userEvent.setup();
    render(
      <DataGrid
        columns={COLUMNS}
        data={ROWS}
        getRowId={(r) => r.id}
        bulkActions={(sel) => <button type="button">Archive {sel.length}</button>}
      />,
    );
    expect(screen.queryByTestId("data-grid-selected-count")).not.toBeInTheDocument();

    await user.click(screen.getAllByLabelText("Select row")[0]!);
    expect(screen.getByTestId("data-grid-selected-count")).toHaveTextContent("1 selected");
    // Brief §49 / UI-SPEC §7.4: a destructive bulk action names the COUNT, never "Are you sure?".
    expect(screen.getByRole("button", { name: "Archive 1" })).toBeInTheDocument();
  });

  it("renders no checkbox column when no bulk action is offered", () => {
    render(<DataGrid columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} />);
    expect(screen.queryByLabelText("Select row")).not.toBeInTheDocument();
  });
});

describe("column content rules (UI-SPEC §7.2)", () => {
  it("drops a column that is empty on every row", () => {
    const cols: ColumnDef<Row, unknown>[] = [
      { accessorKey: "name", header: "Name" },
      { accessorKey: "expected", header: "Expected date" },
    ];
    const allEmpty = ROWS.map((r) => ({ ...r, expected: null }));
    const kept = dropEmptyColumns(cols, allEmpty, (row, id) => row[id as keyof Row]);
    expect(kept.map((c) => c.header)).toEqual(["Name"]);
  });

  it("KEEPS a column that even one row populates — the 83-of-84 case", () => {
    // Re-measured live: the purchase-order list has one populated `expectedDeliveryDate` out of
    // 84. A threshold rule would hide a value a buyer actually entered.
    const cols: ColumnDef<Row, unknown>[] = [
      { accessorKey: "name", header: "Name" },
      { accessorKey: "expected", header: "Expected date" },
    ];
    const kept = dropEmptyColumns(cols, ROWS, (row, id) => row[id as keyof Row]);
    expect(kept.map((c) => c.header)).toEqual(["Name", "Expected date"]);
  });

  it("treats an em-dash as empty, because screens substitute it for absent values", () => {
    expect(isEmpty("—")).toBe(true);
    expect(isEmpty("")).toBe(true);
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(0)).toBe(false);
  });

  it("recognises a UUID, which is never a human identifier", () => {
    expect(isUuid("ca6ed037-1b2c-4d3e-8f90-1a2b3c4d5e6f")).toBe(true);
    expect(isUuid("PO-20260812-0001")).toBe(false);
  });
});
