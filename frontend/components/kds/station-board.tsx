"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutGrid, Radio, RotateCcw } from "lucide-react";

import {
  useKdsTickets,
  useKdsStations,
  useRecallTicket,
  useUpdateItemStatus,
} from "@/lib/hooks/kds/use-kds-tickets";
import { useKdsSocket } from "@/lib/hooks/kds/use-kds-socket";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { KdsClockProvider } from "@/lib/hooks/kds/use-kds-clock";
import {
  KdsItemColumn,
  KDS_COLUMN_ORDER,
  fragmentKey,
  getNextItemStatus,
  groupTicketsByColumn,
  type KdsColumnKey,
} from "@/components/kds/kds-item-column";
import { T_H1, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import type { KdsTicket } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";

/**
 * Deterministic, stable board sort: receivedAt DESCENDING (newest ticket first, so a new
 * order always lands at the top of its column), ties broken by ticket.id. A pure function of
 * each ticket's immutable receivedAt/id — never looks at mutable per-item status — so a card's
 * position never changes when only its items' statuses update within an already-rendered
 * ticket. Exported for kds-board-sort.test.ts.
 */
export function sortKdsTickets<T extends Pick<KdsTicket, "id" | "receivedAt">>(
  tickets: readonly T[],
): T[] {
  return [...tickets].sort((a, b) => {
    const diff = b.receivedAt.getTime() - a.receivedAt.getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

interface StationBoardProps {
  branchId: string;
  stationCode: string;
}

/** Fragments per page, board-wide. Sized so four columns fit a 1080p wall screen. */
const PAGE_SIZE = 16;

/** How long `R` can still recall the last bumped ticket (§7.2). */
const RECALL_WINDOW_MS = 60_000;

/** The optimistic collapse before the card leaves the board (§7.2 — the one animation). */
const BUMP_COLLAPSE_MS = 400;

interface StationSwitcherProps {
  stations: { code: string; name: string }[];
  currentCode: string;
  onSelect: (code: string) => void;
}

/**
 * Station switcher — lets a terminal "reflect"/switch which station's board it shows
 * without going back to the picker. Native <select> for reliable touch behaviour on
 * kitchen hardware; hidden when the branch has a single station.
 */
function StationSwitcher({ stations, currentCode, onSelect }: StationSwitcherProps) {
  if (stations.length <= 1) return null;
  return (
    <div className="relative">
      <select
        value={currentCode}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Switch station"
        data-testid="kds-station-switcher"
        className={cn(
          "appearance-none rounded-md border border-white/20 bg-kds-card py-1 pl-2.5 pr-7 font-medium text-kds-text",
          T_SMALL,
        )}
      >
        {stations.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 top-1/2 size-4 -translate-y-1/2 text-kds-muted"
        aria-hidden="true"
      />
    </div>
  );
}

interface BoardFragmentRef {
  column: KdsColumnKey;
  ticket: KdsTicket;
  itemIds: string[];
  itemStatuses: { id: string; status: KdsTicket["items"][number]["status"] }[];
}

/**
 * Station-isolated KDS board (UI-SPEC §7.2), rebuilt on the phase-20 design system.
 *
 * <h3>Three things this screen did not have and a kitchen needs</h3>
 *
 * **1. It could not tell "no tickets" from "kitchen-service is down."** The old board
 * destructured `{ data: tickets = [], isLoading }` and never looked at `isError` — the exact
 * shape GA-001 catalogued across eleven list screens. A cook whose kitchen-service had lost
 * its Eureka lease saw a calm, empty, four-column board and would have kept cooking nothing.
 * That is the single worst lie this product can tell, on the screen where it costs most.
 * `QueryErrorNotice` now renders instead, with a retry, and it is announced (`role="alert"`).
 *
 * **2. There was no focus.** UI-SPEC §7.2 is blunt about why that matters: USB bump bars
 * enumerate as HID keyboards, so keyboard bindings ARE bump-bar support. Without a persistent
 * focused-ticket concept — distinct from hover, which a bump bar cannot produce — none of
 * `↑ ↓ 1-9 Enter F` can mean anything. Focus now lives on the board (not the column, because
 * `↑`/`↓` traverse ACROSS columns and a column-owned focus could never hand off at its edge),
 * every ticket shows the position number that makes number-key jump work, and moving focus
 * calls `scrollIntoView({ block: "nearest" })`.
 *
 * That last call is not politeness. Phase 20 measured (`globals.css:520`) that Chromium
 * **clips `outline` under `overflow: hidden` and `overflow: auto`** — correcting the spec's
 * own claim that it does not. This board is a scroll container and the focus ring is an
 * outline, so without the scroll the focused ticket can be focused, and invisible.
 *
 * **3. Sixteen hard-coded colours.** All now `[data-surface="kds"]` tokens, applied at this
 * root so the whole subtree resolves them. KDS is permanently dark regardless of theme —
 * a line cook's wall screen does not follow the office manager's colour preference.
 */
export function StationBoard({ branchId, stationCode }: StationBoardProps) {
  const router = useRouter();
  const ticketsQuery = useKdsTickets(branchId, stationCode);
  const stationsQuery = useKdsStations(branchId);
  const { isConnected } = useKdsSocket({ branchId, stationCode });
  const { permissions } = useCurrentUser();
  const canUpdate = permissions.includes("pos.kds.update");
  const updateItemStatus = useUpdateItemStatus(branchId);
  const recallTicket = useRecallTicket(branchId);

  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);

  const station = stations.find((s) => s.code === stationCode);
  const activeStations = useMemo(() => stations.filter((s) => s.active), [stations]);

  // Active board = everything not terminal. READY tickets STAY visible (in the Ready column)
  // until the order is served/closed — the ORDER_CLOSED consumer flips them to SERVED, which
  // (with CANCELLED) is what drops them off the board.
  const activeTickets = useMemo(
    () => sortKdsTickets(tickets.filter((t) => t.status !== "SERVED" && t.status !== "CANCELLED")),
    [tickets],
  );

  // ── Board state ────────────────────────────────────────────────────────────
  const [showReady, setShowReady] = useState(true);
  const [page, setPage] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [bumpingKeys, setBumpingKeys] = useState<string[]>([]);
  const [bumpError, setBumpError] = useState<string | null>(null);
  const [lastBumped, setLastBumped] = useState<{ ticketId: string; at: number } | null>(null);

  const visibleColumns = useMemo(
    () => KDS_COLUMN_ORDER.filter((c) => showReady || c !== "READY"),
    [showReady],
  );

  /**
   * The board's traversal order: top→bottom within a column, then left→right (§7.2).
   * Flattened once here so `↑`/`↓`, the position numbers and paging all read the SAME
   * sequence — three orderings computed separately is three orderings that drift.
   */
  const allFragments = useMemo(() => {
    const out: BoardFragmentRef[] = [];
    for (const column of visibleColumns) {
      for (const { ticket, items } of groupTicketsByColumn(activeTickets, column)) {
        out.push({
          column,
          ticket,
          itemIds: items.map((i) => i.id),
          itemStatuses: items.map((i) => ({ id: i.id, status: i.status })),
        });
      }
    }
    return out;
  }, [activeTickets, visibleColumns]);

  const pageCount = Math.max(1, Math.ceil(allFragments.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageFragments = useMemo(
    () => allFragments.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [allFragments, safePage],
  );
  const pageKeys = useMemo(
    () => pageFragments.map((f) => fragmentKey(f.column, f.ticket.id)),
    [pageFragments],
  );

  /** Ticket ids on this page, per column — the columns render only the current page. */
  const pageTicketsByColumn = useMemo(() => {
    const map = new Map<KdsColumnKey, KdsTicket[]>();
    for (const f of pageFragments) {
      const list = map.get(f.column) ?? [];
      list.push(f.ticket);
      map.set(f.column, list);
    }
    return map;
  }, [pageFragments]);

  /** 1–9 then 0 for the tenth. Past that a ticket has no number and no jump key. */
  const positionOf = useCallback(
    (key: string): number | undefined => {
      const index = pageKeys.indexOf(key);
      if (index < 0 || index > 9) return undefined;
      return index === 9 ? 0 : index + 1;
    },
    [pageKeys],
  );

  // ── Focus, and the scroll that makes an outline visible ────────────────────
  const fragmentRefs = useRef(new Map<string, HTMLDivElement>());
  const registerFragmentRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) fragmentRefs.current.set(key, el);
    else fragmentRefs.current.delete(key);
  }, []);

  /**
   * Focus is DERIVED, not repaired.
   *
   * The obvious implementation is an effect that notices `focusedKey` has gone stale — a
   * bumped ticket left, a page turned, a socket push reordered the board — and calls
   * `setFocusedKey` to fix it. That is a cascading render (the React Compiler rejects it
   * outright, `react-hooks/set-state-in-effect`) and it has a real failure mode too: for one
   * paint the board renders with a focus key that points at nothing, so the outline vanishes
   * and reappears. Deriving it means there is never a frame in which focus is invalid.
   */
  const effectiveFocusedKey =
    focusedKey && pageKeys.includes(focusedKey) ? focusedKey : (pageKeys[0] ?? null);

  useEffect(() => {
    if (!effectiveFocusedKey) return;
    const el = fragmentRefs.current.get(effectiveFocusedKey);
    // `block: "nearest"` — Chromium clips `outline` inside an `overflow` container
    // (measured, phase 20), so a focused-but-off-screen ticket is a focused-but-INVISIBLE
    // ticket. Scrolling the minimum keeps the rest of the board where the cook left it.
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [effectiveFocusedKey]);

  // ── Bump (F) ───────────────────────────────────────────────────────────────
  const bumpFragment = useCallback(
    (key: string) => {
      if (!canUpdate) return;
      const fragment = pageFragments.find((f) => fragmentKey(f.column, f.ticket.id) === key);
      if (!fragment) return;
      const moves = fragment.itemStatuses
        .map((i) => ({ id: i.id, next: getNextItemStatus(i.status) }))
        .filter((m): m is { id: string; next: NonNullable<typeof m.next> } => m.next !== null);
      if (moves.length === 0) return;

      setBumpError(null);
      setBumpingKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setLastBumped({ ticketId: fragment.ticket.id, at: Date.now() });

      for (const move of moves) {
        updateItemStatus.mutate(
          { ticketId: fragment.ticket.id, itemId: move.id, status: move.next },
          {
            onError: (error) => {
              // The card comes BACK on failure. An optimistic bump that silently swallows
              // a rejection is a ticket the kitchen believes it sent and the pass never sees.
              setBumpingKeys((prev) => prev.filter((k) => k !== key));
              setBumpError(
                `${fragment.ticket.orderNo ?? fragment.ticket.id.slice(0, 8)} — not bumped. ${
                  error instanceof Error ? error.message : "Try again."
                }`,
              );
            },
          },
        );
      }
      window.setTimeout(() => {
        setBumpingKeys((prev) => prev.filter((k) => k !== key));
      }, BUMP_COLLAPSE_MS);
    },
    [canUpdate, pageFragments, updateItemStatus],
  );

  const recallLast = useCallback(() => {
    if (!canUpdate || !lastBumped) return;
    if (Date.now() - lastBumped.at > RECALL_WINDOW_MS) {
      setBumpError("Nothing to recall — the 60-second window has passed.");
      return;
    }
    setBumpError(null);
    recallTicket.mutate(
      { ticketId: lastBumped.ticketId },
      {
        onError: () =>
          // kitchen-service only recalls a ticket whose every item reached READY
          // (TicketServiceImpl:139) and rejects every backward ITEM transition
          // (validateTransition:271). Say so rather than pretending the key did nothing.
          setBumpError("Can't recall — only a fully ready ticket can be pulled back."),
      },
    );
  }, [canUpdate, lastBumped, recallTicket]);

  // ── The bump bar ───────────────────────────────────────────────────────────
  const moveFocus = useCallback(
    (delta: number) => {
      if (pageKeys.length === 0) return;
      const current = effectiveFocusedKey ? pageKeys.indexOf(effectiveFocusedKey) : -1;
      const next = Math.min(pageKeys.length - 1, Math.max(0, current + delta));
      setFocusedKey(pageKeys[next] ?? null);
    },
    [effectiveFocusedKey, pageKeys],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // A bump bar is a keyboard, and so is the keyboard. Never steal a keystroke that
      // a human is typing into a field — the station switcher is a real <select>.
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.closest("[role='dialog']"))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(1);
          return;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(-1);
          return;
        case "PageDown":
          event.preventDefault();
          setPage((p) => Math.min(pageCount - 1, p + 1));
          setFocusedKey(null);
          return;
        case "PageUp":
          event.preventDefault();
          setPage((p) => Math.max(0, p - 1));
          setFocusedKey(null);
          return;
        case "Enter":
          if (effectiveFocusedKey) {
            const fragment = pageFragments.find(
              (f) => fragmentKey(f.column, f.ticket.id) === effectiveFocusedKey,
            );
            if (fragment) {
              event.preventDefault();
              router.push(`/app/kitchen/${stationCode}/orders/${fragment.ticket.id}`);
            }
          }
          return;
        default:
          break;
      }

      const key = event.key.toLowerCase();
      if (key === "f") {
        if (effectiveFocusedKey) {
          event.preventDefault();
          bumpFragment(effectiveFocusedKey);
        }
        return;
      }
      if (key === "r") {
        event.preventDefault();
        recallLast();
        return;
      }
      if (key === "v") {
        event.preventDefault();
        setShowReady((v) => !v);
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        const index = event.key === "0" ? 9 : Number(event.key) - 1;
        if (index < pageKeys.length) {
          event.preventDefault();
          setFocusedKey(pageKeys[index] ?? null);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    bumpFragment,
    effectiveFocusedKey,
    moveFocus,
    pageCount,
    pageFragments,
    pageKeys,
    recallLast,
    router,
    stationCode,
  ]);

  const failed = ticketsQuery.isError ? ticketsQuery : stationsQuery.isError ? stationsQuery : null;
  const isPending = ticketsQuery.isPending || stationsQuery.isPending;

  return (
    <KdsClockProvider>
      <div
        data-surface="kds"
        data-testid="kds-board"
        className="flex min-h-screen flex-col gap-3 bg-kds-surface p-3 text-kds-text"
      >
        {/* ── 48px header (§7.2) ───────────────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 rounded-lg border border-white/10 bg-kds-card px-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className={cn("truncate font-bold tracking-wide text-kds-text", T_H1)}>
              {station?.name ?? stationCode}
            </h1>
            <span
              data-testid="kds-ticket-count"
              className={cn("shrink-0 font-bold tabular-nums text-kds-muted", T_SMALL)}
            >
              {allFragments.length} {allFragments.length === 1 ? "ticket" : "tickets"}
            </span>
            <StationSwitcher
              stations={activeStations}
              currentCode={stationCode}
              onSelect={(code) => router.push(`/app/kitchen/${code}`)}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pageCount > 1 && (
              <span
                data-testid="kds-page-indicator"
                className={cn("font-bold tabular-nums text-kds-muted", T_SMALL)}
              >
                {safePage + 1} / {pageCount}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowReady((v) => !v)}
              aria-pressed={showReady}
              data-testid="kds-toggle-ready"
              className={cn(
                "rounded-md border border-white/20 px-2 py-1 font-semibold uppercase tracking-wide text-kds-text",
                T_LABEL,
                showReady && "bg-white/10",
              )}
            >
              Ready column
            </button>
            <button
              type="button"
              onClick={() => router.push("/app/kitchen")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2 py-1 font-semibold text-kds-text",
                T_LABEL,
              )}
              data-testid="kds-all-stations"
            >
              <LayoutGrid className="size-3.5" aria-hidden="true" />
              All stations
            </button>
            {/* Connection state carries an ICON and a WORD, never a coloured dot alone. */}
            <span
              data-testid="kds-connection"
              data-connected={isConnected ? "true" : "false"}
              className={cn(
                "inline-flex items-center gap-1 font-bold uppercase tracking-wide",
                T_LABEL,
                isConnected ? "text-kds-fresh" : "text-kds-warn",
              )}
            >
              <Radio className="size-3.5" aria-hidden="true" />
              {isConnected ? "Live" : "Polling"}
            </span>
          </div>
        </header>

        {bumpError && (
          <div
            role="alert"
            data-testid="kds-bump-error"
            className={cn(
              "flex items-center gap-2 rounded-md border border-kds-late bg-kds-late-fill px-3 py-2 font-semibold text-kds-text",
              T_SMALL,
            )}
          >
            <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
            {bumpError}
          </div>
        )}

        {/* ── The board ─────────────────────────────────────────────────────── */}
        {failed ? (
          // Never an empty board on failure. GA-001, on the screen where it matters most.
          <QueryErrorNotice
            what="the kitchen board"
            error={failed.error}
            isRetrying={ticketsQuery.isFetching || stationsQuery.isFetching}
            onRetry={() => {
              ticketsQuery.refetch();
              stationsQuery.refetch();
            }}
          />
        ) : isPending ? (
          <p className={cn("p-6 text-kds-muted", T_H1)} data-testid="kds-board-loading">
            Loading station…
          </p>
        ) : (
          <div
            data-testid="kds-board-scroll"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              // 2 columns at 1024, 3 at 1440, 4 at 1920 (§7.2). Never horizontal scroll.
              "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
            )}
          >
            {visibleColumns.map((column) => (
              <KdsItemColumn
                key={column}
                column={column}
                tickets={pageTicketsByColumn.get(column) ?? []}
                branchId={branchId}
                canUpdate={canUpdate}
                escalationThresholdSeconds={station?.escalationThresholdSeconds}
                focusedKey={effectiveFocusedKey ?? undefined}
                collapsingKeys={bumpingKeys}
                positionOf={positionOf}
                registerFragmentRef={registerFragmentRef}
                onFocusFragment={setFocusedKey}
              />
            ))}
          </div>
        )}

        {/* The key map, on the screen. A bump bar has no tooltips. */}
        <footer
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-1 text-kds-muted",
            T_LABEL,
          )}
        >
          <span>↑ ↓ move</span>
          <span>1–9 0 jump</span>
          <span>Enter open</span>
          {canUpdate && <span>F bump</span>}
          {canUpdate && <span>R recall</span>}
          <span>V ready column</span>
          {pageCount > 1 && <span>PgUp/PgDn page</span>}
        </footer>

        {/* Announce the bump to a screen reader; the collapse animation says nothing. */}
        <span className="sr-only" role="status" aria-live="polite">
          {bumpingKeys.length > 0 ? "Ticket bumped" : ""}
        </span>
      </div>
    </KdsClockProvider>
  );
}
