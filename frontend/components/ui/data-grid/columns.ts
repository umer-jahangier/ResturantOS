import type { ColumnDef } from "@tanstack/react-table";

/**
 * The two content rules `DataGrid` enforces (UI-SPEC §7.2, plan 38-02 task 3).
 *
 * These are here rather than inside the component because they are decisions about DATA, and a
 * caller needs to make them before handing columns over — and because a rule with its own unit
 * test is a rule that stays true.
 */

/**
 * Drops any column whose every row is empty.
 *
 * <h3>The measurement</h3>
 *
 * `/app/purchasing/purchase-orders` renders an **"Expected date" column that is an em-dash on
 * 83 of its 84 rows** (the audit said all 84; re-measured live, exactly one row carries
 * `2026-08-09`). A column that earns nothing still costs horizontal space on every screen and a
 * cell in every screen-reader row announcement.
 *
 * <h3>Why "every row" and not "most rows"</h3>
 *
 * A threshold would be a judgment the component is not entitled to make: one populated row means
 * the field is real, in use, and about to be populated on others. Hiding it would hide data the
 * user entered. So the rule is absolute — a column disappears only when it holds nothing at all —
 * and the 83-of-84 case stays visible and stays a finding for the backend, not a thing the UI
 * quietly papers over.
 *
 * <p>Empty means `null`, `undefined`, `""` or `"—"`. The em-dash is included because screens
 * already substitute it for absent values, so a column can be "full" of nothing.
 */
export function dropEmptyColumns<TData>(
  columns: ColumnDef<TData, unknown>[],
  data: TData[],
  /** Reads the raw value a column shows, by column id. Only needed for columns worth dropping. */
  valueOf: (row: TData, columnId: string) => unknown,
): ColumnDef<TData, unknown>[] {
  if (data.length === 0) return columns;
  return columns.filter((column) => {
    const id = columnId(column);
    if (!id) return true;
    return data.some((row) => !isEmpty(valueOf(row, id)));
  });
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === "" || text === "—" || text === "-";
}

function columnId<TData>(column: ColumnDef<TData, unknown>): string | undefined {
  if ("id" in column && typeof column.id === "string") return column.id;
  if ("accessorKey" in column && typeof column.accessorKey === "string") return column.accessorKey;
  return undefined;
}

/**
 * A UUID, which is never a human identifier (UI-SPEC §7.2).
 *
 * <p>The purchase-order list rendered `ca6ed037…`, `9958faba…`, `d43693ce…` under a heading
 * reading "PO number" — a purchase-order list in which no purchase order can be identified.
 * Measured against the live gateway, the endpoint has **no PO-number field at all**: its keys are
 * `branchId closeReason closedAt expectedDeliveryDate id lines notes requesterId requiredTiers
 * status submittedAt tiersApproved totalPaisa vendorId`. There is nothing human to render, so the
 * honest fix is to stop *claiming* to render one — the column is labelled "Reference" and the
 * shortfall is recorded in the audit as backend work, not disguised with better typography.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
