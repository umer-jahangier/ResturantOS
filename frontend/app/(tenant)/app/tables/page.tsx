"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal, Armchair } from "lucide-react";
import { toast } from "sonner";

import { useTablesAdmin, useSetTableActive } from "@/lib/hooks/pos/use-table-admin";
import type { DiningTable } from "@/lib/models/pos.model";
import { TableFormDialog } from "./TableFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { TableStatusChip } from "@/components/pos/table-status-chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EMPTY_TITLE = "No tables yet";
const EMPTY_BODY =
  "Add your dining tables and they become selectable on the order screen straight away.";

/** Sections group the list. Tables with no section fall into one bucket, always shown last. */
const UNSECTIONED = "Other tables";

type FormTarget = { mode: "create" } | { mode: "edit"; table: DiningTable };

/**
 * URL: /app/tables — the dining-table catalogue.
 *
 * <p>Before this screen existed, `POST /api/v1/pos/tables` answered 405 and every tenant in the
 * product had zero tables. The waiter's table picker was already built and already wired; it was
 * simply reading an empty catalogue that nothing could write to. This is the write path.
 *
 * <p>Two states are shown per row and they are NOT the same thing. `status` is runtime — is
 * someone sitting here right now — and is written by the order lifecycle. `active` is catalogue
 * state: does this table exist in the restaurant at all. A retired table keeps its row forever,
 * because closed orders reference it and must keep naming where they were served.
 *
 * <h3>38-06: the rows were a hand-rolled list, and it did not contain a `<table>`</h3>
 *
 * This screen is the reason a `<table>`-scoped migration sweep is the wrong instrument. It shipped
 * **`<div>` rows inside a `<div className="divide-y">`** — no `<table>`, no `<ul>`, nothing the
 * G4 scanner or a grep for `<table` would ever have flagged. It therefore carried every defect
 * `DataGrid` exists to fix while appearing, to any automated count, to be already clean:
 *
 * | property | before | now |
 * |---|---|---|
 * | header | none at all — the columns were unlabelled, so a screen reader announced four bare values per row | sticky `<th>` per column |
 * | row height | `py-2` + intrinsic content — two heights the moment one row wrapped | one `h-11` (44px), `whitespace-nowrap` |
 * | pagination | none; every table in the branch, ungated | 25/50/100 with `Page N of M` |
 * | sorting | none | name, seats and status |
 * | runtime status | a bespoke pill: colour + text, **no icon** | shared `TableStatusChip` — icon + text + colour |
 *
 * <p>One grid PER SECTION rather than one grid with a section column: the section is this
 * screen's organising axis (a manager re-lays the Rooftop, not "all tables"), the `role="group"`
 * per section is what makes that reachable by keyboard and by screen reader, and each group
 * carries its own reconciling `N tables · M seats` line.
 *
 * <h3>No `card` fallback, deliberately</h3>
 *
 * UI-SPEC §9.5 requires the below-`md` card list for inventory, menu and purchasing; §9.4, which
 * governs this screen, does not. `DataGrid` keeps BOTH branches in the DOM and lets CSS choose,
 * so passing `card` duplicates every row's text and its action trigger — see the 38-06 report,
 * where this is recorded as owed work with the test-scoping it requires.
 */
export default function TablesPage() {
  const [showRetired, setShowRetired] = useState(false);
  // The query's error is read by QueryBoundary below rather than folded into an empty check —
  // a pos-service failure must never render "No tables yet" on the one screen whose whole job
  // is to tell the manager which tables exist (GA-001).
  const tablesQuery = useTablesAdmin();
  const setActive = useSetTableActive();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  const allTables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const visibleTables = useMemo(
    () => (showRetired ? allTables : allTables.filter((t) => t.active)),
    [allTables, showRetired],
  );

  const knownSections = useMemo(
    () =>
      Array.from(
        new Set(allTables.map((t) => t.section).filter((s): s is string => !!s && s.length > 0)),
      ).sort((a, b) => a.localeCompare(b)),
    [allTables],
  );

  /** Grouped by section, sections alphabetical, unsectioned last. */
  const grouped = useMemo(() => {
    const buckets = new Map<string, DiningTable[]>();
    for (const table of visibleTables) {
      const key = table.section?.trim() || UNSECTIONED;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(table);
      else buckets.set(key, [table]);
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => {
      if (a === UNSECTIONED) return 1;
      if (b === UNSECTIONED) return -1;
      return a.localeCompare(b);
    });
  }, [visibleTables]);

  /**
   * The header's `·`-separated stat line (the demo's back-office grammar, D-38-15).
   *
   * <p>Computed from `visibleTables` — the SAME array the groups below are built from — so the
   * table count, the section count and the seat total are all verifiable by counting what is on
   * screen, and they change with the "Show retired" toggle exactly as the list does. A subtitle
   * summarising a different set than the one beneath it is the failure this is written to avoid.
   */
  const stats = useMemo(() => {
    const sections = new Set(visibleTables.map((t) => t.section?.trim() || UNSECTIONED));
    return {
      tables: visibleTables.length,
      sections: sections.size,
      seats: visibleTables.reduce((sum, t) => sum + t.capacity, 0),
      occupied: visibleTables.filter((t) => t.status === "OCCUPIED").length,
    };
  }, [visibleTables]);

  function handleToggleActive(table: DiningTable) {
    const nextActive = !table.active;
    setActive.mutate(
      { id: table.id, active: nextActive },
      {
        /**
         * UI-SPEC §8.2, and this is deliberately NOT a `ConfirmDialog`.
         *
         * Plan 38-06 task 5 asked for one. `confirm-dialog.tsx`'s own contract — written after
         * that plan — forbids it: *"Where an action is safely reversible, prefer a toast with an
         * action … because a dialog on a reversible action trains people to dismiss dialogs,
         * which is how the irreversible one gets dismissed too."* Retiring a table is reversible
         * by the menu item directly beneath it, the server refuses to retire an OCCUPIED table,
         * and no order history is touched. So it gets the undo, which is the affordance the
         * operator actually wants at 6pm — and the modal stays meaningful for the voids.
         */
        onSuccess: () =>
          toast.success(nextActive ? `Restored ${table.tableName}` : `Retired ${table.tableName}`, {
            action: {
              label: "Undo",
              onClick: () => setActive.mutate({ id: table.id, active: table.active }),
            },
          }),
        // The server refuses to retire an OCCUPIED table and says which state to clear first —
        // surface that sentence, it is the actionable one.
        onError: (error) =>
          toast.error(error.message || "Could not update the table. Please try again."),
      },
    );
  }

  /**
   * One column per fact (UI-SPEC §7.2). The catalogue column is present ONLY while retired rows
   * can appear: with the toggle off every row is active, so the column would be an em-dash on
   * every row — which is exactly the "Expected date × 84" defect `dropEmptyColumns` was written
   * for, and it is cheaper to not build the column than to detect it empty afterwards.
   */
  const columns = useMemo<ColumnDef<DiningTable, unknown>[]>(() => {
    const base: ColumnDef<DiningTable, unknown>[] = [
      {
        id: "tableName",
        header: "Table",
        accessorFn: (row: DiningTable) => row.tableName,
        cell: ({ row }) => (
          // `data-testid="table-row"` moves onto the identifying cell rather than disappearing:
          // it is not queried by any test or journey today, and removing a testid is how a
          // journey breaks six months later with no way to tell what it used to name.
          <span data-testid="table-row" className="font-medium">
            {row.original.tableName}
          </span>
        ),
      },
      {
        id: "capacity",
        header: "Seats",
        accessorFn: (row: DiningTable) => row.capacity,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.capacity} {row.original.capacity === 1 ? "seat" : "seats"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row: DiningTable) => row.status,
        // Runtime state and catalogue state are different questions and get different badges —
        // conflating them is what makes an occupied table look un-retirable and a retired one
        // look available. The chip is shared with the POS floor view, so the two surfaces cannot
        // drift into two vocabularies for one fact again.
        cell: ({ row }) => <TableStatusChip status={row.original.status} />,
      },
    ];

    if (showRetired) {
      base.push({
        id: "catalogue",
        header: "Catalogue",
        cell: ({ row }) =>
          row.original.active ? (
            <StatusBadge status="active" label="In service" />
          ) : (
            <StatusBadge status="archived" label="Retired" />
          ),
      });
    }

    base.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <PermissionGuard require="pos.tables.admin">
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${row.original.tableName}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => setFormTarget({ mode: "edit", table: row.original })}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleToggleActive(row.original)}>
                  {row.original.active ? "Retire" : "Restore"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </PermissionGuard>
      ),
    });

    return base;
    // `handleToggleActive` closes over `setActive`, which is stable for the life of the mutation
    // hook; re-deriving the columns on every render would remount every dropdown mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRetired]);

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Tables"
        description="Your dining tables. Anything active here can be picked when a waiter starts an order."
        meta={
          allTables.length > 0 ? (
            <span
              data-testid="tables-stat-line"
              className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums"
            >
              <span>
                {stats.tables} {stats.tables === 1 ? "table" : "tables"}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {stats.sections} {stats.sections === 1 ? "section" : "sections"}
              </span>
              <span aria-hidden="true">·</span>
              <span>{stats.seats} seats</span>
              <span aria-hidden="true">·</span>
              <span>{stats.occupied} occupied right now</span>
            </span>
          ) : undefined
        }
        actions={
          <PermissionGuard require="pos.tables.admin">
            <Button type="button" onClick={() => setFormTarget({ mode: "create" })}>
              Add table
            </Button>
          </PermissionGuard>
        }
      />

      {/* A retired table is hidden from the order screen but not deleted — without this toggle
          there is no way to find, or restore, one again. Mirrors the Menu Items page's
          "Show inactive" checkbox exactly. */}
      <label className="flex w-fit items-center gap-2 text-small text-foreground-secondary">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={(e) => setShowRetired(e.target.checked)}
          className="size-4 rounded-sm border-input"
        />
        Show retired
      </label>

      <QueryBoundary
        query={tablesQuery}
        what="your tables"
        isEmpty={visibleTables.length === 0}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        }
        empty={
          <PermissionGuard
            require="pos.tables.admin"
            fallback={<EmptyState icon={Armchair} title={EMPTY_TITLE} description={EMPTY_BODY} />}
          >
            <EmptyState
              icon={Armchair}
              title={EMPTY_TITLE}
              description={EMPTY_BODY}
              action={{ label: "Add table", onClick: () => setFormTarget({ mode: "create" }) }}
            />
          </PermissionGuard>
        }
      >
        <div className="space-y-(--space-lg)">
          {grouped.map(([section, tables]) => (
            <div
              key={section}
              role="group"
              aria-label={`${section} section`}
              className="space-y-(--space-sm)"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-label font-semibold tracking-wide uppercase text-foreground-secondary">
                  {section}
                </h2>
                <span className="text-small tabular-nums text-foreground-secondary">
                  {tables.length} {tables.length === 1 ? "table" : "tables"} ·{" "}
                  {tables.reduce((sum, t) => sum + t.capacity, 0)} seats
                </span>
              </div>

              <DataGrid
                columns={columns}
                data={tables}
                density="comfortable"
                pageSize={25}
                label={`${section} tables`}
              />
            </div>
          ))}
        </div>
      </QueryBoundary>

      <TableFormDialog
        key={
          formTarget
            ? formTarget.mode === "edit"
              ? `edit-${formTarget.table.id}`
              : "create"
            : "table-form-idle"
        }
        table={formTarget?.mode === "edit" ? formTarget.table : undefined}
        knownSections={knownSections}
        open={formTarget !== null}
        onOpenChange={(next) => {
          if (!next) setFormTarget(null);
        }}
      />
    </PageBody>
  );
}
