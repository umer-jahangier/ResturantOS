import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataTable, type ColumnDef } from "@/components/ui/data-table";

interface Po {
  code: string;
  status: string;
}

const COLUMNS: ColumnDef<Po, unknown>[] = [
  { accessorKey: "code", header: "Code" },
  { accessorKey: "status", header: "Status" },
];

const DATA: Po[] = [
  { code: "PO-1001", status: "DRAFT" },
  { code: "PO-1002", status: "APPROVED" },
  { code: "PO-1003", status: "DRAFT" },
  { code: "PO-1004", status: "CLOSED" },
  { code: "PO-1005", status: "DRAFT" },
];

function bodyRowCount(): number {
  return within(screen.getByRole("table")).getAllByRole("row").length - 1; // minus header
}

describe("DataTable — UI-SPEC §7.4 row-model wiring", () => {
  it("renders every row and reports the true total when nothing is filtered", () => {
    render(<DataTable columns={COLUMNS} data={DATA} />);
    expect(bodyRowCount()).toBe(5);
    expect(screen.getByTestId("data-grid-count")).toHaveTextContent("5 rows");
  });

  it("applies a column filter — impossible before getFilteredRowModel was registered", () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        columnFilters={[{ id: "status", value: "DRAFT" }]}
      />,
    );

    expect(bodyRowCount()).toBe(3);
    expect(screen.getByText("PO-1001")).toBeInTheDocument();
    expect(screen.queryByText("PO-1002")).not.toBeInTheDocument();
    expect(screen.queryByText("PO-1004")).not.toBeInTheDocument();
  });

  it("counts the FILTERED rows in the footer, not the unfiltered total", () => {
    // The specific regression UI-SPEC §7.4 names: `table.getFilteredRowModel()` was called
    // without the model registered, so TanStack fell back to the core row model and the
    // footer reported 5 of 5 while three rows were on screen. An accountant citing
    // "page 7 of 42" needs this number to be the truth.
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        columnFilters={[{ id: "status", value: "DRAFT" }]}
      />,
    );

    expect(screen.getByTestId("data-grid-count")).toHaveTextContent("3 rows");
    expect(screen.getByTestId("data-grid-count")).not.toHaveTextContent("5 rows");
  });

  it("paginates over the filtered set, not the raw set", () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        pageSize={2}
        columnFilters={[{ id: "status", value: "DRAFT" }]}
      />,
    );

    expect(bodyRowCount()).toBe(2);
    expect(screen.getByTestId("data-grid-count")).toHaveTextContent("Page 1 of 2 · 3 rows");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("gives every column header a scope, so cells are announced with their column", () => {
    // UI-SPEC §9.3 — bare <th> everywhere today.
    render(<DataTable columns={COLUMNS} data={DATA} />);
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });
});
