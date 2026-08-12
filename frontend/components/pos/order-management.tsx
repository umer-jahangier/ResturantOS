"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { PermissionGuard } from "@/components/shared/permission-guard";
import {
  OrderTableDetailDrawer,
  type FullMenuTarget,
} from "@/components/pos/order-table-detail-drawer";
import { PaymentStatusBadge } from "@/components/pos/payment-status-badge";
import { TableSelectCombobox } from "@/components/pos/table-select-combobox";
import { useOrderSummaries, useAssignTable } from "@/lib/hooks/pos/use-orders";
import { useVoidOrder } from "@/lib/hooks/pos/use-payments";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import {
  getOrderDisplayStatus,
  orderTypeLabel,
  type DerivedOrderStatus,
  type OrderStatus,
  type OrderSummary,
} from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface OrderManagementProps {
  /**
   * UI-SPEC §2 "Full Menu →" escape hatch, forwarded through the shared drawer to the
   * page (plan 06's `page.tsx` owns the terminal binding + tab-switch state). Also used
   * as the empty-state "Go to POS" CTA (Copywriting Contract) — which, having no order
   * to resume, passes a null `orderId`.
   */
  onFullMenu?: (target: FullMenuTarget) => void;
}

const FADE_MS = 200;
const ALL_BRANCH_PERMISSION = "pos.order.view.all";

/** S0-05 — one request per settled term, not one per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;
/**
 * Rows a search may return in one page. Wider than the list's default 20 because a search is
 * already a narrowing act; when even this is not enough the count line below the table says so
 * instead of quietly showing a prefix.
 */
const SEARCH_PAGE_SIZE = 100;

const TERMINAL_SETTLEMENT_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "CLOSED",
  "VOIDED",
  "REFUNDED",
]);

/**
 * The chips that ask the server for ONE explicit settlement status, instead of filtering the
 * active list client-side.
 *
 * <p>S0-04: "Closed" used to be the only one, and that was the whole defect. The default
 * listing is every NON-terminal status except DRAFT, so a voided or refunded order was in
 * neither the default fetch nor any client-side filter applied on top of it — it appeared under
 * none of the seven chips and under no search. `?status=VOIDED` had always worked; nothing ever
 * asked. Each entry here is one such ask.
 *
 * <p>They stay SEPARATE chips rather than one "Settled" chip because CLOSED, VOIDED and REFUNDED
 * are three different things that happened to the money, and an owner looking for voids is not
 * looking for paid checks.
 */
const SETTLEMENT_FILTER_STATUSES = {
  CLOSED: ["CLOSED"],
  VOIDED: ["VOIDED"],
  REFUNDED: ["REFUNDED"],
} as const satisfies Record<string, readonly OrderStatus[]>;

type SettlementFilter = keyof typeof SETTLEMENT_FILTER_STATUSES;

type StatusFilter = "ALL" | DerivedOrderStatus | SettlementFilter | "PAID";

function isSettlementFilter(filter: StatusFilter): filter is SettlementFilter {
  return filter in SETTLEMENT_FILTER_STATUSES;
}

/**
 * "Active" is NOT a rename for its own sake. This chip has never meant "all orders" — it shows
 * the server's default listing, which is every non-terminal status except DRAFT. Labelling that
 * "All" is what made a missing voided order read as data loss rather than as a filter that never
 * asked for it. The chip keeps its `ALL` id (and `status-filter-ALL` test id) because that is
 * what it selects; only the promise it makes to the reader has been corrected, and the caption
 * under the row says where the settled orders went.
 */
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "ALL", label: "Active" },
  { id: "DRAFT", label: "Draft" },
  { id: "IN_PROGRESS", label: "In Progress" },
  { id: "PARTIALLY_SERVED", label: "Partially Served" },
  { id: "SERVED", label: "Served" },
  { id: "CLOSED", label: "Closed" },
  { id: "PAID", label: "Paid" },
  { id: "VOIDED", label: "Voided" },
  { id: "REFUNDED", label: "Refunded" },
];

const EMPTY_SETTLEMENT_COPY: Record<SettlementFilter, { title: string; description: string }> = {
  CLOSED: {
    title: "No closed orders",
    description: "Checks that have been paid and finished appear here.",
  },
  VOIDED: {
    title: "No voided orders",
    description: "Cancelled checks appear here with their reason and who voided them.",
  },
  REFUNDED: {
    title: "No refunded orders",
    description: "Checks where money was given back appear here with their reason.",
  },
};

function formatSettledAt(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

/**
 * Holds a value back until it has stopped changing for `delayMs` (S0-05).
 *
 * The search box now issues a REAL request per term — order number, table, and a
 * cross-service customer-phone resolve — so firing one per keystroke would put eleven
 * queries on the wire for one phone number. This is why the search feels instant while the
 * network stays quiet.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function OrderManagement({ onFullMenu }: OrderManagementProps) {
  const { userId } = useCurrentUser();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [viewAll, setViewAll] = useState(true);
  const [search, setSearch] = useState("");
  const [openOrder, setOpenOrder] = useState<{ orderId: string; tableName: string | null } | null>(
    null,
  );

  const settlementFilter = isSettlementFilter(statusFilter) ? statusFilter : null;

  // The ACTIVE (default, non-terminal/non-DRAFT) list — always fetched, and the ONLY
  // source fed to `useFadeOutList` below. A settlement chip (Closed/Voided/Refunded)
  // switches the DISPLAYED rows to a second, separately-fetched explicit-status query
  // instead of re-pointing this one — otherwise the fade-out invariant (RESEARCH POS-24)
  // would misfire: rows that are simply absent from a differently-scoped fetch are not
  // "closed while viewing the active list", they were never requested by it.
  const activeQuery = useOrderSummaries();
  const settledQuery = useOrderSummaries(
    settlementFilter ? [...SETTLEMENT_FILTER_STATUSES[settlementFilter]] : undefined,
    { enabled: settlementFilter !== null },
  );

  // ── Search (S0-05) ──────────────────────────────────────────────────────────
  // A THIRD query, deliberately separate from the two above. Search is not a view of the
  // active list: the server answers it across every status and every page, so a voided or
  // closed check — or row 34 of a 20-row page — is findable by its own number without the
  // user first guessing which chip it lives behind. The old implementation was
  // `source.filter(...)` over the rows already on screen, which is why `0026` returned
  // "No active orders" for an order that plainly existed.
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const isSearching = debouncedSearch.length > 0;
  const searchQuery = useOrderSummaries(undefined, {
    enabled: isSearching,
    q: debouncedSearch,
    size: SEARCH_PAGE_SIZE,
  });

  const { visible, fadingIds } = useFadeOutList(activeQuery.data?.data);

  const isLoading = isSearching
    ? searchQuery.isLoading
    : settlementFilter
      ? settledQuery.isLoading
      : activeQuery.isLoading;
  const isFetching = isSearching
    ? searchQuery.isFetching
    : settlementFilter
      ? settledQuery.isFetching
      : activeQuery.isFetching;
  const refetch = () =>
    isSearching
      ? searchQuery.refetch()
      : settlementFilter
        ? settledQuery.refetch()
        : activeQuery.refetch();
  /**
   * F2. `isError` was never destructured anywhere in this component, so a FAILED read rendered
   * `filtered.length === 0` and the user got "No active orders" — a confident, wrong statement
   * that there is no business today. That is the codebase's named failure shape (a component
   * folding a failed read into an empty state), and it sits directly under this change: making
   * the wire contract stricter without it would have converted a mislabelled row into a silent
   * lie about the whole shift.
   */
  const listError = isSearching
    ? searchQuery.error
    : settlementFilter
      ? settledQuery.error
      : activeQuery.error;
  const isError = isSearching
    ? searchQuery.isError
    : settlementFilter
      ? settledQuery.isError
      : activeQuery.isError;

  // Server-side matches can outrun one page. Say so rather than silently showing a prefix —
  // a truncated list that looks complete is the failure this whole gap is made of.
  const searchTotal = searchQuery.data?.meta?.totalCount ?? 0;
  const searchTruncated = isSearching && searchTotal > (searchQuery.data?.data.length ?? 0);

  const filtered = useMemo(() => {
    // While searching, the SERVER's answer is the source and the status chips do not narrow
    // it — the point of the search is to reach past the chip you happen to have selected.
    if (isSearching) {
      const rows = searchQuery.data?.data ?? [];
      return viewAll ? rows : rows.filter((row) => row.cashierId === userId);
    }

    const source: OrderSummary[] = settlementFilter ? (settledQuery.data?.data ?? []) : visible;

    return source.filter((row) => {
      if (statusFilter === "PAID" && row.paymentStatus !== "PAID") return false;
      if (
        statusFilter !== "ALL" &&
        statusFilter !== "PAID" &&
        !isSettlementFilter(statusFilter) &&
        row.derivedStatus !== statusFilter
      ) {
        return false;
      }
      if (!viewAll && row.cashierId !== userId) return false;
      return true;
    });
  }, [
    isSearching,
    searchQuery.data,
    settlementFilter,
    settledQuery.data,
    visible,
    statusFilter,
    viewAll,
    userId,
  ]);

  const columns = useMemo<ColumnDef<OrderSummary, unknown>[]>(
    () => [
      {
        id: "orderTable",
        header: "Order / Type",
        cell: ({ row }) => {
          const o = row.original;
          // F2 (b). This read `{o.tableName ?? "Takeaway"}` — the order's own `type` was never
          // consulted because the summary row never carried it. Every DINE_IN check without a
          // table therefore read "Takeaway": measured 2026-08-12, ten of ten rows on the first
          // page and thirteen consecutive rows on the Voided chip, on a screen a manager scans
          // all day. The type is now server-authoritative and the table name rides ALONGSIDE it
          // rather than standing in for it, so "Dine-in" and "Dine-in · H1" are both sayable.
          const label = orderTypeLabel(o.type);
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium">{o.orderNo ?? "New Order"}</span>
              <span className="text-xs text-muted-foreground" data-testid="order-type-cell">
                {o.tableName ? `${label} · ${o.tableName}` : label}
              </span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        // S0-04: a settled order shows its SETTLEMENT outcome, not its kitchen progress.
        // `derivedStatus` on a voided check still reads "In Progress" — it records how far
        // the food got, which is exactly the wrong answer once the check has been voided.
        // getOrderDisplayStatus() is the shared merge every other POS surface already uses.
        cell: ({ row }) => (
          <StatusBadge
            status={getOrderDisplayStatus({
              status: row.original.settlementStatus,
              derivedStatus: row.original.derivedStatus,
            })}
          />
        ),
      },
      {
        id: "payment",
        header: "Payment",
        cell: ({ row }) => <PaymentStatusBadge status={row.original.paymentStatus} />,
      },
      {
        id: "cashier",
        header: "Server/Cashier",
        // F2 (a). This printed `cashierId.slice(0, 8)` — "bc0d9897" — for every row and every
        // persona, while the SAME table's Voided column printed "by Shift Cashier 984155" for a
        // user id resolved by the same mechanism a few pixels away. The name now comes down on
        // the row itself (OrderCashierNameService); the id remains the fallback, because a
        // directory outage must cost the name and not the attribution.
        cell: ({ row }) => {
          const { cashierName, cashierId } = row.original;
          if (cashierName) {
            return (
              <span className="text-sm" data-testid={`cashier-cell-${row.original.orderId}`}>
                {cashierName}
              </span>
            );
          }
          if (cashierId) {
            return (
              <span
                className="font-mono text-xs text-muted-foreground"
                data-testid={`cashier-cell-${row.original.orderId}`}
                title="This person's name could not be looked up just now — this is their user id."
              >
                {cashierId.slice(0, 8)}
              </span>
            );
          }
          return (
            <span
              className="text-xs text-muted-foreground"
              data-testid={`cashier-cell-${row.original.orderId}`}
            >
              —
            </span>
          );
        },
      },
      {
        // POS-24: replaces the old "Covers" column — total item quantity across
        // non-CANCELLED lines, with the distinct-line count beneath it when the two differ.
        //
        // F2 (e). This used to read "4 Items" and then "3 Items / 4 Qty" in the SAME cell: the
        // word "Items" meant the total quantity on the first line and the number of distinct
        // lines on the second, so the cell stated the count twice and disagreed with itself.
        // Now each line has its own noun — 4 items of food, on 3 lines of the check — and
        // neither is ever "1 Items".
        id: "items",
        header: "Items",
        cell: ({ row }) => {
          const o = row.original;
          const qty = o.itemQuantity;
          const lines = o.distinctItemCount;
          return (
            <div
              className="flex flex-col"
              data-testid={`items-cell-${o.orderId}`}
              title={
                lines === qty
                  ? undefined
                  : `${qty} ${qty === 1 ? "item" : "items"} in total, on ${lines} ${lines === 1 ? "line" : "lines"} of the check`
              }
            >
              <span className="text-sm tabular-nums">
                {qty} {qty === 1 ? "item" : "items"}
              </span>
              {lines !== qty && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {lines} {lines === 1 ? "line" : "lines"}
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
      // S0-04. Only on the Voided/Refunded chips: on every other view every row would be
      // blank, and a permanently-empty column is worse than no column (DESIGN-BRIEF §23).
      // The register's finding was not only that a void was unreachable but that nothing in
      // the product could say WHY it happened or WHO did it — this column is that answer.
      ...(settlementFilter === "VOIDED" || settlementFilter === "REFUNDED"
        ? [
            {
              id: "settlement",
              header: settlementFilter === "VOIDED" ? "Voided" : "Refunded",
              cell: ({ row }: { row: { original: OrderSummary } }) => (
                <SettlementDetailCell order={row.original} />
              ),
            } as ColumnDef<OrderSummary, unknown>,
          ]
        : []),
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
        cell: ({ row }) => {
          // F2 (c). `derivedStatus` records how far the FOOD got, not what happened to the
          // check — a draft that was never fired keeps `derivedStatus === "DRAFT"` after it has
          // been voided. So rows 0167/0168/0169, already VOIDED, still offered "Cancel" (which
          // would void an already-voided order) and "Continue" (which would reopen it in the
          // terminal). The settlement status is the one that says whether the check is over,
          // and it is the same set already gating Assign Table two lines below.
          const isSettled = TERMINAL_SETTLEMENT_STATUSES.has(row.original.settlementStatus);
          const isDraft = !isSettled && row.original.derivedStatus === "DRAFT";
          return (
            <div className="flex items-center justify-end gap-2">
              {!row.original.tableId && !isSettled && (
                <AssignTableAction orderId={row.original.orderId} />
              )}
              {isDraft && <CancelDraftAction orderId={row.original.orderId} />}
              <button
                type="button"
                onClick={() =>
                  setOpenOrder({ orderId: row.original.orderId, tableName: row.original.tableName })
                }
                data-testid={`open-order-${row.original.orderId}`}
                aria-label={`${isDraft ? "Continue" : "Open"} order ${row.original.orderNo ?? row.original.orderId}`}
                className="text-xs font-medium text-primary underline"
              >
                {isDraft ? "Continue" : "Open"}
              </button>
            </div>
          );
        },
      },
    ],
    [settlementFilter],
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

        {/*
          S0-04. The chip row cannot silently mean something narrower than it says. "Active"
          shows live orders only; the register found a voided check appearing under NONE of the
          chips, and the honest fix is both to add the chips that can find it AND to say on the
          screen where it went, in the one place someone is looking when they cannot find it.
        */}
        <p
          data-testid="order-scope-note"
          className="w-full text-xs text-muted-foreground"
          aria-live="polite"
        >
          {settlementFilter === "VOIDED"
            ? "Voided orders — cancelled checks, with the reason and who voided them. These are not in Active."
            : settlementFilter === "REFUNDED"
              ? "Refunded orders — money given back, with the reason and who refunded it. These are not in Active."
              : settlementFilter === "CLOSED"
                ? "Closed orders — settled and finished. These are not in Active."
                : "Active shows live orders only. Settled checks are under Closed, Voided and Refunded."}
        </p>

        {/*
          Search box. S0-05: this asks the SERVER, which searches order number, table name and
          the attached customer's phone/name across EVERY status and every page — so a check
          you have just voided is found by typing its number, with no chip to switch first.
          It used to be a substring filter over the rows already on screen, which could not
          reach a voided order, a closed one, or anything past the first page.
        */}
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order #, table or phone…"
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
            <RefreshCw
              className={cn("size-3.5", isFetching && "animate-spin")}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>
      </div>

      {/*
        S0-05 — what the rows on screen actually are while a search is running. Two honest
        statements, and both matter: the search ignores the chips (so nobody reads the result
        as "the Active list, narrowed"), and it says out loud when there are more matches than
        this page holds, rather than showing a prefix that looks complete.
      */}
      {isSearching && (
        <p
          data-testid="order-search-scope-note"
          className="text-xs text-muted-foreground"
          aria-live="polite"
        >
          {`Searching every order — live, closed, voided and refunded — for “${debouncedSearch}”.`}
          {searchTruncated
            ? ` Showing the first ${filtered.length} of ${searchTotal} matches; narrow the search to see the rest.`
            : ""}
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        {isError ? (
          // Error BEFORE empty, always. "No active orders" is a claim about the restaurant;
          // this is a statement about the read that failed, and it is the only honest one when
          // nothing came back.
          <div className="flex h-full items-start justify-center overflow-auto p-2">
            <div className="w-full max-w-xl">
              <QueryErrorNotice
                what="the order list"
                moduleLabel="POS"
                error={listError}
                stillWorks="Orders already sent to the kitchen are unaffected. Do not assume a check is missing because it is not listed here."
                isRetrying={isFetching}
                onRetry={() => void refetch()}
              />
            </div>
          </div>
        ) : showEmptyState ? (
          isSearching ? (
            // Never "No active orders" here: the search deliberately spans every status, so
            // that copy would be a lie about what was looked at — the exact confusion the
            // register recorded when `0026` came back "No active orders".
            <EmptyState
              title="No orders match that search"
              description={`Nothing found for “${debouncedSearch}” in any order — live, closed, voided or refunded. Try the order number, the table, or the customer's phone.`}
            />
          ) : settlementFilter ? (
            // A settlement view's empty state must not read "No active orders" — that copy
            // told a manager who had just voided a check that their void had vanished.
            <EmptyState
              title={EMPTY_SETTLEMENT_COPY[settlementFilter].title}
              description={EMPTY_SETTLEMENT_COPY[settlementFilter].description}
            />
          ) : (
            <EmptyState
              title="No active orders"
              description="Orders opened from the floor or terminal appear here until they're closed."
              action={{
                label: "Go to POS",
                onClick: () => onFullMenu?.({ orderId: null, tableId: null }),
              }}
            />
          )
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            isLoading={isLoading}
            emptyMessage={
              isSearching
                ? "No orders match that search"
                : settlementFilter
                  ? EMPTY_SETTLEMENT_COPY[settlementFilter].title
                  : "No active orders"
            }
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

// ── Settlement provenance cell (S0-04, F2) ─────────────────────────────────────

/**
 * WHY a check was voided or refunded, and BY WHOM — readable in full, without a mouse.
 *
 * <h3>The constraint</h3>
 * DataGrid holds every row to one height with `whitespace-nowrap` on the `<td>`; a wrapping cell
 * silently overrides that, and a long free-text reason previously ran clean across the next
 * column (measured: the reason printed on top of the Age value). So the cell must truncate.
 *
 * <h3>What was wrong with truncating alone</h3>
 * The full text was reachable only through `title`, which is a hover affordance. Measured on the
 * live Voided list: *"shift walkthrough — manager voiding a fired, unpaid check"* rendered at
 * `scrollWidth 374 / clientWidth 352` with `white-space: nowrap` — genuinely clipped. On the
 * tablet this screen is used on there is no hover, so the last words of a manager's reason were
 * simply unavailable, and nothing on screen said there were any.
 *
 * <h3>The fix</h3>
 * The reason becomes a real control: tap or click (or Enter/Space, it is a `<button>`) opens a
 * popover carrying the reason WRAPPED in full plus the byline. `title` stays for mouse users who
 * hover. The row keeps its single height, and no reason is unreadable on any input device.
 */
function SettlementDetailCell({ order }: { order: OrderSummary }) {
  const detail = order.settlement;
  const when = formatSettledAt(detail?.at);
  // The id is the fact; the name is decoration resolved from the staff directory. Falling back to
  // the id keeps an attribution on screen when the directory is unreachable, instead of a blank
  // that reads as "nobody".
  const who = detail?.byName ?? detail?.byUserId?.slice(0, 8) ?? null;
  const recordedReason = detail?.reason?.trim() ? detail.reason.trim() : null;
  const reason = recordedReason ?? "No reason recorded";
  const byline = `${who ? `by ${who}` : "by (not recorded)"}${when ? ` · ${when}` : ""}`;

  return (
    <div
      className="flex max-w-[22rem] min-w-0 flex-col gap-0.5"
      data-testid={`settlement-detail-${order.orderId}`}
    >
      {recordedReason ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={recordedReason}
              aria-label={`Read the full reason for order ${order.orderNo ?? order.orderId}`}
              data-testid={`settlement-reason-${order.orderId}`}
              className="min-w-0 truncate text-left text-sm underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {recordedReason}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80"
            data-testid={`settlement-reason-full-${order.orderId}`}
          >
            <p className="text-sm break-words whitespace-normal">{recordedReason}</p>
            <p className="mt-2 text-xs break-words whitespace-normal text-muted-foreground">
              {byline}
            </p>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="truncate text-sm text-muted-foreground">{reason}</span>
      )}
      <span className="truncate text-xs text-muted-foreground" title={byline}>
        {byline}
      </span>
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

// ── Cancel Draft row action ─────────────────────────────────────────────────────

interface CancelDraftActionProps {
  orderId: string;
}

/**
 * Cancels a draft order (never-fired, derivedStatus DRAFT) — voids it so it leaves the
 * active list. Two-step confirm inline (no modal) to guard against an accidental tap;
 * `useVoidOrder`'s multi-key invalidation removes the row immediately.
 */
function CancelDraftAction({ orderId }: CancelDraftActionProps) {
  const [confirming, setConfirming] = useState(false);
  const voidOrder = useVoidOrder(orderId);

  const handleCancel = async () => {
    try {
      await voidOrder.mutateAsync({
        payload: { reason: "Draft cancelled" },
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success("Draft cancelled");
    } catch {
      toast.error("Failed to cancel draft. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={voidOrder.isPending}
          data-testid={`cancel-draft-confirm-${orderId}`}
          className="text-xs font-medium text-destructive underline disabled:opacity-50"
        >
          {voidOrder.isPending ? "Cancelling…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={voidOrder.isPending}
          className="text-xs text-muted-foreground underline"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      data-testid={`cancel-draft-${orderId}`}
      className="text-xs font-medium text-destructive underline"
    >
      Cancel
    </button>
  );
}
