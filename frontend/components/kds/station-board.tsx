"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutGrid, Radio, RotateCcw, SearchX } from "lucide-react";

import {
  useKdsTickets,
  useKdsStations,
  useRecallTicket,
  useUpdateItemStatus,
} from "@/lib/hooks/kds/use-kds-tickets";
import { useKdsSocket } from "@/lib/hooks/kds/use-kds-socket";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { KdsClockProvider, useKdsClock } from "@/lib/hooks/kds/use-kds-clock";
import { computeKdsCounts, itemLabel, ticketLabel } from "@/components/kds/kds-counts";
import {
  KdsItemColumn,
  KDS_COLUMN_ORDER,
  fragmentKey,
  getNextItemStatus,
  groupTicketsByColumn,
  mapItemStatusToColumn,
  type KdsColumnKey,
} from "@/components/kds/kds-item-column";
import { T_H1, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { ZoneProvider } from "@/components/providers/zone-provider";
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

/**
 * The jump keys a bump bar sends, in board order — `1`–`9` then `0` for the tenth (§7.2).
 * Exported so a test can assert the page never outgrows them.
 */
export const KDS_JUMP_KEYS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/**
 * Fragments per page, board-wide.
 *
 * This is NOT a layout constant. It is exactly the number of jump keys, and that identity is
 * the whole point: §7.2 requires that **every ticket carries a visible position number**,
 * because the number IS what makes number-key jump work, and a bump bar has no other way to
 * reach a card. When the page could hold more fragments than there are keys — it held sixteen
 * against ten keys — the surplus cards rendered with `pos:""`: visible, unreachable, and
 * indistinguishable at a glance from a card whose number you simply cannot read from 2 m.
 * Tying the two together makes an unnumbered card structurally impossible rather than
 * something to remember, which is why `positionOf` below can no longer return `undefined`
 * for a card that is on the page.
 */
const PAGE_SIZE = KDS_JUMP_KEYS.length;

/**
 * Interleaves per-column fragment lists so a page is FAIR across columns.
 *
 * The board used to build one flat list by concatenating whole columns in
 * New→Started→Preparing→Ready order and slicing it into pages. That made "page 1 is entirely
 * New" a structural certainty the moment New held a page's worth of work, so a cook bumping a
 * ticket watched it leave the screen and the three progress columns in front of them stayed
 * permanently empty. Measured live before this fix: `p1 NEW 16 / STARTED 0 / PREPARING 0 /
 * READY 0`, `p2` identical, all the started work stranded on `p3`.
 *
 * Taking one fragment from each column in turn — rank 1 of every column, then rank 2, and so
 * on — means page 1 always holds the HEAD of every queue, which is exactly what a cook acts
 * on, and a bumped ticket re-enters at rank 1 of its new column and therefore stays on page 1.
 * A bigger `PAGE_SIZE` would not have fixed this; it only moves the cliff.
 *
 * Exported for station-board-paging.test.ts.
 */
export function interleaveColumns<T>(columns: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const depth = columns.reduce((max, c) => Math.max(max, c.length), 0);
  for (let rank = 0; rank < depth; rank += 1) {
    for (const column of columns) {
      const fragment = column[rank];
      if (fragment !== undefined) out.push(fragment);
    }
  }
  return out;
}

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
  // Same shared clock the picker reads. `useKdsClock` works above its own provider
  // (it falls back to the module-level store), which is what lets the header count
  // be derived here rather than inside the provider subtree.
  const now = useKdsClock();

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
   * Every open fragment, bucketed by column and each bucket in board sort order.
   * `activeTickets` is already sorted, and `groupTicketsByColumn` preserves that order,
   * so a bucket's index IS the fragment's rank in its own queue.
   */
  const fragmentsByColumn = useMemo(() => {
    const map = new Map<KdsColumnKey, BoardFragmentRef[]>();
    for (const column of visibleColumns) {
      map.set(
        column,
        groupTicketsByColumn(activeTickets, column).map(({ ticket, items }) => ({
          column,
          ticket,
          itemIds: items.map((i) => i.id),
          itemStatuses: items.map((i) => ({ id: i.id, status: i.status })),
        })),
      );
    }
    return map;
  }, [activeTickets, visibleColumns]);

  /**
   * The header's numbers, from the SAME helper the station picker reads.
   *
   * This line used to be `allFragments.length` — the flattened ticket×column FRAGMENT list —
   * printed under the word "tickets". Two consequences, both measured live on 2026-08-12:
   * the header disagreed with the picker tile that had just sent the cook here (DEFAULT
   * 111 against 120), and **bumping one item of a two-item check changed the total**, because
   * splitting a ticket across two columns creates a second fragment. A number that moves when
   * nothing arrived and nothing left is worse than no number.
   *
   * Counted over `tickets`, not `visibleColumns`: hiding the Ready column is a view
   * preference, and a station's queue depth must not depend on it — otherwise pressing `V`
   * would "lose" tickets and the tile the cook came from would be wrong again.
   */
  const counts = useMemo(() => computeKdsCounts(tickets, now), [tickets, now]);

  /**
   * Which fragments this page holds — chosen round-robin across columns so no column can be
   * starved by a busier one (see `interleaveColumns`). SELECTION is round-robin; ORDER within
   * the page is not — see `pageFragments`.
   */
  const pagedFragments = useMemo(
    () => interleaveColumns(visibleColumns.map((c) => fragmentsByColumn.get(c) ?? [])),
    [fragmentsByColumn, visibleColumns],
  );

  const pageCount = Math.max(1, Math.ceil(pagedFragments.length / PAGE_SIZE));

  /**
   * The page the board is actually showing — DERIVED, like focus, and for the same reason.
   *
   * Normally it is the page the cook last turned to. But when focus is on a fragment that is
   * not on that page, the board FOLLOWS the fragment. That case has exactly one cause: a bump
   * just moved the focused fragment into another column, and that column's own sort put it
   * beyond this page.
   *
   * A fair page layout is not enough on its own here, and measuring it is what proved that: with
   * fair paging alone, two of four consecutive mouse bumps still landed off the cook's page,
   * because Started was twelve deep and the bumped ticket sorted fifth in it. Fair paging
   * guarantees a column is never STARVED; only following the focus guarantees the cook sees the
   * result of the key they just pressed. "It worked, on a page behind you" is the whole defect.
   *
   * `page` stays the cook's own choice and is never written from here — deriving instead of
   * repairing means there is no frame in which the board shows a page that has no focus on it.
   */
  const focusedIndex = focusedKey
    ? pagedFragments.findIndex((f) => fragmentKey(f.column, f.ticket.id) === focusedKey)
    : -1;
  const safePage =
    focusedIndex >= 0 ? Math.floor(focusedIndex / PAGE_SIZE) : Math.min(page, pageCount - 1);

  /**
   * The page, back in the board's reading order: top→bottom within a column, then
   * left→right (§7.2). Round-robin decides WHICH ten fragments the cook sees; it must not
   * decide the order they are numbered and traversed in, or `↑`/`↓` would zig-zag across
   * columns and the position numbers would run 1,2,3,4 across the top row. `Array.sort` is
   * stable, so sorting the slice by column index leaves each column's own rank order intact.
   */
  const pageFragments = useMemo(() => {
    const slice = pagedFragments.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    const rankOf = (c: KdsColumnKey) => visibleColumns.indexOf(c);
    return slice.sort((a, b) => rankOf(a.column) - rankOf(b.column));
  }, [pagedFragments, safePage, visibleColumns]);

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

  /**
   * The number printed on the card, and the key that jumps to it: 1–9 then 0 for the tenth.
   *
   * `PAGE_SIZE === KDS_JUMP_KEYS.length`, so every fragment ON the page has one. The
   * `undefined` arm is now reachable only for a key that is not on this page at all — which
   * is a caller error, not a card the cook can see. It used to be reachable for the 11th
   * through 16th card of every page, and that is precisely the `pos:""` the audit measured.
   */
  const positionOf = useCallback(
    (key: string): number | undefined => {
      const index = pageKeys.indexOf(key);
      if (index < 0 || index >= KDS_JUMP_KEYS.length) return undefined;
      return Number(KDS_JUMP_KEYS[index]);
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
      // Focus moves to where the ticket is GOING, not where it was. Every item of a fragment
      // is in one column by construction, so they all land in the same next one. The board
      // follows this key (see `safePage`), which is what makes a bump visible to the cook
      // even when the destination column is deeper than a page.
      const destination = mapItemStatusToColumn(moves[0]!.next);
      if (destination) setFocusedKey(fragmentKey(destination, fragment.ticket.id));

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
        // Stepping from `safePage`, not from `page`: after a bump the board may be following
        // focus onto a page the cook never chose, and a functional `p => p + 1` would step
        // from the page they last chose instead of the one in front of them.
        case "PageDown":
          event.preventDefault();
          setPage(Math.min(pageCount - 1, safePage + 1));
          setFocusedKey(null);
          return;
        case "PageUp":
          event.preventDefault();
          setPage(Math.max(0, safePage - 1));
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
      // The jump keys read from the SAME table the position badges are printed from, so a
      // key can never address a slot the board did not draw a number on.
      const jumpIndex = KDS_JUMP_KEYS.indexOf(event.key);
      if (jumpIndex >= 0 && jumpIndex < pageKeys.length) {
        event.preventDefault();
        setFocusedKey(pageKeys[jumpIndex] ?? null);
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
    safePage,
    stationCode,
  ]);

  const failed = ticketsQuery.isError ? ticketsQuery : stationsQuery.isError ? stationsQuery : null;
  const isPending = ticketsQuery.isPending || stationsQuery.isPending;

  /*
   * A URL segment that names no station this caller can open.
   *
   * `/app/kitchen/NOPE123` used to render a fully healthy-looking board: `<h1>NOPE123</h1>`,
   * "0 tickets", and a green LIVE badge — because the route passed the raw path segment straight
   * to the ticket query, which answers an empty page for any code, and the WebSocket subscribes to
   * any code too. A typo was therefore indistinguishable from a real, quiet station, on a screen
   * whose entire job is to tell a cook whether there is work.
   *
   * Ordering is the whole of the correctness here, and it is the same rule the error notice below
   * follows: FAILED first, then PENDING, and only then "not in the list". Asking "is this code in
   * the list?" while the list is still loading, or after the list request has FAILED, would turn a
   * kitchen-service outage into a confident "no such station" — trading one lie for a worse one.
   *
   * The PENDING arm returns EARLY, above the header, rather than falling through to the header's
   * own `station?.name ?? stationCode` fallback. Otherwise the first paint of `/app/kitchen/NOPE123`
   * is the exact defective screen — heading "NOPE123", "0 tickets", a green LIVE badge — for as
   * long as the station list takes, and a wall display that flashes the wrong answer before the
   * right one has told the cook the wrong answer.
   */
  const stationUnknown = !failed && !stationsQuery.isPending && !station;

  if (!failed && stationsQuery.isPending) {
    return (
      <ZoneProvider zone="operational" asChild>
        <div
          data-surface="kds"
          data-zone="operational"
          data-testid="kds-station-resolving"
          className="flex min-h-screen items-center justify-center bg-kds-surface text-kds-muted"
        >
          <p className={T_H1}>Loading station…</p>
        </div>
      </ZoneProvider>
    );
  }

  if (stationUnknown) {
    return (
      <ZoneProvider zone="operational" asChild>
        <div
          data-surface="kds"
          data-zone="operational"
          data-testid="kds-station-unknown"
          className="flex min-h-screen flex-col items-center justify-center gap-4 bg-kds-surface p-6 text-center text-kds-text"
        >
          {/*
            NOT the shared <EmptyState>. Its title is `text-foreground` and its icon disc is
            `bg-surface-2` — both follow the office manager's light/dark preference, while this
            surface is `data-surface="kds"` and therefore permanently dark (§3.7). Rendered
            through EmptyState, this screen's own screenshot showed near-black text on a
            near-black board: the state was present in the DOM and unreadable on the wall, which
            is the same class of failure as not shipping it. Built on the kds tokens instead, so
            the contrast is a property of the surface rather than of the viewer's theme.
          */}
          <div
            aria-hidden="true"
            className="flex size-20 items-center justify-center rounded-full bg-kds-card"
          >
            <SearchX className="size-9 text-kds-muted" aria-hidden="true" />
          </div>
          <div className="flex max-w-xl flex-col gap-1">
            <p data-testid="kds-station-unknown-title" className={cn("font-bold text-kds-text", T_H1)}>
              No such station
            </p>
            <p className={cn("text-kds-muted", T_SMALL)}>
              {`This branch has no active station with the code "${stationCode}", or it is not one of yours. Check the code, or pick a board from all stations.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/app/kitchen")}
            data-testid="kds-unknown-all-stations"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-2 font-semibold text-kds-text",
              T_LABEL,
            )}
          >
            <LayoutGrid className="size-3.5" aria-hidden="true" />
            All stations
          </button>
        </div>
      </ZoneProvider>
    );
  }

  return (
    <KdsClockProvider>
      {/*
       * ZONE: operational (D-34-02). `asChild` because the board root below is a
       * full-height flex column and an extra wrapper box breaks it; the attribute
       * goes on the existing element and the provider supplies only the context half.
       *
       * `data-surface="kds"` and `data-zone="operational"` sit side by side and mean
       * DIFFERENT things. `data-surface` says this screen is permanently dark and does
       * not follow the office manager's theme preference (§3.7). `data-zone` says no
       * compositing filter and no decorative motion may reach it — a board is read at
       * two metres across a hot kitchen and repainting it costs a cook time.
       */}
      <ZoneProvider zone="operational" asChild>
        <div
          data-surface="kds"
          data-zone="operational"
          data-testid="kds-board"
          className="flex min-h-screen flex-col gap-3 bg-kds-surface p-3 text-kds-text"
        >
          {/*
           * ── 48px header (§7.2) ─────────────────────────────────────────────
           *
           * `min-h-12` + `flex-wrap`, not `h-12`. On kitchen hardware (1440/1920) nothing
           * wraps and the header is exactly the 48px §7.2 asks for. Below that it did not
           * merely look tight — it PAINTED ON ITSELF. Measured on this board at 390px and
           * 768px by painted extent (`left + scrollWidth`, not box extent, which reports
           * every one of these as fine):
           *
           *   390px  "22 tickets" × "1 / 3", "22 tickets" × "READY COLUMN",
           *          "33 items" × "READY COLUMN", the station <select> × "All stations",
           *          the station <select> × "LIVE"
           *   768px  "33 items" × "1 / 3", the <select> × "READY COLUMN" / "All stations"
           *
           * A fixed-height row cannot hold a station name, two counts, a station switcher,
           * a page indicator and three controls at 390px, and `justify-between` resolves
           * that by letting them slide over one another. Wrapping is the honest answer;
           * nothing is hidden and nothing is dropped, the row just becomes two rows.
           */}
          <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-kds-card px-3 py-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className={cn("truncate font-bold tracking-wide text-kds-text", T_H1)}>
                {station?.name ?? stationCode}
              </h1>
              {/*
                Two figures, each carrying its own unit, because "tickets" alone was the
                ambiguity: the picker meant checks and the board meant cards. A cook reads
                "108 tickets · 134 items" as "a hundred and eight checks, a hundred and
                thirty-four dishes", and both figures are the ones the tile they just tapped
                showed them.
              */}
              <span
                data-testid="kds-ticket-count"
                className={cn("shrink-0 font-bold tabular-nums text-kds-muted", T_SMALL)}
              >
                {ticketLabel(counts.ticketCount)}
              </span>
              <span
                aria-hidden="true"
                className={cn("shrink-0 text-kds-muted opacity-50", T_SMALL)}
              >
                ·
              </span>
              <span
                data-testid="kds-item-count"
                className={cn("shrink-0 font-bold tabular-nums text-kds-muted", T_SMALL)}
              >
                {itemLabel(counts.itemCount)}
              </span>
              <StationSwitcher
                stations={activeStations}
                currentCode={stationCode}
                onSelect={(code) => router.push(`/app/kitchen/${code}`)}
              />
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
                  /*
                   * The column header counts the WHOLE queue, not this page's slice of it.
                   * Showing the slice was the second half of the same lie: "Started 0" on a
                   * board with five started tickets reads as "nothing is in progress", which
                   * is the one thing a cook must never be told wrongly.
                   *
                   * Read from the shared helper rather than from `fragmentsByColumn`, which is
                   * the same number by construction — so the picker's per-stage split and this
                   * one cannot drift apart again the way 97-NEW-here / 76-NEW-there did.
                   */
                  totalCount={counts.columnTickets[column]}
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
      </ZoneProvider>
    </KdsClockProvider>
  );
}
