"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
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
  type OrderType,
  type PaymentStatus,
} from "@/lib/models/pos.model";
import {
  orderCountLabel,
  orderIdentifier,
  summariseOrders,
  unpaidLabel,
} from "@/components/pos/order-list-stats";
import { ELAPSED_UNKNOWN, readElapsed } from "@/lib/format/elapsed";
import { formatDateTime } from "@/lib/format/locale";
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
 * The chips that ask the server for ONE explicit status, instead of filtering the active list
 * client-side.
 *
 * <p>Membership is decided by a single fact about the server: the default listing
 * (OrderServiceImpl.listOrderSummaries) is every NON-terminal status EXCEPT DRAFT. A status
 * outside that set is in neither the default fetch nor any client-side filter applied on top of
 * it, so a chip for it can never match a row however it filters — the row is not merely
 * filtered out, it was never fetched. Each entry here is the ask that gets it fetched.
 *
 * <p>S0-04: "Closed" used to be the only one, and that was the whole defect for voids — a voided
 * order appeared under none of the seven chips and under no search.
 *
 * <p>DRAFT is here for exactly the same reason and was missed by that fix because it fails at
 * the other end of the lifecycle: the default listing excludes it (POS-16), so the Draft chip
 * filtered a list that by construction never contains a draft. The chip could not render a row,
 * and `CancelDraftAction`, written for draft rows, was unreachable code. `?status=DRAFT` had
 * always worked; nothing ever asked.
 *
 * <p>The claim being made here is deliberately narrow, because a DRAFT is far less than it
 * sounds. It is `createOrder` before the first `addItem` — `addItem` flips it to OPEN and only
 * then assigns an order number — so it has no lines, no total and no number, and it is inert:
 * it binds no table (`syncStatusForOrder` runs on the DRAFT->OPEN transition, not at creation)
 * and it does not block the cash-up (TillServiceImpl.DOES_NOT_BLOCK_CASH_UP). This fixes a chip
 * that lies and a control that cannot be reached. It is not rescuing a stuck drawer.
 *
 * <p>The name is deliberately NOT "settlement": DRAFT is not a settlement outcome, it is a check
 * on which nothing has happened yet. What CLOSED, VOIDED, REFUNDED and DRAFT share is not the
 * money — it is that the default listing cannot serve them.
 *
 * <p>They stay SEPARATE chips rather than one "Settled" chip because CLOSED, VOIDED and REFUNDED
 * are three different things that happened to the money, and an owner looking for voids is not
 * looking for paid checks.
 */
const SERVER_SCOPED_FILTER_STATUSES = {
  DRAFT: ["DRAFT"],
  CLOSED: ["CLOSED"],
  VOIDED: ["VOIDED"],
  REFUNDED: ["REFUNDED"],
} as const satisfies Record<string, readonly OrderStatus[]>;

type ServerScopedFilter = keyof typeof SERVER_SCOPED_FILTER_STATUSES;

type StatusFilter = "ALL" | DerivedOrderStatus | ServerScopedFilter | "PAID";

function isServerScopedFilter(filter: StatusFilter): filter is ServerScopedFilter {
  return filter in SERVER_SCOPED_FILTER_STATUSES;
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

/**
 * Keyed on `ServerScopedFilter` rather than `string` on purpose: adding a chip to
 * SERVER_SCOPED_FILTER_STATUSES without writing its empty-state copy is then a COMPILE error,
 * not a screen that quietly claims "No active orders" while showing a differently-scoped fetch.
 * That mislabelling is the bug this map was introduced to end, and the type is what keeps the
 * next chip from re-introducing it.
 */
const EMPTY_SCOPED_COPY: Record<
  ServerScopedFilter,
  { title: string; description: string; goToPos?: boolean }
> = {
  DRAFT: {
    title: "No draft orders",
    description:
      "Checks that have not reached the kitchen appear here — opened and never added to, or rung up but not yet sent.",
    // The one scoped view where "start an order" IS the next action (design brief §26). It is a
    // non-sequitur under Closed/Voided/Refunded, which answer "where did that check go".
    goToPos: true,
  },
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

/**
 * The caption under the chip row, keyed on the same union and for the same reason as
 * EMPTY_SCOPED_COPY: a chip that does not state where its rows live leaves the screen describing
 * Active while showing something else, which is the confusion S0-04 exists to end. As a nested
 * ternary this silently fell through to the Active copy for any chip nobody had thought about —
 * which is precisely what Draft did.
 */
const SCOPE_NOTE: Record<ServerScopedFilter, string> = {
  DRAFT:
    "Draft orders — nothing here has gone to the kitchen yet: opened and never added to, or rung up but not yet sent. The empty ones are not in Active.",
  CLOSED: "Closed orders — settled and finished. These are not in Active.",
  VOIDED:
    "Voided orders — cancelled checks, with the reason and who voided them. These are not in Active.",
  REFUNDED:
    "Refunded orders — money given back, with the reason and who refunded it. These are not in Active.",
};

const ACTIVE_SCOPE_NOTE =
  "Active shows live orders only. Drafts are under Draft; settled checks are under Closed, Voided and Refunded.";

function formatSettledAt(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return null;
  return formatDateTime(ms, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The wall-clock the check was opened at — the demo's `Time` column, `19:42`.
 *
 * <p>Deliberately NOT a duration: `Time` answers *when did this start* and `Prep` answers *how
 * long has it been*, and a column that tries to be both is the `113h 52m`-under-ACT-NOW defect
 * `lib/format/elapsed.ts` was written to end. The date is dropped because every row in an
 * operational order list is from the current service; a row that is not says so in `Prep`, which
 * stops counting at 24 h and prints the date instead.
 */
function formatOpenedClock(openedAt: string | null): string {
  if (!openedAt) return ELAPSED_UNKNOWN;
  const ms = new Date(openedAt).getTime();
  if (Number.isNaN(ms)) return ELAPSED_UNKNOWN;
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * How often the `Prep` column re-reads the clock.
 *
 * <p>This is data freshness, not motion. `formatElapsedCompact` drops seconds above one hour
 * precisely so nothing on an `operational` surface repaints once a second (D-38-04), so a
 * half-minute tick is the coarsest interval that still keeps a `07:42` from going stale in front
 * of a cashier. Everything below an hour is `mm:ss`, which would visibly lag at anything slower.
 */
const PREP_TICK_MS = 30_000;

/**
 * One clock for the whole list, mirroring the KDS's `useKdsClock`: every row must agree on `now`,
 * or two rows opened in the same second render different ages depending on what else re-rendered.
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * The two facets that filter the ROWS ON SCREEN rather than the query (38-06 task 4).
 *
 * <p>`GET /api/v1/pos/orders` accepts `branchId`, `status[]`, `q` and a `Pageable` and nothing
 * else — verified at `OrderController.listOrders`. There is no `type` and no `paymentStatus`
 * parameter, so these two narrow the fetched set, exactly as the status chips have always done.
 * That is honest here and would not be honest for a date range, which is why no date control is
 * offered: a date picker over one page of a live, day-agnostic listing would filter the page and
 * claim to filter the day (UI-SPEC §13, audit §12).
 */
const TYPE_FILTER_OPTIONS: { value: OrderType; label: string }[] = [
  { value: "DINE_IN", label: orderTypeLabel("DINE_IN") },
  { value: "TAKEAWAY", label: orderTypeLabel("TAKEAWAY") },
  { value: "DELIVERY", label: orderTypeLabel("DELIVERY") },
  { value: "PICKUP", label: orderTypeLabel("PICKUP") },
];

const PAYMENT_FILTER_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
  { value: "PAID", label: "Paid" },
  { value: "REFUNDED", label: "Refunded" },
];

/** `""` is "not filtering" — an absent facet and an empty one are the same thing (FilterBar). */
function matchesFacets(
  row: OrderSummary,
  type: "" | OrderType,
  payment: "" | PaymentStatus,
): boolean {
  if (type !== "" && row.type !== type) return false;
  if (payment !== "" && row.paymentStatus !== payment) return false;
  return true;
}

/**
 * The `Prep` column — how long this check has been open, bounded.
 *
 * <p>Three channels, none of them colour (D-38-13 / UI-SPEC §4.2): the compact TEXT changes shape
 * at the 24-hour bound from a running timer (`07:42`) to a date (`7 Aug`), the urgency treatment
 * is withdrawn with it, and the screen reader gets `srLabel` — spelled out in words, because
 * `07:42` announced on its own is a clock time ("seven forty-two"), which is a different fact.
 */
function PrepCell({ openedAt, now }: { openedAt: string | null; now: number }) {
  if (!openedAt) {
    return (
      <span className="text-small text-foreground-tertiary" aria-label="Age unknown">
        {ELAPSED_UNKNOWN}
      </span>
    );
  }
  const reading = readElapsed(openedAt, now);
  return (
    <span
      className={cn(
        "text-small tabular-nums",
        reading.withinUrgencyWindow ? "text-foreground" : "text-foreground-tertiary",
      )}
      title={
        reading.withinUrgencyWindow
          ? `Open for ${reading.long}`
          : `Opened ${reading.long} — older than a day, so this is a date, not a timer`
      }
    >
      <span aria-hidden="true">{reading.compact}</span>
      <span className="sr-only">{reading.srLabel}</span>
    </span>
  );
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
  const [typeFilter, setTypeFilter] = useState<"" | OrderType>("");
  const [paymentFilter, setPaymentFilter] = useState<"" | PaymentStatus>("");
  const [viewAll, setViewAll] = useState(true);
  const [search, setSearch] = useState("");
  const [openOrder, setOpenOrder] = useState<{ orderId: string; tableName: string | null } | null>(
    null,
  );

  const serverScopedFilter = isServerScopedFilter(statusFilter) ? statusFilter : null;

  // One `now` for every Prep cell in the list — see PREP_TICK_MS.
  const now = useNow(PREP_TICK_MS);

  // The ACTIVE (default, non-terminal/non-DRAFT) list — always fetched, and the ONLY
  // source fed to `useFadeOutList` below. A server-scoped chip (Draft/Closed/Voided/Refunded)
  // switches the DISPLAYED rows to a second, separately-fetched explicit-status query
  // instead of re-pointing this one — otherwise the fade-out invariant (RESEARCH POS-24)
  // would misfire: rows that are simply absent from a differently-scoped fetch are not
  // "closed while viewing the active list", they were never requested by it.
  const activeQuery = useOrderSummaries();
  const scopedQuery = useOrderSummaries(
    serverScopedFilter ? [...SERVER_SCOPED_FILTER_STATUSES[serverScopedFilter]] : undefined,
    { enabled: serverScopedFilter !== null },
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
    : serverScopedFilter
      ? scopedQuery.isLoading
      : activeQuery.isLoading;
  const isFetching = isSearching
    ? searchQuery.isFetching
    : serverScopedFilter
      ? scopedQuery.isFetching
      : activeQuery.isFetching;
  const refetch = () =>
    isSearching
      ? searchQuery.refetch()
      : serverScopedFilter
        ? scopedQuery.refetch()
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
    : serverScopedFilter
      ? scopedQuery.error
      : activeQuery.error;
  const isError = isSearching
    ? searchQuery.isError
    : serverScopedFilter
      ? scopedQuery.isError
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
      return rows.filter(
        (row) =>
          (viewAll || row.cashierId === userId) && matchesFacets(row, typeFilter, paymentFilter),
      );
    }

    // Draft is the one chip whose rows come from BOTH sources, because "draft" names two
    // different things and the Status column shows the same word for each. getOrderDisplayStatus
    // renders `derivedStatus` for any non-terminal check, so a row reads "Draft" when either:
    //
    //   settlementStatus DRAFT — opened, never had an item added. An empty shell. EXCLUDED from
    //                            the default listing, so it can only arrive via ?status=DRAFT.
    //   derivedStatus  DRAFT   — rung up, nothing fired to the kitchen yet. Its settlementStatus
    //                            is OPEN, so it IS in the default listing.
    //
    // Taking only the second is what the chip did before, and it is why the shells were
    // unreachable. Taking only the first would have been a swap, not a fix: it would have
    // dropped the rung-but-unfired checks, which are the ones a cashier actually acts on, and
    // silently narrowed a view that the F2 audit drove and passed. The union is what the chip
    // says on the tin — every check whose status reads Draft.
    const source: OrderSummary[] = (() => {
      if (statusFilter === "DRAFT") {
        const shells = scopedQuery.data?.data ?? [];
        const shellIds = new Set(shells.map((r) => r.orderId));
        const unfired = visible.filter(
          (r) => r.derivedStatus === "DRAFT" && !shellIds.has(r.orderId),
        );
        return [...shells, ...unfired];
      }
      return serverScopedFilter ? (scopedQuery.data?.data ?? []) : visible;
    })();

    return source.filter((row) => {
      if (statusFilter === "PAID" && row.paymentStatus !== "PAID") return false;
      if (
        statusFilter !== "ALL" &&
        statusFilter !== "PAID" &&
        !isServerScopedFilter(statusFilter) &&
        row.derivedStatus !== statusFilter
      ) {
        return false;
      }
      if (!viewAll && row.cashierId !== userId) return false;
      return matchesFacets(row, typeFilter, paymentFilter);
    });
  }, [
    isSearching,
    searchQuery.data,
    serverScopedFilter,
    scopedQuery.data,
    visible,
    statusFilter,
    typeFilter,
    paymentFilter,
    viewAll,
    userId,
  ]);

  /**
   * The stat line, computed from `filtered` — the SAME array handed to the grid below, never a
   * second read. See `order-list-stats.ts` for why that is the whole point of it.
   */
  const stats = useMemo(() => summariseOrders(filtered), [filtered]);

  /**
   * The column grammar (38-06 task 1, DEMO-SCREENS §5).
   *
   * <h3>What changed and why it is not a reshuffle</h3>
   *
   * The list used to open with one column headed **"Order / Type"** holding the order number on
   * top of `"Dine-in · H1"` — three different facts stacked in one cell, none of them sortable,
   * none of them scannable down a column. The demo supplies the grammar this screen was missing:
   *
   * ```
   * Order#  Table  Items  Type  Time  Prep  Total  Status
   * ```
   *
   * Each column now answers exactly one question, which is what makes a list scannable: the eye
   * runs DOWN a column comparing like with like, and it cannot do that when two facts share a
   * cell and one of them is sometimes absent.
   *
   * <h3>Two badges, never one badge doing two jobs</h3>
   *
   * `Type` and `Status` are separate badge columns. They were previously the same cell, so a
   * dine-in check with no table read "Takeaway" (F2) — one badge carrying two meanings is how a
   * surface starts stating things it does not know. `Payment` is a third, independent axis and
   * keeps its own column: settlement status and payment status are different facts and a check
   * can be SERVED and UNPAID at the same time.
   *
   * <h3>Prep is `lib/format/elapsed.ts`, not a fourth age formatter</h3>
   *
   * The removed `formatAge` was this codebase's THIRD hand-rolled elapsed formatter
   * (`station-picker.tsx` and `kds-aging.ts` were the other two, and they disagreed by design —
   * that is the whole subject of `elapsed.ts`'s docblock). It was also unbounded: a check left
   * open over a close rendered `113h 52m`, which is true and useless. `readElapsed` stops
   * counting at 24 h and prints the DATE instead, and returns `withinUrgencyWindow` so the shape
   * of the text — timer vs date — carries the boundary without colour (D-38-13).
   *
   * <h3>Identifiers are mono, money is accent</h3>
   *
   * The demo's money/identifier formatting is adopted verbatim: `.td-mono` on the order number so
   * digits align down the column and a transposed one is visible, and the total in `--primary`,
   * which is the text/link accent role. Money renders through `MoneyDisplay` and nowhere else.
   */
  const columns = useMemo<ColumnDef<OrderSummary, unknown>[]>(
    () => [
      {
        id: "orderNo",
        header: "Order #",
        accessorFn: (row: OrderSummary) => row.orderNo ?? "",
        cell: ({ row }) => {
          const { text, isReal } = orderIdentifier(row.original.orderNo);
          return (
            <span
              data-testid={`order-no-${row.original.orderId}`}
              className={cn(
                "font-medium",
                isReal ? "font-mono tracking-tight" : "text-foreground-secondary italic",
              )}
            >
              {text}
            </span>
          );
        },
      },
      {
        id: "table",
        header: "Table",
        accessorFn: (row: OrderSummary) => row.tableName ?? "",
        cell: ({ row }) =>
          row.original.tableName ? (
            <span className="text-small">{row.original.tableName}</span>
          ) : (
            <span className="text-small text-foreground-tertiary" aria-label="No table">
              {ELAPSED_UNKNOWN}
            </span>
          ),
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
              <span className="text-small tabular-nums">
                {qty} {qty === 1 ? "item" : "items"}
              </span>
              {lines !== qty && (
                <span className="text-label text-foreground-secondary tabular-nums">
                  {lines} {lines === 1 ? "line" : "lines"}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "type",
        header: "Type",
        // F2 (b). This read `{o.tableName ?? "Takeaway"}` — the order's own `type` was never
        // consulted because the summary row never carried it. Every DINE_IN check without a
        // table therefore read "Takeaway": measured 2026-08-12, ten of ten rows on the first
        // page and thirteen consecutive rows on the Voided chip, on a screen a manager scans
        // all day. The type is server-authoritative and now has its own column, so it can never
        // again be inferred from whether a table happens to be assigned.
        cell: ({ row }) => (
          <span
            data-testid="order-type-cell"
            className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-label font-medium text-foreground-secondary"
          >
            {orderTypeLabel(row.original.type)}
          </span>
        ),
      },
      {
        id: "time",
        header: "Time",
        accessorFn: (row: OrderSummary) => (row.openedAt ? new Date(row.openedAt).getTime() : 0),
        cell: ({ row }) => (
          <span className="text-small tabular-nums text-foreground-secondary">
            {formatOpenedClock(row.original.openedAt)}
          </span>
        ),
      },
      {
        id: "prep",
        header: "Prep",
        cell: ({ row }) => <PrepCell openedAt={row.original.openedAt} now={now} />,
      },
      {
        id: "total",
        header: "Total",
        accessorFn: (row: OrderSummary) => row.totalPaisa,
        cell: ({ row }) => (
          // The demo's `.td-mono .text-primary`. `--primary` is the TEXT/link accent role — not
          // `--primary-solid`, which is the fill role and would paint a bronze block behind the
          // number in light mode.
          <MoneyDisplay paisa={row.original.totalPaisa} className="text-small text-primary" />
        ),
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
        // "Server/Cashier", not the tidier "Server". Nine F2 diagnostic journeys locate this
        // column by `headers.findIndex(h => /Server\/Cashier/i.test(h))` — e2e/floor/f2-01,
        // -04, -05, -09 (×2), -10, -11, -12 and f2-reopen-attempt. Renaming the header would
        // silently return -1 in each, and a column index of -1 reads an undefined cell, i.e.
        // every one of those checks would report an empty cashier and pass its "no hex fragment"
        // assertion for the wrong reason. The header is the journeys' selector; it is not
        // cosmetic.
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
              <span className="text-small" data-testid={`cashier-cell-${row.original.orderId}`}>
                {cashierName}
              </span>
            );
          }
          if (cashierId) {
            return (
              <span
                className="font-mono text-label text-foreground-secondary"
                data-testid={`cashier-cell-${row.original.orderId}`}
                title="This person's name could not be looked up just now — this is their user id."
              >
                {cashierId.slice(0, 8)}
              </span>
            );
          }
          return (
            <span
              className="text-label text-foreground-tertiary"
              data-testid={`cashier-cell-${row.original.orderId}`}
            >
              {ELAPSED_UNKNOWN}
            </span>
          );
        },
      },
      // S0-04. Only on the Voided/Refunded chips: on every other view every row would be
      // blank, and a permanently-empty column is worse than no column (DESIGN-BRIEF §23).
      // The register's finding was not only that a void was unreachable but that nothing in
      // the product could say WHY it happened or WHO did it — this column is that answer.
      ...(serverScopedFilter === "VOIDED" || serverScopedFilter === "REFUNDED"
        ? [
            {
              id: "settlement",
              header: serverScopedFilter === "VOIDED" ? "Voided" : "Refunded",
              cell: ({ row }: { row: { original: OrderSummary } }) => (
                <SettlementDetailCell order={row.original} />
              ),
            } as ColumnDef<OrderSummary, unknown>,
          ]
        : []),
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
                className="text-label font-medium text-primary underline"
              >
                {isDraft ? "Continue" : "Open"}
              </button>
            </div>
          );
        },
      },
    ],
    [serverScopedFilter, now],
  );

  const showEmptyState = !isLoading && filtered.length === 0;

  return (
    <div className="flex h-full flex-col gap-(--space-sm) p-(--space-md)">
      {/*
        Title + `·`-separated stat line — the demo's back-office header grammar (DEMO-SCREENS §5,
        D-38-15 "adopt").

        The title is an <h2>, NOT an <h1>. `app/(tenant)/app/pos/page.tsx` already renders the
        route's one (sr-only) <h1> "Point of sale", and gate G12a asserts exactly one per route —
        a PageHeader here would make it two. It is also rendered at the label role rather than a
        20px page title on purpose: this is a full-bleed `operational` surface where vertical
        space is the scarce resource, and the visible tab immediately above already says "Order
        Management" to sighted users. The <h2> restores the region's name in the outline without
        spending the pixels twice.

        Every figure on the stat line is computed from `filtered` — the array handed to the grid
        below — so all three reconcile against columns a reader can count. See
        `order-list-stats.ts` for what is deliberately NOT claimed here.
      */}
      <div className="flex flex-wrap items-baseline gap-x-(--space-md) gap-y-1">
        <h2 className="text-label font-semibold tracking-wide uppercase text-foreground-secondary">
          Order management
        </h2>
        <p
          data-testid="order-stat-line"
          className="flex flex-wrap items-baseline gap-x-1.5 text-small text-foreground-secondary"
          aria-live="polite"
        >
          <span className="tabular-nums">{orderCountLabel(stats.listed)}</span>
          <span aria-hidden="true" className="text-foreground-tertiary">
            ·
          </span>
          {/* Money has exactly one formatting path in this product (money-display.tsx). */}
          <MoneyDisplay paisa={stats.totalPaisa} className="text-small text-primary" />
          <span>across them</span>
          <span aria-hidden="true" className="text-foreground-tertiary">
            ·
          </span>
          <span className="tabular-nums">{unpaidLabel(stats.unpaid)}</span>
        </p>
      </div>

      {/*
        The shared filter strip (UI-SPEC §7.3). `bare` because this is an operational tab that is
        already inside the POS shell — the card variant would add a second border ring around a
        strip that sits directly above a bordered grid.

        The status CHIPS stay chips rather than becoming a fourth <Select>. They carry
        `data-testid="status-filter-*"`, which sixteen e2e journeys drive, and a chip row is the
        right control for a nine-value axis a cashier switches constantly on a touch screen. They
        are passed as `children`, which is exactly what `extraActiveCount` exists for — the count
        sentence and "Clear all" then cover controls FilterBar cannot see, instead of offering a
        Clear that silently leaves three filters on.
      */}
      <FilterBar
        variant="bare"
        filters={[
          {
            id: "order-type",
            label: "Type",
            value: typeFilter,
            onChange: (value) => setTypeFilter(value as "" | OrderType),
            options: TYPE_FILTER_OPTIONS,
            allLabel: "All types",
          },
          {
            id: "payment-status",
            label: "Payment",
            value: paymentFilter,
            onChange: (value) => setPaymentFilter(value as "" | PaymentStatus),
            options: PAYMENT_FILTER_OPTIONS,
            allLabel: "All payment states",
          },
        ]}
        extraActiveCount={
          (statusFilter === "ALL" ? 0 : 1) + (search.trim() === "" ? 0 : 1) + (viewAll ? 0 : 1)
        }
        onClearAll={() => {
          setStatusFilter("ALL");
          setTypeFilter("");
          setPaymentFilter("");
          setSearch("");
          setViewAll(true);
        }}
        actions={
          <div className="flex flex-wrap items-center gap-(--space-sm)">
            {/*
              Search box. S0-05: this asks the SERVER, which searches order number, table name and
              the attached customer's phone/name across EVERY status and every page — so a check
              you have just voided is found by typing its number, with no chip to switch first.
              It used to be a substring filter over the rows already on screen, which could not
              reach a voided order, a closed one, or anything past the first page.

              It stays this component's own <Input> rather than FilterBar's `search` slot for one
              reason: `data-testid="order-management-search"`, which the S0-05 wire tests and the
              diagnostic journeys drive. FilterBar generates its own ids and has no testid seam.
            */}
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order #, table or phone…"
              aria-label="Search orders"
              data-testid="order-management-search"
              /*
                `h-11`, not `h-9`. UI-SPEC §9.2 / plan 38-04 task 4: every interactive target on
                an operational surface is at least 44×44, and `/app/pos` was measured at 0
                violations at 390/768/1440. `h-9` is 36px — this box was ADDED at 36 after that
                measurement, so the count was 0 only because nobody re-measured. `Input`'s own
                base is `h-8`; the class here is what decides, and twMerge lets it win.
              */
              className="h-11 max-w-56"
            />

            {/* My Orders / All Branch — permission-gated, never a disabled control (UI-SPEC §1) */}
            <PermissionGuard require={ALL_BRANCH_PERMISSION}>
              <div className="flex items-center gap-1 rounded-full border p-1 text-label">
                <button
                  type="button"
                  onClick={() => setViewAll(false)}
                  data-testid="toggle-my-orders"
                  className={cn(
                    "rounded-full px-3 py-1.5 font-medium transition-colors",
                    !viewAll
                      ? "bg-primary-solid text-primary-solid-foreground"
                      : "text-foreground-secondary",
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
                    viewAll
                      ? "bg-primary-solid text-primary-solid-foreground"
                      : "text-foreground-secondary",
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
              /*
                `min-h-11` (44px), not `min-h-9` (36px) — same §9.2 floor as the status chips
                below, which were raised to `min-h-11` in the very same change that moved this
                button up here and left it at 36.
              */
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-2 text-label font-medium text-foreground-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        }
      >
        {/* Status filter chips — reuses menu-grid.tsx's category-pill visual pattern */}
        <div
          role="group"
          aria-label="Filter orders by status"
          className="flex flex-wrap gap-(--space-sm)"
        >
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={statusFilter === f.id}
              onClick={() => setStatusFilter(f.id)}
              data-testid={`status-filter-${f.id}`}
              className={cn(
                "min-h-11 rounded-full px-4 py-2 text-small font-medium transition-colors",
                statusFilter === f.id
                  ? "bg-primary-solid text-primary-solid-foreground"
                  : "bg-surface-2 text-foreground-secondary hover:bg-surface-3",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </FilterBar>

      {/*
        S0-04. The chip row cannot silently mean something narrower than it says. "Active"
        shows live orders only; the register found a voided check appearing under NONE of the
        chips, and the honest fix is both to add the chips that can find it AND to say on the
        screen where it went, in the one place someone is looking when they cannot find it.
      */}
      <p
        data-testid="order-scope-note"
        className="w-full text-label text-foreground-secondary"
        aria-live="polite"
      >
        {serverScopedFilter ? SCOPE_NOTE[serverScopedFilter] : ACTIVE_SCOPE_NOTE}
      </p>

      {/*
        S0-05 — what the rows on screen actually are while a search is running. Two honest
        statements, and both matter: the search ignores the chips (so nobody reads the result
        as "the Active list, narrowed"), and it says out loud when there are more matches than
        this page holds, rather than showing a prefix that looks complete.
      */}
      {isSearching && (
        <p
          data-testid="order-search-scope-note"
          className="text-label text-foreground-secondary"
          aria-live="polite"
        >
          {`Searching every order — live, closed, voided and refunded — for “${debouncedSearch}”.`}
          {/*
            "Listing", not "Showing". 38-06 put this list on `DataGrid`, which pages at 25 — so
            of a hundred fetched matches only twenty-five are on screen at once, and the older
            word would have been the third number on this screen making a claim the grid does not
            back. `listed` is the same word the stat line above uses for the same quantity, and
            the grid's own `Page N of M · 100 rows` line says how it is divided up.
          */}
          {searchTruncated
            ? ` Listing the first ${filtered.length} of ${searchTotal} matches; narrow the search to see the rest.`
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
          ) : serverScopedFilter ? (
            // A server-scoped view's empty state must not read "No active orders" — that copy
            // told a manager who had just voided a check that their void had vanished. The CTA
            // is per-filter rather than always-on: an empty Draft list is a fine place to start
            // an order, an empty Voided list is not (design brief §26 — say what to do NEXT,
            // which means the next step has to be a real one).
            <EmptyState
              title={EMPTY_SCOPED_COPY[serverScopedFilter].title}
              description={EMPTY_SCOPED_COPY[serverScopedFilter].description}
              action={
                EMPTY_SCOPED_COPY[serverScopedFilter].goToPos
                  ? {
                      label: "Go to POS",
                      onClick: () => onFullMenu?.({ orderId: null, tableId: null }),
                    }
                  : undefined
              }
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
          /*
            The shared grid (UI-SPEC §7). What this buys over the `DataTable` it replaces, on
            THIS screen: a sticky header (measured `static` on 12 of 12 tables product-wide, so
            scrolling past row 12 lost every column meaning), one 44px row height instead of the
            audit's 65-81px pair, and pagination — the search page fetches up to 100 rows and
            used to render all of them in one ungated list.

            No `card` renderer is passed, deliberately: DataGrid keeps BOTH branches in the DOM
            and lets CSS pick, so a card list duplicates every row's text. That is correct on a
            back-office route and is recorded as owed here rather than taken silently — see the
            38-06 report.

            No `bulkActions`/`getRowId` either: row selection without a bulk operation is a
            control that cannot do anything, and pos-service exposes no bulk order endpoint.
          */
          <DataGrid
            columns={columns}
            data={filtered}
            isLoading={isLoading}
            density="comfortable"
            pageSize={25}
            label="Orders"
            emptyTitle={
              isSearching
                ? "No orders match that search"
                : serverScopedFilter
                  ? EMPTY_SCOPED_COPY[serverScopedFilter].title
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
              className="min-w-0 truncate text-left text-small underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {recordedReason}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80"
            data-testid={`settlement-reason-full-${order.orderId}`}
          >
            <p className="text-small break-words whitespace-normal">{recordedReason}</p>
            <p className="mt-2 text-label break-words whitespace-normal text-foreground-secondary">
              {byline}
            </p>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="truncate text-small text-foreground-secondary">{reason}</span>
      )}
      <span className="truncate text-label text-foreground-secondary" title={byline}>
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
      className="text-label font-medium text-primary underline disabled:cursor-not-allowed disabled:opacity-50"
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
          className="text-label font-medium text-destructive underline disabled:opacity-50"
        >
          {voidOrder.isPending ? "Cancelling…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={voidOrder.isPending}
          className="text-label text-foreground-secondary underline"
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
      className="text-label font-medium text-destructive underline"
    >
      Cancel
    </button>
  );
}
