"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { OrderTableDetailDrawer } from "@/components/pos/order-table-detail-drawer";
import { PaymentStatusBadge } from "@/components/pos/payment-status-badge";
import { TableSelectCombobox } from "@/components/pos/table-select-combobox";
import { useOrderSummaries, useAssignTable } from "@/lib/hooks/pos/use-orders";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { DerivedOrderStatus, OrderStatus, OrderSummary } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface OrderManagementProps {
  /**
   * UI-SPEC §2 "Full Menu →" escape hatch, forwarded through the shared drawer to the
   * page (plan 06's `page.tsx` owns `selectedTableId`/tab-switch state). Also used as
   * the empty-state "Go to POS" CTA (Copywriting Contract).
   */
  onFullMenu?: (tableId: string | null) => void;
}

const FADE_MS = 200;
const ALL_BRANCH_PERMISSION = "pos.order.view.all";

// POS-24 (07.3-08): "Closed" is deliberately scoped to the single CLOSED settlement
// status — VOIDED/REFUNDED are distinct settlement outcomes with their own visual
// treatment (StatusBadge) and are not what a cashier means by "closed orders" here.
const CLOSED_FILTER_STATUSES: readonly OrderStatus[] = ["CLOSED"];
const TERMINAL_SETTLEMENT_STATUSES: ReadonlySet<OrderStatus> = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

type StatusFilter = "ALL" | DerivedOrderStatus | "CLOSED" | "PAID";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "DRAFT", label: "Draft" },
  { id: "IN_PROGRESS", label: "In Progress" },
  { id: "PARTIALLY_SERVED", label: "Partially Served" },
  { id: "SERVED", label: "Served" },
  { id: "CLOSED", label: "Closed" },
  { id: "PAID", label: "Paid" },
];

function formatAge(openedAt: string | null): string {
  if (!openedAt) return "—";
  const openedMs = new Date(openedAt).getTime();
  if (Number.isNaN(openedMs)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - openedMs) / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

/**
 * Keeps a previously-visible row on screen (flagged "fading") for FADE_MS after it
 * drops out of the latest `useOrderSummaries` fetch, instead of an abrupt table
 * reflow-jump (POS-09 hard invariant: "a non-closed order never disappears… smooth
 * fade-out, not an abrupt reflow"). Only rows that ACTUALLY disappear from a refetch of
 * the underlying (unfiltered) query fade — status-chip/My-Orders-toggle changes are
 * display-only filters applied on TOP of this list (see `filtered` below) and never
 * trigger a fade, since they don't change what the server returned.
 */
function useFadeOutList(rows: OrderSummary[] | undefined) {
  const [visible, setVisible] = useState<OrderSummary[]>([]);
  const [fadingIds, setFadingIds] = useState<ReadonlySet<string>>(new Set());
  const prevIdsRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!rows) return;
    const newIds = new Set(rows.map((r) => r.orderId));
    const prevIds = prevIdsRef.current;

    setVisible((current) => {
      const byId = new Map(current.map((r) => [r.orderId, r] as const));
      for (const row of rows) byId.set(row.orderId, row);

      if (prevIds) {
        for (const id of prevIds) {
          if (newIds.has(id) || !byId.has(id) || timersRef.current.has(id)) continue;
          setFadingIds((f) => new Set(f).add(id));
          const timer = setTimeout(() => {
            setVisible((v) => v.filter((r) => r.orderId !== id));
            setFadingIds((f) => {
              const next = new Set(f);
              next.delete(id);
              return next;
            });
            timersRef.current.delete(id);
          }, FADE_MS);
          timersRef.current.set(id, timer);
        }
      }

      const stillFading = current.filter((r) => !newIds.has(r.orderId) && byId.has(r.orderId));
      return [...rows, ...stillFading];
    });

    prevIdsRef.current = newIds;
  }, [rows]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
    },
    [],
  );

  return { visible, fadingIds };
}

export function OrderManagement({ onFullMenu }: OrderManagementProps) {
  const { userId } = useCurrentUser();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [viewAll, setViewAll] = useState(true);
  const [search, setSearch] = useState("");
  const [openOrder, setOpenOrder] = useState<{ orderId: string; tableName: string | null } | null>(null);

  const isClosedFilter = statusFilter === "CLOSED";

  // The ACTIVE (default, non-terminal/non-DRAFT) list — always fetched, and the ONLY
  // source fed to `useFadeOutList` below. A Closed-filter chip switches the DISPLAYED
  // rows to a second, separately-fetched terminal-statuses query instead of re-pointing
  // this one — otherwise the fade-out invariant (RESEARCH POS-24) would misfire: rows
  // that are simply absent from a differently-scoped fetch are not "closed while
  // viewing the active list", they were never requested by it.
  const activeQuery = useOrderSummaries();
  const closedQuery = useOrderSummaries([...CLOSED_FILTER_STATUSES], { enabled: isClosedFilter });

  const { visible, fadingIds } = useFadeOutList(activeQuery.data?.data);

  const isLoading = isClosedFilter ? closedQuery.isLoading : activeQuery.isLoading;
  const isFetching = isClosedFilter ? closedQuery.isFetching : activeQuery.isFetching;
  const refetch = () => (isClosedFilter ? closedQuery.refetch() : activeQuery.refetch());

  const filtered = useMemo(() => {
    const source: OrderSummary[] = isClosedFilter ? (closedQuery.data?.data ?? []) : visible;
    const trimmedSearch = search.trim().toLowerCase();

    return source.filter((row) => {
      if (statusFilter === "PAID" && row.paymentStatus !== "PAID") return false;
      if (
        statusFilter !== "ALL" &&
        statusFilter !== "CLOSED" &&
        statusFilter !== "PAID" &&
        row.derivedStatus !== statusFilter
      ) {
        return false;
      }
      if (!viewAll && row.cashierId !== userId) return false;
      if (trimmedSearch) {
        const matchesOrderNo = row.orderNo?.toLowerCase().includes(trimmedSearch) ?? false;
        const matchesTable = row.tableName?.toLowerCase().includes(trimmedSearch) ?? false;
        if (!matchesOrderNo && !matchesTable) return false;
      }
      return true;
    });
  }, [isClosedFilter, closedQuery.data, visible, statusFilter, viewAll, userId, search]);

  const columns = useMemo<ColumnDef<OrderSummary, unknown>[]>(
    () => [
      {
        id: "orderTable",
        header: "Order / Table",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium">{o.orderNo ?? "New Order"}</span>
              <span className="text-xs text-muted-foreground">{o.tableName ?? "Takeaway"}</span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.derivedStatus} />,
      },
      {
        id: "payment",
        header: "Payment",
        cell: ({ row }) => <PaymentStatusBadge status={row.original.paymentStatus} />,
      },
      {
        id: "cashier",
        header: "Server/Cashier",
        cell: ({ row }) =>
          row.original.cashierId ? (
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.cashierId.slice(0, 8)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        // POS-24: replaces the old "Covers" column — total item quantity across
        // non-CANCELLED lines, with an optional distinct-line-count secondary line
        // when it differs from the total (e.g. "8 Items" / "5 Items / 8 Qty").
        id: "items",
        header: "Items",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="flex flex-col">
              <span className="text-sm tabular-nums">{o.itemQuantity} Items</span>
              {o.distinctItemCount !== o.itemQuantity && (
                <span className="text-xs text-muted-foreground">
                  {o.distinctItemCount} Items / {o.itemQuantity} Qty
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "total",
        header: "Total",
        cell: ({ row }) => <MoneyDisplay paisa={row.original.totalPaisa} className="text-sm" />,
      },
      {
        id: "age",
        header: "Age",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatAge(row.original.openedAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            {!row.original.tableId && !TERMINAL_SETTLEMENT_STATUSES.has(row.original.settlementStatus) && (
              <AssignTableAction orderId={row.original.orderId} />
            )}
            <button
              type="button"
              onClick={() =>
                setOpenOrder({ orderId: row.original.orderId, tableName: row.original.tableName })
              }
              data-testid={`open-order-${row.original.orderId}`}
              aria-label={`Open order ${row.original.orderNo ?? row.original.orderId}`}
              className="text-xs font-medium text-primary underline"
            >
              Open
            </button>
          </div>
        ),
      },
    ],
    [],
  );

  const showEmptyState = !isLoading && filtered.length === 0;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status filter chips — reuses menu-grid.tsx's category-pill visual pattern */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              data-testid={`status-filter-${f.id}`}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                statusFilter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search box (POS-24) — filters the currently-scoped rows by order no. / table
            name, case-insensitive substring, client-side. */}
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order # or table…"
          aria-label="Search orders"
          data-testid="order-management-search"
          className="h-9 max-w-56"
        />

        <div className="flex items-center gap-2">
          {/* My Orders / All Branch — permission-gated, never a disabled control (UI-SPEC §1) */}
          <PermissionGuard require={ALL_BRANCH_PERMISSION}>
            <div className="flex items-center gap-1 rounded-full border p-1 text-xs">
              <button
                type="button"
                onClick={() => setViewAll(false)}
                data-testid="toggle-my-orders"
                className={cn(
                  "rounded-full px-3 py-1.5 font-medium transition-colors",
                  !viewAll ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                My Orders
              </button>
              <button
                type="button"
                onClick={() => setViewAll(true)}
                data-testid="toggle-all-branch"
                className={cn(
                  "rounded-full px-3 py-1.5 font-medium transition-colors",
                  viewAll ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                All Branch
              </button>
            </div>
          </PermissionGuard>

          {/* Manual Refresh (POS-21) — re-fetches the summaries list on demand; a
              subtle spin while `isFetching` (initial load OR this click) without
              disturbing the fade-out-list invariant above. */}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            data-testid="order-management-refresh"
            aria-label="Refresh orders"
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showEmptyState ? (
          <EmptyState
            title="No active orders"
            description="Orders opened from the floor or terminal appear here until they're closed."
            action={{ label: "Go to POS", onClick: () => onFullMenu?.(null) }}
          />
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            isLoading={isLoading}
            emptyMessage="No active orders"
            rowClassName={(row) =>
              fadingIds.has(row.orderId) ? "opacity-0 transition-opacity duration-200" : undefined
            }
          />
        )}
      </div>

      <OrderTableDetailDrawer
        open={openOrder !== null}
        onOpenChange={(open) => {
          if (!open) setOpenOrder(null);
        }}
        orderId={openOrder?.orderId ?? null}
        tableName={openOrder?.tableName ?? null}
        onFullMenu={onFullMenu}
      />
    </div>
  );
}

// ── Assign Table row action (POS-24) ───────────────────────────────────────────

interface AssignTableActionProps {
  orderId: string;
}

/**
 * Tableless-order row action — opens the AVAILABLE-only `table-select-combobox`
 * (occupied tables blocked, not merely disabled) and calls `useAssignTable`, whose
 * multi-key invalidation (order-summaries + order + tables) updates the row and the
 * assigned table's status immediately, without a manual refresh.
 */
function AssignTableAction({ orderId }: AssignTableActionProps) {
  const [open, setOpen] = useState(false);
  const assignTable = useAssignTable(orderId);

  const handleAssign = async (tableId: string | null) => {
    if (!tableId) return;
    try {
      await assignTable.mutateAsync(tableId);
      toast.success("Table assigned");
      setOpen(false);
    } catch {
      toast.error("Failed to assign table. Please try again.");
    }
  };

  if (open) {
    return (
      <TableSelectCombobox
        value={null}
        onChange={(tableId) => void handleAssign(tableId)}
        availableOnly
        className="w-40"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={assignTable.isPending}
      data-testid={`assign-table-${orderId}`}
      className="text-xs font-medium text-primary underline disabled:cursor-not-allowed disabled:opacity-50"
    >
      Assign Table
    </button>
  );
}
