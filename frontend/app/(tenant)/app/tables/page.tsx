"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal, Armchair } from "lucide-react";
import { toast } from "sonner";

import { useTablesAdmin, useSetTableActive } from "@/lib/hooks/pos/use-table-admin";
import type { DiningTable } from "@/lib/models/pos.model";
import { TableFormDialog } from "./TableFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
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

const RUNTIME_STATUS_LABEL: Record<DiningTable["status"], string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  NEEDS_BUSSING: "Needs bussing",
};

const RUNTIME_STATUS_CLASS: Record<DiningTable["status"], string> = {
  AVAILABLE: "bg-success/15 text-success border-success/30",
  OCCUPIED: "bg-info/15 text-info border-info/30",
  NEEDS_BUSSING: "bg-warning/15 text-warning border-warning/30",
};

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

  function handleToggleActive(table: DiningTable) {
    setActive.mutate(
      { id: table.id, active: !table.active },
      {
        onSuccess: () =>
          toast.success(
            table.active ? `Retired ${table.tableName}` : `Restored ${table.tableName}`,
          ),
        // The server refuses to retire an OCCUPIED table and says which state to clear first —
        // surface that sentence, it is the actionable one.
        onError: (error) =>
          toast.error(error.message || "Could not update the table. Please try again."),
      },
    );
  }

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Tables"
        description="Your dining tables. Anything active here can be picked when a waiter starts an order."
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
      <label className="flex w-fit items-center gap-2 text-small text-muted-foreground">
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
        <div className="space-y-6">
          {grouped.map(([section, tables]) => (
            <div
              key={section}
              role="group"
              aria-label={`${section} section`}
              className="rounded-lg border"
            >
              <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                <span className="font-medium">{section}</span>
                <span className="text-small text-muted-foreground">
                  {tables.length} {tables.length === 1 ? "table" : "tables"} ·{" "}
                  {tables.reduce((sum, t) => sum + t.capacity, 0)} seats
                </span>
              </div>

              <div className="divide-y">
                {tables.map((table) => (
                  <div
                    key={table.id}
                    data-testid="table-row"
                    className="flex items-center gap-3 px-3 py-2 text-small"
                  >
                    <span className="flex-1 truncate font-medium">{table.tableName}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {table.capacity} {table.capacity === 1 ? "seat" : "seats"}
                    </span>
                    {/* Runtime state and catalogue state are different questions and get
                        different badges — conflating them is what makes an occupied table
                        look un-retirable and a retired one look available. */}
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-label ${RUNTIME_STATUS_CLASS[table.status]}`}
                    >
                      {RUNTIME_STATUS_LABEL[table.status]}
                    </span>
                    {!table.active ? <StatusBadge status="archived" label="Retired" /> : null}
                    <PermissionGuard require="pos.tables.admin">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${table.tableName}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setFormTarget({ mode: "edit", table })}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleToggleActive(table)}>
                            {table.active ? "Retire" : "Restore"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </PermissionGuard>
                  </div>
                ))}
              </div>
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
