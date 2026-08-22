"use client";

import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, LayoutGrid } from "lucide-react";

import {
  useClearedKdsTickets,
  useKdsStations,
  useStaleKdsTickets,
} from "@/lib/hooks/kds/use-kds-tickets";
import { useKdsClock, KdsClockProvider } from "@/lib/hooks/kds/use-kds-clock";
import { formatElapsedLong } from "@/lib/format/elapsed";
import { T_BODY, T_H1, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { itemLabel, ticketLabel } from "@/components/kds/kds-counts";
import { mapItemStatusToColumn } from "@/components/kds/kds-item-column";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { ZoneProvider } from "@/components/providers/zone-provider";
import type { KdsTicket } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";

/**
 * The tickets that have been cleared off this board (F17) — the half of "cleared, not deleted"
 * that a person can actually check.
 *
 * <p>Without this screen the claim is unfalsifiable from the product: the rows exist, and the only
 * way to see them is an HTTP call, which is not a thing a cook does. That is the exact shape both
 * audit reports keep finding — the data is there and no screen shows any of it. So the record has a
 * screen, reachable from the confirmation that created it.
 *
 * <p>Read-only on purpose. There is no un-clear button: a ticket that needs to come back comes back
 * by the POS firing it again, which re-opens the same ticket (kitchen-service
 * TicketRoutingService). An "undo" here would be a second way to change a ticket's state that the
 * order knows nothing about.
 */
interface KdsClearedBoardProps {
  branchId: string;
  stationCode: string;
}

const FIRED_AT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

/**
 * Every clock time on this page is printed on the BRANCH's wall clock, not the reader's.
 *
 * A KDS terminal is physically in the kitchen, so the two are usually the same and this looks
 * like ceremony. They are not the same for the manager reading it from head office, and "fired
 * 03:59" against a trading day that opens at 04:00 is exactly the reading on which somebody
 * decides whether a clear was correct. The product has already shipped one screen whose times
 * disagreed with another screen's for precisely this reason.
 */
function atBranch(at: Date, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-GB", timeZone ? { timeZone, ...FIRED_AT } : FIRED_AT).format(
      at,
    );
  } catch {
    return new Intl.DateTimeFormat("en-GB", FIRED_AT).format(at);
  }
}

export function KdsClearedBoard({ branchId, stationCode }: KdsClearedBoardProps) {
  const router = useRouter();
  const clearedQuery = useClearedKdsTickets(branchId, stationCode);
  const stationsQuery = useKdsStations(branchId);
  // Read purely for `branchTimezone` — the branch's own answer to "which clock", from the same
  // endpoint that computed the boundary these tickets were cleared against, so the two can never
  // disagree. Cheap, cached for 15s, and gated on pos.kds.view like this page.
  const branchZone = useStaleKdsTickets(branchId, stationCode).data?.branchTimezone;

  return (
    <KdsClockProvider>
      <ZoneProvider zone="operational" asChild>
        <div
          data-surface="kds"
          data-zone="operational"
          data-testid="kds-cleared-board"
          // `h-full min-h-0`, never `min-h-screen`: inside the tenant shell `<main>` is already the
          // viewport less the top bar, so a 100vh minimum is taller than its own container and the
          // shell grows a second scrollbar that scrolls the board away from a cook who meant to
          // scroll a column. The route supplies the height via `<PageBody fullBleed>` (38-05 task 2).
          className="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-kds-surface p-3 text-kds-text"
        >
          <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-kds-card px-3 py-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className={cn("truncate font-bold tracking-wide text-kds-text", T_H1)}>
                Cleared —{" "}
                {stationsQuery.data?.find((s) => s.code === stationCode)?.name ?? stationCode}
              </h1>
              {clearedQuery.data && (
                <span
                  data-testid="kds-cleared-count"
                  className={cn("shrink-0 font-bold tabular-nums text-kds-muted", T_SMALL)}
                >
                  {ticketLabel(clearedQuery.data.length)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => router.push(`/app/kitchen/${stationCode}`)}
                data-testid="kds-cleared-back"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2 py-1 font-semibold text-kds-text",
                  T_LABEL,
                )}
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to the board
              </button>
              <button
                type="button"
                onClick={() => router.push("/app/kitchen")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2 py-1 font-semibold text-kds-text",
                  T_LABEL,
                )}
              >
                <LayoutGrid className="size-3.5" aria-hidden="true" />
                All stations
              </button>
            </div>
          </header>

          {clearedQuery.isError ? (
            <QueryErrorNotice
              what="the cleared tickets"
              error={clearedQuery.error}
              isRetrying={clearedQuery.isFetching}
              onRetry={() => clearedQuery.refetch()}
            />
          ) : clearedQuery.isPending ? (
            /*
              STILL, not pulsing (D-38-04). This list loads on a kitchen terminal inside the
              `operational` zone, and `animate-pulse` here was a perpetual decorative animation
              that only looked harmless because the evidence probe counted running animations
              after the query had already settled. `<Skeleton>` reads the zone and does not
              move; the fill stays on the board's own `--kds-card` rather than `--muted`, which
              follows the office manager's light/dark preference on a permanently dark surface.
            */
            <ul className="flex flex-col gap-2" data-testid="kds-cleared-loading">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} aria-hidden="true">
                  <Skeleton className="h-14 rounded-lg border border-white/10 bg-kds-card" />
                </li>
              ))}
              <li className="sr-only" role="status" aria-live="polite">
                Loading cleared tickets…
              </li>
            </ul>
          ) : clearedQuery.data.length === 0 ? (
            <ClearedEmpty
              stationCode={stationCode}
              onBack={() => router.push(`/app/kitchen/${stationCode}`)}
            />
          ) : (
            <ClearedList tickets={clearedQuery.data} branchZone={branchZone} />
          )}
        </div>
      </ZoneProvider>
    </KdsClockProvider>
  );
}

function ClearedEmpty({ stationCode, onBack }: { stationCode: string; onBack: () => void }) {
  return (
    /*
     * NOT the shared <EmptyState>. Its title is `text-foreground` and its icon disc is
     * `bg-surface-2`, both of which follow the office manager's light/dark preference — on this
     * permanently dark surface that renders near-black on near-black. Same reasoning, and the same
     * measured failure, as the board's "No such station" state.
     */
    <div
      data-testid="kds-cleared-empty"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <div
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full bg-kds-card"
      >
        <Archive className="size-9 text-kds-muted" aria-hidden="true" />
      </div>
      <div className="flex max-w-xl flex-col gap-1">
        <p className={cn("font-bold text-kds-text", T_H1)}>Nothing has been cleared here</p>
        <p className={cn("text-kds-muted", T_SMALL)}>
          {`No ticket on ${stationCode} has been aged off the board. When a board is carrying tickets from a
          trading day that has closed, "Clear old" appears on it and what you clear is listed here.`}
        </p>
      </div>
      <button
        type="button"
        onClick={onBack}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-2 font-semibold text-kds-text",
          T_LABEL,
        )}
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to the board
      </button>
    </div>
  );
}

/**
 * Lines still to cook when the ticket was cleared — the SAME question the confirmation counted.
 *
 * Not `items.length`. A ticket whose every line had already been served still carries those lines,
 * so the total would print "1 item" here against the "0 items" the cook read one screen earlier,
 * and the walkthrough's finding #12 is precisely one cell stating the item count twice, differently.
 * `mapItemStatusToColumn` returning null is the renderer's own definition of "no live work left",
 * so asking it is the same question rather than a second opinion about it.
 */
function liveItemCount(ticket: KdsTicket): number {
  return ticket.items.filter((i) => mapItemStatusToColumn(i.status) !== null).length;
}

function ClearedList({ tickets, branchZone }: { tickets: KdsTicket[]; branchZone?: string }) {
  const now = useKdsClock();
  const sorted = [...tickets].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  return (
    <ul
      data-testid="kds-cleared-list"
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
    >
      {sorted.map((ticket) => (
        <li
          key={ticket.id}
          data-testid="kds-cleared-row"
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-white/10 bg-kds-card px-3 py-2"
        >
          <span className={cn("font-bold text-kds-text", T_BODY)}>
            {ticket.orderNo ?? ticket.id.slice(0, 8)}
            <span className={cn("ml-2 font-normal text-kds-muted", T_SMALL)}>
              {ticket.tableNumber ? `Table ${ticket.tableNumber}` : "No table"} ·{" "}
              {itemLabel(liveItemCount(ticket))}
              {ticket.items.length > liveItemCount(ticket)
                ? ` (${ticket.items.length - liveItemCount(ticket)} already done)`
                : ""}
            </span>
          </span>
          <span className={cn("text-kds-muted", T_SMALL)}>
            Fired {atBranch(ticket.receivedAt, branchZone)} ·{" "}
            {formatElapsedLong(ticket.receivedAt, now, { timeZone: branchZone })} old
            {ticket.clearedAt ? ` · cleared ${atBranch(ticket.clearedAt, branchZone)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
