"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Archive, Loader2, RotateCcw } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatElapsedLong } from "@/lib/format/elapsed";
import { T_BODY, T_H1, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { itemLabel, ticketLabel } from "@/components/kds/kds-counts";
import { useClearStaleKdsTickets, useStaleKdsTickets } from "@/lib/hooks/kds/use-kds-tickets";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useKdsClock } from "@/lib/hooks/kds/use-kds-clock";
import { formatUserFacingError } from "@/lib/errors";
import type { KdsStaleBoardSummary } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";

/**
 * "Clear old tickets" — the control that ages a board's dead work off it (F17).
 *
 * <h3>The defect</h3>
 *
 * Nothing ever took a ticket off a KDS board except the POS closing, serving or voiding its order,
 * so an order that never closed left its ticket on the wall forever. Measured live on 2026-08-12 as
 * `kitchen@terrace.local`, branch F-7, station DEFAULT: 75 active tickets paginated 1/7, **ten of
 * them received on 2026-08-07** — 123 hours earlier — at the head of the queue. There was no bulk
 * clear, no expiry, and no way for a cook to reach a clean board the next morning.
 *
 * <h3>Why the trigger disappears when there is nothing to clear</h3>
 *
 * A wall display read across a hot kitchen has no room for a control that does nothing, and a
 * "Clear old (0)" button invites the press that teaches a cook the button is meaningless. The
 * trigger renders only when the server says this board is carrying tickets from a closed business
 * day, and it carries the count, so its presence IS the notification. When the check itself fails
 * the control says so with a retry — an error must never wear an empty state's clothes, which on
 * this screen would read as "your board is clean".
 *
 * <h3>What the confirmation has to say, and why</h3>
 *
 * A cook is being asked to take work off a screen. "Clear 10 tickets?" is not enough information to
 * say yes to, so the dialog states the count, the oldest ticket's age AND its order number, the
 * split by trading day, and — the part that is load-bearing — **the boundary it will apply and the
 * time zone that boundary was cut on**. This product has already shipped a trading day cut in UTC
 * while the settings screen promised the branch's own zone; the failure was invisible precisely
 * because no screen ever said which boundary it had used. This one says it out loud.
 */
interface KdsClearStaleProps {
  branchId: string;
  /** The board being looked at. Omit for the branch-wide "all stations" sweep. */
  stationCode?: string;
  /** What to call this board in the confirmation — the station's name, not its code. */
  stationLabel?: string;
}

/** Format an instant on the BRANCH's clock, never the browser's. */
function inBranchZone(at: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(at);
  } catch {
    // An IANA name this browser does not know. Better a time in the reader's own zone than a
    // crashed dialog — and the zone name is printed beside it either way, so the reader can see
    // the two do not agree.
    return new Intl.DateTimeFormat("en-GB", options).format(at);
  }
}

const DAY_AND_TIME: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

export function KdsClearStale({ branchId, stationCode, stationLabel }: KdsClearStaleProps) {
  const { permissions } = useCurrentUser();
  const canUpdate = permissions.includes("pos.kds.update");
  const [open, setOpen] = useState(false);
  const now = useKdsClock();

  // Polled at a minute, not at the board's ten seconds: a ticket crosses the business-day
  // boundary once a day, and re-asking a wall display every ten seconds for an answer that
  // changes at 04:00 is work nobody needs.
  const staleQuery = useStaleKdsTickets(branchId, stationCode, {
    enabled: canUpdate,
    refetchInterval: 60_000,
  });
  const clear = useClearStaleKdsTickets(branchId, stationCode);

  if (!canUpdate) return null;

  /*
   * Every early return below is gated on the dialog being CLOSED, and that is load-bearing.
   *
   * A successful clear invalidates the whole `["kds", branchId]` subtree, so the stale summary
   * comes back with zero — and an unconditional `ticketCount === 0 → return null` unmounts this
   * component, taking the "1 ticket cleared" confirmation with it in the same frame the cook
   * pressed the button. The screen would blink and say nothing, which for a bulk action on a
   * kitchen display is indistinguishable from it having silently failed. Caught by
   * `kds-clear-stale.test.tsx`, which asserts the confirmation is READ, not merely rendered.
   */
  if (!open && staleQuery.isPending) {
    /*
     * STILL, not pulsing. This placeholder sits in the board's own header on a wall-mounted
     * kitchen screen, and the hand-rolled `animate-pulse` it replaces was a perpetual
     * decorative animation in the `operational` zone, which D-38-04 forbids. The stale check
     * is polled on a minute, so on a board that cannot reach the server the pulse never ends.
     * `<Skeleton>` reads the zone and sits still here; the fill is kept at the board's own
     * `white/10` rather than `--muted`, which follows the office theme and would render a
     * light block on a permanently dark surface.
     */
    return (
      <div data-testid="kds-clear-stale-loading" aria-hidden="true" className="shrink-0">
        <Skeleton className="h-6 w-24 bg-white/10" />
      </div>
    );
  }

  if (!open && staleQuery.isError) {
    return (
      <span
        role="alert"
        data-testid="kds-clear-stale-error"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-kds-late px-2 py-1 font-semibold text-kds-text",
          T_LABEL,
        )}
      >
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        Couldn&apos;t check for old tickets
        <button
          type="button"
          onClick={() => staleQuery.refetch()}
          data-testid="kds-clear-stale-retry"
          className="underline underline-offset-2"
        >
          {staleQuery.isFetching ? "Checking…" : "Retry"}
        </button>
      </span>
    );
  }

  const summary = staleQuery.data;
  const hasStale = !!summary && summary.ticketCount > 0;
  if (!open && !hasStale) return null;

  const boardName = stationLabel ?? stationCode ?? "this branch";
  const oldestTicket = summary?.tickets[0];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) clear.reset();
        // The numbers a cook is about to act on must be the numbers as they are NOW, not as they
        // were when the board loaded. Re-read on open, every time.
        if (next) staleQuery.refetch();
      }}
    >
      {hasStale && (
        <DialogTrigger asChild>
          <button
            type="button"
            data-testid="kds-clear-stale-trigger"
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-kds-warn px-3 py-2 font-semibold text-kds-text",
              T_LABEL,
            )}
          >
            <Archive className="size-3.5" aria-hidden="true" />
            Clear {summary?.ticketCount} old
          </button>
        </DialogTrigger>
      )}

      <DialogContent
        // The KDS colour tokens are scoped to `[data-surface="kds"]` and this content is
        // PORTALLED to document.body — outside the board's subtree. Without these two attributes
        // every `text-kds-*` and `bg-kds-*` below resolves to nothing and the dialog renders as
        // unstyled text on a transparent box. `data-zone` additionally keeps the overlay's glass
        // blur off a kitchen display (D-34-02); the zone is read at the TRIGGER's position, but
        // stamping it here too means the content itself is covered by the same rule.
        data-surface="kds"
        data-zone="operational"
        data-testid="kds-clear-stale-dialog"
        className="max-h-[85dvh] gap-3 overflow-y-auto border border-white/15 bg-kds-card text-kds-text ring-0 md:max-w-lg"
      >
        {clear.isSuccess ? (
          <SuccessView
            clearedTicketCount={clear.data.clearedTicketCount}
            clearedItemCount={clear.data.clearedItemCount}
            boardName={boardName}
            stationCode={stationCode}
            onClose={() => setOpen(false)}
          />
        ) : !summary || !hasStale ? (
          /*
           * The dialog is open and the board has nothing old on it. Reachable two ways: another
           * screen in the same kitchen cleared it while this one was reading, or the re-read on
           * open crossed the 04:00 boundary. Say which rather than showing "Clear 0 tickets" —
           * a control offering to do nothing is how a cook learns to distrust the count on its
           * face.
           */
          <>
            <DialogHeader>
              <DialogTitle className={cn("font-bold text-kds-text", T_H1)}>
                Nothing to clear
              </DialogTitle>
              <DialogDescription className={cn("text-kds-muted", T_BODY)}>
                {boardName} is carrying no tickets from a service that has already closed. Another
                screen may have cleared them a moment ago.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <DialogClose asChild>
                <button
                  type="button"
                  data-testid="kds-clear-stale-nothing"
                  className={cn(
                    "min-h-11 rounded-md border border-white/20 px-4 py-2 font-semibold text-kds-text",
                    T_LABEL,
                  )}
                >
                  Back to the board
                </button>
              </DialogClose>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className={cn("font-bold text-kds-text", T_H1)}>
                Clear {ticketLabel(summary.ticketCount)} from {boardName}?
              </DialogTitle>
              <DialogDescription className={cn("text-kds-muted", T_BODY)}>
                {`${ticketLabel(summary.ticketCount)} · ${itemLabel(summary.itemCount)} on this board were fired before today's service started.`}
                {summary.oldestReceivedAt ? (
                  <>
                    {" "}
                    The oldest has been up for{" "}
                    <strong className="font-bold text-kds-text">
                      {/*
                        `lib/format/elapsed.ts`, the one bounded formatter — not the board's
                        deleted `formatAgeLong`, which said `5d 3h` where every other surface
                        said `5d`. The branch's own zone, because past thirty days this prints
                        a DATE and a date in the reader's zone is the failure this dialog was
                        written to stop being invisible.
                      */}
                      {formatElapsedLong(summary.oldestReceivedAt, now, {
                        timeZone: summary.branchTimezone,
                      })}
                    </strong>
                    {oldestTicket?.orderNo ? ` — ${oldestTicket.orderNo}` : ""}, fired{" "}
                    {inBranchZone(summary.oldestReceivedAt, summary.branchTimezone, DAY_AND_TIME)}.
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            <BoundaryNotice summary={summary} />

            <DayBreakdown summary={summary} />

            <TicketList summary={summary} now={now} />

            {summary.finishedTicketCount > 0 && (
              <p className={cn("text-kds-muted", T_SMALL)} data-testid="kds-clear-stale-finished">
                {summary.finishedTicketCount} of these have no line left to cook — they were
                finished, but their order was never closed on the till, so the ticket never left.
              </p>
            )}

            <p className={cn("text-kds-muted", T_SMALL)}>
              Cleared tickets are kept, not deleted: they leave the board and stay on record. This
              does not void, close or settle the orders — that is still done on the order screen.
            </p>

            {clear.isError && (
              <p
                role="alert"
                data-testid="kds-clear-stale-failed"
                className={cn(
                  "flex items-center gap-2 rounded-md border border-kds-late bg-kds-late-fill px-3 py-2 font-semibold text-kds-text",
                  T_SMALL,
                )}
              >
                <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
                Nothing was cleared. {formatUserFacingError(clear.error)}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
              <DialogClose asChild>
                <button
                  type="button"
                  data-testid="kds-clear-stale-cancel"
                  className={cn(
                    "min-h-11 rounded-md border border-white/20 px-4 py-2 font-semibold text-kds-text",
                    T_SMALL,
                  )}
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                type="button"
                onClick={() => clear.mutate()}
                disabled={clear.isPending}
                data-testid="kds-clear-stale-confirm"
                className={cn(
                  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-kds-warn bg-white/10 px-4 py-2 font-bold text-kds-text disabled:opacity-60",
                  T_SMALL,
                )}
              >
                {clear.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Clearing…
                  </>
                ) : (
                  <>
                    <Archive className="size-3.5" aria-hidden="true" />
                    Clear {ticketLabel(summary.ticketCount)}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The boundary, in words, on the branch's clock — the half of this dialog nobody can check without. */
function BoundaryNotice({ summary }: { summary: KdsStaleBoardSummary }) {
  return (
    <p
      data-testid="kds-clear-stale-boundary"
      className={cn(
        "rounded-md border border-white/15 bg-black/20 px-3 py-2 text-kds-muted",
        T_SMALL,
      )}
    >
      Today&apos;s service started{" "}
      <strong className="font-bold text-kds-text">
        {inBranchZone(summary.currentBusinessDayStartedAt, summary.branchTimezone, DAY_AND_TIME)}
      </strong>{" "}
      ({summary.branchTimezone}). Nothing fired since then is touched.
    </p>
  );
}

function DayBreakdown({ summary }: { summary: KdsStaleBoardSummary }) {
  if (summary.days.length === 0) return null;
  return (
    <ul
      data-testid="kds-clear-stale-days"
      className={cn("flex flex-wrap gap-x-4 gap-y-1 text-kds-muted", T_SMALL)}
    >
      {summary.days.map((day) => (
        <li key={day.businessDate} className="tabular-nums">
          <span className="font-bold text-kds-text">{day.businessDate}</span> ·{" "}
          {ticketLabel(day.ticketCount)}
        </li>
      ))}
    </ul>
  );
}

function TicketList({ summary, now }: { summary: KdsStaleBoardSummary; now: number }) {
  return (
    <div className="min-h-0">
      <ul
        data-testid="kds-clear-stale-list"
        className="max-h-56 divide-y divide-white/10 overflow-y-auto rounded-md border border-white/10"
      >
        {summary.tickets.map((ticket) => (
          <li
            key={ticket.id}
            className={cn("flex items-baseline justify-between gap-3 px-3 py-1.5", T_SMALL)}
          >
            <span className="min-w-0 truncate font-bold text-kds-text">
              {ticket.orderNo ?? ticket.id.slice(0, 8)}
              <span className="ml-2 font-normal text-kds-muted">
                {ticket.tableNumber ? `Table ${ticket.tableNumber}` : "No table"} ·{" "}
                {itemLabel(ticket.itemCount)}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-kds-muted">
              {formatElapsedLong(ticket.receivedAt, now, { timeZone: summary.branchTimezone })}
            </span>
          </li>
        ))}
      </ul>
      {summary.ticketCount > summary.tickets.length && (
        <p className={cn("pt-1 text-kds-muted", T_LABEL)}>
          Showing the {summary.tickets.length} oldest of {summary.ticketCount}. All{" "}
          {summary.ticketCount} will be cleared.
        </p>
      )}
    </div>
  );
}

function SuccessView({
  clearedTicketCount,
  clearedItemCount,
  boardName,
  stationCode,
  onClose,
}: {
  clearedTicketCount: number;
  clearedItemCount: number;
  boardName: string;
  stationCode?: string;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className={cn("font-bold text-kds-text", T_H1)}>
          {ticketLabel(clearedTicketCount)} cleared
        </DialogTitle>
        <DialogDescription className={cn("text-kds-muted", T_BODY)}>
          {boardName} is back to today&apos;s work. {itemLabel(clearedItemCount)} went with them.
        </DialogDescription>
      </DialogHeader>
      {/* Announced, because the dialog's own heading change is silent to a screen reader. */}
      <p role="status" aria-live="polite" className="sr-only">
        {ticketLabel(clearedTicketCount)} cleared from {boardName}.
      </p>
      <p className={cn("text-kds-muted", T_SMALL)}>
        They were taken off the board, not deleted — every one is still on record with its order
        number and the time it was fired.
      </p>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        {stationCode && (
          <Link
            href={`/app/kitchen/${stationCode}/cleared`}
            data-testid="kds-clear-stale-view-cleared"
            className={cn(
              "min-h-11 rounded-md border border-white/20 px-4 py-2 text-center font-semibold text-kds-text",
              T_LABEL,
            )}
          >
            View cleared tickets
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          data-testid="kds-clear-stale-done"
          className={cn(
            "min-h-11 rounded-md border border-kds-fresh bg-white/10 px-4 py-2 font-bold text-kds-text",
            T_LABEL,
          )}
        >
          Back to the board
        </button>
      </div>
    </>
  );
}
