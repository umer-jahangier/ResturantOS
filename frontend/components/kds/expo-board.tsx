"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Flame,
  LayoutGrid,
  Loader2,
  Radio,
  UtensilsCrossed,
} from "lucide-react";

import {
  computeExpoChecks,
  expoHeadline,
  expoItemProgress,
  expoStationProgress,
  EXPO_STATION_STATE_LABELS,
  type ExpoCheck,
  type ExpoStationLine,
} from "@/components/kds/expo-checks";
import {
  DEFAULT_ESCALATION_THRESHOLD_SECONDS,
  getAgingTreatment,
  type KdsAgingIcon,
} from "@/components/kds/kds-aging";
import {
  getNextItemStatus,
  KDS_COLUMN_LABELS,
  mapItemStatusToColumn,
} from "@/components/kds/kds-item-column";
import { T_BODY, T_H1, T_H2, T_KDS, T_LABEL, T_SMALL } from "@/components/kds/kds-type";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { readElapsed } from "@/lib/format/elapsed";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { KdsClockProvider, useKdsClock } from "@/lib/hooks/kds/use-kds-clock";
import { useKdsExpoSocket } from "@/lib/hooks/kds/use-kds-expo-socket";
import {
  useKdsStations,
  useKdsTickets,
  useUpdateItemStatus,
} from "@/lib/hooks/kds/use-kds-tickets";
import type { KdsTicketItem } from "@/lib/models/kds.model";
import { cn } from "@/lib/utils";

const AGING_ICONS: Record<KdsAgingIcon, typeof Clock> = {
  clock: Clock,
  "alert-triangle": AlertTriangle,
  flame: Flame,
};

type ExpoFilter = "all" | "ready" | "outstanding";

const FILTER_LABELS: Record<ExpoFilter, string> = {
  all: "All checks",
  ready: "Ready to run",
  outstanding: "Still cooking",
};

function orderTypeLabel(orderType: string | null): string | null {
  switch (orderType) {
    case "DINE_IN":
      return "Dine-in";
    case "TAKEAWAY":
      return "Takeaway";
    case "PICKUP":
      return "Pickup";
    case "DELIVERY":
      return "Delivery";
    default:
      return null;
  }
}

/** The word the pass prints for a line's stage — the boards' own column labels, not new ones. */
function itemStageLabel(item: KdsTicketItem): string {
  const column = mapItemStatusToColumn(item.status);
  return column ? KDS_COLUMN_LABELS[column] : "";
}

interface ExpoStationRowProps {
  line: ExpoStationLine;
  canUpdate: boolean;
  busyItemIds: readonly string[];
  onAdvance: (line: ExpoStationLine, item: KdsTicketItem) => void;
}

/**
 * One station's part of one check.
 *
 * State is carried by an ICON, a WORD and a COUNT — never by colour alone. `kds-aging.ts`
 * measured `--kds-fresh` against `--kds-warn` at ΔE2000 8.3 under protanopia, the weakest
 * pairing in the system, and this screen is read across the same hot kitchen.
 */
function ExpoStationRow({ line, canUpdate, busyItemIds, onAdvance }: ExpoStationRowProps) {
  const ready = line.state === "ready";
  const StateIcon = ready ? CheckCircle2 : line.state === "cooking" ? Flame : Circle;

  return (
    <li
      data-testid={`expo-station-${line.stationCode}`}
      data-state={line.state}
      className={cn(
        "rounded-md border border-white/10 px-2.5 py-2",
        ready ? "bg-white/5" : "bg-black/20",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <StateIcon
            aria-hidden="true"
            className={cn("size-4 shrink-0", ready ? "text-kds-fresh" : "text-kds-warn")}
          />
          <span className={cn("truncate font-bold tracking-wide text-kds-text", T_H2)}>
            {line.stationCode}
          </span>
          {line.stationName !== line.stationCode && (
            <span className={cn("truncate text-kds-muted", T_SMALL)}>{line.stationName}</span>
          )}
        </span>
        <span
          data-testid={`expo-station-${line.stationCode}-state`}
          className={cn(
            "shrink-0 font-bold uppercase tracking-wide tabular-nums",
            T_LABEL,
            ready ? "text-kds-fresh" : "text-kds-warn",
          )}
        >
          {EXPO_STATION_STATE_LABELS[line.state]} · {line.readyCount} of {line.itemCount} ready
        </span>
      </div>

      <ul className="mt-1.5 flex flex-col gap-1">
        {line.items.map((item) => {
          const next = getNextItemStatus(item.status);
          const isReady = mapItemStatusToColumn(item.status) === "READY";
          const busy = busyItemIds.includes(item.id);
          return (
            <li
              key={item.id}
              data-testid={`expo-item-${item.id}`}
              data-ready={isReady ? "true" : "false"}
              className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className={cn("shrink-0 tabular-nums text-kds-muted", T_BODY)}>
                  {item.qty}×
                </span>
                <span className={cn("min-w-0 font-semibold text-kds-text", T_KDS)}>
                  {item.name}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "font-bold uppercase tracking-wide",
                    T_LABEL,
                    isReady ? "text-kds-fresh" : "text-kds-muted",
                  )}
                >
                  {itemStageLabel(item)}
                </span>
                {canUpdate && next && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAdvance(line, item)}
                    data-testid={`expo-advance-${item.id}`}
                    className={cn(
                      "inline-flex min-h-8 items-center gap-1 rounded-md border border-white/25 px-2 py-1 font-semibold text-kds-text disabled:opacity-50",
                      T_LABEL,
                    )}
                  >
                    {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                    {busy ? "Moving…" : `→ ${KDS_COLUMN_LABELS[mapItemStatusToColumn(next)!]}`}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

interface ExpoCheckCardProps {
  check: ExpoCheck;
  /** The same shared clock tick `check.ageMs` was measured against — never a second `now`. */
  now: number;
  canUpdate: boolean;
  busyItemIds: readonly string[];
  onAdvance: (line: ExpoStationLine, item: KdsTicketItem) => void;
}

function ExpoCheckCard({ check, now, canUpdate, busyItemIds, onAdvance }: ExpoCheckCardProps) {
  const aging = getAgingTreatment(check.ageMs, DEFAULT_ESCALATION_THRESHOLD_SECONDS, now);
  // Bounded, via the one formatter (`lib/format/elapsed.ts`). The pass used to print the
  // board's own `h:mm:ss` here, so a check left open over a close read `113:52:07` beside the
  // words STILL COOKING. Past 24 h it now names the day it was fired instead.
  const elapsed = readElapsed(check.receivedAt, now);
  // The check's ageing state is the WORST of its stations (each measured against its own
  // threshold) — `getAgingTreatment` above only supplies the icon/word/geometry vocabulary.
  const treatment = { ...aging, state: check.agingState };
  const AgingIcon = AGING_ICONS[aging.icon];
  const ready = check.state === "ready";
  const HeadlineIcon = ready ? CheckCircle2 : Flame;
  const typeLabel = orderTypeLabel(check.orderType);

  return (
    <article
      data-testid="expo-check"
      data-order-no={check.orderNo ?? ""}
      data-state={check.state}
      data-stations-owing={check.stationsOwing}
      data-aging={check.agingState}
      style={{ borderLeftWidth: `${treatment.borderWidthPx}px` }}
      className={cn(
        "flex flex-col rounded-lg border border-white/10",
        check.agingState === "late" ? "bg-kds-late-fill" : "bg-kds-card",
        check.agingState === "fresh" && "border-l-kds-fresh",
        check.agingState === "warn" && "border-l-kds-warn",
        check.agingState === "late" && "border-l-kds-late",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 pt-2.5 pb-1.5">
        <div className="flex min-w-0 flex-col">
          <h2 className={cn("truncate font-bold tracking-wide text-kds-text", T_H1)}>
            {check.orderNo ?? check.orderId.slice(0, 8)}
          </h2>
          <p className={cn("truncate text-kds-muted", T_SMALL)}>
            {[typeLabel, check.tableNumber ? `Table ${check.tableNumber}` : null]
              .filter(Boolean)
              .join(" · ") || "No table"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 font-bold tabular-nums",
            T_H2,
            check.agingState === "late"
              ? "text-kds-late"
              : check.agingState === "warn"
                ? "text-kds-warn"
                : "text-kds-fresh",
          )}
        >
          <AgingIcon className="size-4" aria-hidden="true" />
          {elapsed.compact}
          {treatment.chipSuffix && (
            <span className={cn("uppercase tracking-wide", T_LABEL)}>{treatment.chipSuffix}</span>
          )}
        </span>
      </header>

      {/* The sentence the walkthrough could not find anywhere in the product. */}
      <div
        data-testid="expo-check-headline"
        className={cn(
          "mx-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2.5 py-1.5",
          ready ? "bg-kds-fresh/15" : "bg-kds-warn/10",
        )}
      >
        <HeadlineIcon
          aria-hidden="true"
          className={cn("size-4 shrink-0", ready ? "text-kds-fresh" : "text-kds-warn")}
        />
        <span
          className={cn(
            "font-bold uppercase tracking-wide",
            T_H2,
            ready ? "text-kds-fresh" : "text-kds-warn",
          )}
        >
          {expoHeadline(check)}
        </span>
        <span data-testid="expo-check-progress" className={cn("text-kds-muted", T_SMALL)}>
          {expoStationProgress(check)} · {expoItemProgress(check)}
        </span>
      </div>

      {check.orderNotes?.trim() && (
        <p className={cn("mx-3 mt-1.5 rounded-md bg-black/30 px-2.5 py-1.5 text-kds-text", T_BODY)}>
          <span className={cn("mr-1.5 uppercase tracking-wide text-kds-muted", T_LABEL)}>
            Kitchen notes
          </span>
          {check.orderNotes}
        </p>
      )}

      <ul className="flex flex-col gap-1.5 p-3">
        {check.stations.map((line) => (
          <ExpoStationRow
            key={line.ticketId}
            line={line}
            canUpdate={canUpdate}
            busyItemIds={busyItemIds}
            onAdvance={onAdvance}
          />
        ))}
      </ul>
    </article>
  );
}

/**
 * §24 — a contextual skeleton at the real card's dimensions, not a spinner.
 *
 * The blocks are `<Skeleton>`, which is ZONE-AWARE, and this tree is `operational`. The
 * hand-rolled version wrapped each card in `animate-pulse`: a perpetual decorative animation
 * on a wall-mounted kitchen screen, which D-38-04 forbids outright in this zone. It read as
 * harmless in the evidence only because the probe waited for loading to finish before counting
 * running animations — the motion was real, it was just measured after it had stopped. On a
 * board whose tickets never load (an offline pass, a stalled query) it never stops at all.
 *
 * A flat `--muted` block still reads as a placeholder; the shimmer only ever added the
 * suggestion of progress, which is worth something on a manager's dashboard and nothing to an
 * expeditor waiting on the pass.
 */
function ExpoSkeleton() {
  return (
    <div
      data-testid="expo-skeleton"
      aria-hidden="true"
      className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border border-white/10 border-l-4 border-l-white/20 bg-kds-card p-3"
        >
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ))}
    </div>
  );
}

interface ExpoBoardProps {
  branchId: string;
}

/**
 * THE PASS — every open check, whole, across every station cooking part of it.
 *
 * <h3>What this screen exists to say</h3>
 *
 * "Table H1 is half ready, and DEFAULT is what is holding it up." The product could not say
 * that. Its KDS is station-isolated by construction — one ticket per (order, station), one
 * board per station, and a picker that aggregates per station — so the walkthrough watched a
 * check where PANTRY1 finished both its lines while DEFAULT never started the naan, and
 * nothing anywhere told anyone. The check was paid and closed before it was noticed.
 *
 * <h3>The rule</h3>
 *
 * A check <b>does not clear the pass until every station's lines are ready</b>
 * ({@link computeExpoChecks}) — and it does not clear even then: it turns into
 * <i>ready to run</i> and stays, at the top, until the order is served or closed on the POS,
 * which is what makes the ticket leave the boards too. A pass that emptied itself the moment
 * the food was ready would be a pass nobody could run food from.
 *
 * <h3>Station scope, said out loud</h3>
 *
 * kitchen-service narrows a branch-wide ticket read to the caller's assigned stations
 * (`KdsController` + `StationScope`). For a caller who HAS an assignment, that narrowing
 * would make this screen quietly wrong in the exact way it exists to fix — it would report a
 * check as fully ready while a station the caller cannot see still owed a dish. So an
 * assigned caller is told, plainly, that the pass cannot be trusted for them, instead of
 * being shown a confident and partial answer.
 */
export function ExpoBoard({ branchId }: ExpoBoardProps) {
  return (
    <KdsClockProvider>
      <ExpoBoardInner branchId={branchId} />
    </KdsClockProvider>
  );
}

function ExpoBoardInner({ branchId }: ExpoBoardProps) {
  const router = useRouter();
  const now = useKdsClock();
  const { permissions, attributes } = useCurrentUser();
  const stationsQuery = useKdsStations(branchId);
  const ticketsQuery = useKdsTickets(branchId);
  const updateItemStatus = useUpdateItemStatus(branchId);
  const [filter, setFilter] = useState<ExpoFilter>("all");
  const [busyItemIds, setBusyItemIds] = useState<readonly string[]>([]);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const stations = useMemo(
    () => (stationsQuery.data ?? []).filter((s) => s.active),
    [stationsQuery.data],
  );
  const stationCodes = useMemo(() => stations.map((s) => s.code), [stations]);
  const { isConnected, connectedCount, stationCount } = useKdsExpoSocket({
    branchId,
    stationCodes,
  });

  const checks = useMemo(
    () => computeExpoChecks(ticketsQuery.data ?? [], stations, now),
    [ticketsQuery.data, stations, now],
  );

  const readyCount = checks.filter((c) => c.state === "ready").length;
  const outstandingCount = checks.length - readyCount;
  const visible = useMemo(
    () =>
      filter === "all"
        ? checks
        : checks.filter((c) => (filter === "ready" ? c.state === "ready" : c.state !== "ready")),
    [checks, filter],
  );

  /**
   * The caller's own station assignment, read from their verified token. An assignment is
   * the one thing that makes a branch-wide read partial — see the class note.
   */
  const assignedStations = Array.isArray(attributes?.stations)
    ? (attributes.stations as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const canUpdate = permissions.includes("pos.kds.update");

  function advance(line: ExpoStationLine, item: KdsTicketItem) {
    const next = getNextItemStatus(item.status);
    if (!next) return;
    setAdvanceError(null);
    setBusyItemIds((prev) => [...prev, item.id]);
    updateItemStatus.mutate(
      { ticketId: line.ticketId, itemId: item.id, status: next },
      {
        onSettled: () => setBusyItemIds((prev) => prev.filter((id) => id !== item.id)),
        onError: (error) =>
          // Never swallow it. A pass that silently fails to move a line is a pass that
          // tells the expeditor food is ready when it is not.
          setAdvanceError(
            `${item.name} at ${line.stationCode} did not move. ${
              error instanceof Error ? error.message : "Try again."
            }`,
          ),
      },
    );
  }

  const failed = stationsQuery.isError ? stationsQuery : ticketsQuery.isError ? ticketsQuery : null;

  return (
    <ZoneProvider zone="operational" asChild>
      <div
        data-surface="kds"
        data-zone="operational"
        data-testid="expo-board"
        // `h-full min-h-0`, never `min-h-screen`: inside the tenant shell `<main>` is already the
        // viewport less the top bar, so a 100vh minimum is taller than its own container and the
        // shell grows a second scrollbar that scrolls the board away from a cook who meant to
        // scroll a column. The route supplies the height via `<PageBody fullBleed>` (38-05 task 2).
        className="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-kds-surface p-3 text-kds-text"
      >
        <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-kds-card px-3 py-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={cn("truncate font-bold tracking-wide text-kds-text", T_H1)}>The Pass</h1>
            <span
              data-testid="expo-check-count"
              className={cn("shrink-0 font-bold tabular-nums text-kds-muted", T_SMALL)}
            >
              {checks.length} {checks.length === 1 ? "check" : "checks"}
            </span>
            <span aria-hidden="true" className={cn("shrink-0 text-kds-muted opacity-50", T_SMALL)}>
              ·
            </span>
            <span
              data-testid="expo-ready-count"
              className={cn("shrink-0 font-bold tabular-nums text-kds-fresh", T_SMALL)}
            >
              {readyCount} ready to run
            </span>
          </div>
          {/*
            NOT `shrink-0`, and `flex-wrap` on the GROUP as well as on this row.

            The first cut of this header copied the station board's `flex shrink-0 flex-wrap`
            and put the three filter chips in a non-wrapping group. Measured on this screen by
            PAINTED extent (`getBoundingClientRect`, not box extent) at 390px: "All stations"
            ran to x=442 and the connection badge to x=492 against a header ending at x=374,
            and at 768px the badge ran to x=748 against x=744. `document.scrollWidth` equalled
            `clientWidth` at BOTH widths, so the page reported no horizontal overflow and the
            screenshot looked plausible — the controls were simply outside the row, painted and
            unreachable. That is the same class of failure the station board's own header
            comment records, and it is why this is measured per control rather than per page.

            `shrink-0` is what made it unfixable: a row that refuses to shrink cannot wrap its
            way out of being too wide. Dropped here, and the filter group wraps too, so at 390px
            the header becomes three short rows and every control stays inside it.
          */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div
              role="group"
              aria-label="Filter checks"
              className="flex min-w-0 flex-wrap items-center gap-1"
            >
              {(["all", "ready", "outstanding"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  data-testid={`expo-filter-${key}`}
                  className={cn(
                    "rounded-md border border-white/20 px-2 py-1 font-semibold text-kds-text",
                    T_LABEL,
                    filter === key && "bg-white/15",
                  )}
                >
                  {FILTER_LABELS[key]}
                  <span className="ml-1 tabular-nums text-kds-muted">
                    {key === "all"
                      ? checks.length
                      : key === "ready"
                        ? readyCount
                        : outstandingCount}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => router.push("/app/kitchen")}
              data-testid="expo-all-stations"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2 py-1 font-semibold text-kds-text",
                T_LABEL,
              )}
            >
              <LayoutGrid className="size-3.5" aria-hidden="true" />
              All stations
            </button>
            {/* Connection state carries an ICON and a WORD, never a coloured dot alone. */}
            <span
              data-testid="expo-connection"
              data-connected={isConnected ? "true" : "false"}
              title={`${connectedCount} of ${stationCount} station feeds connected`}
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

        {/* GA-001: error is checked BEFORE empty, always. A pass that failed to load must
            never render as "no checks on the pass" — that is the product lying in its own
            confident voice about the one thing a kitchen acts on. */}
        {failed ? (
          <QueryErrorNotice
            what="the pass"
            error={failed.error}
            isRetrying={stationsQuery.isFetching || ticketsQuery.isFetching}
            onRetry={() => {
              stationsQuery.refetch();
              ticketsQuery.refetch();
            }}
          />
        ) : (
          <>
            {assignedStations.length > 0 && (
              <div
                role="alert"
                data-testid="expo-scope-warning"
                className={cn(
                  "rounded-lg border border-kds-warn/50 bg-kds-warn/10 px-3 py-2 text-kds-text",
                  T_BODY,
                )}
              >
                <span className={cn("mr-1.5 font-bold uppercase tracking-wide", T_LABEL)}>
                  Partial view
                </span>
                {`Your account is assigned to ${assignedStations.join(", ")}, so this pass can only
                see those stations. A check may look ready here while a station you are not assigned
                to still owes a dish. Ask a manager to clear your station assignment before running
                food from this screen.`}
              </div>
            )}

            {advanceError && (
              <div
                role="alert"
                data-testid="expo-advance-error"
                className={cn(
                  "rounded-lg border border-kds-late/60 bg-kds-late-fill px-3 py-2 text-kds-text",
                  T_BODY,
                )}
              >
                {advanceError}
              </div>
            )}

            {ticketsQuery.isPending || stationsQuery.isPending ? (
              <ExpoSkeleton />
            ) : visible.length === 0 ? (
              <div
                data-testid="expo-empty"
                className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
              >
                {/* NOT the shared <EmptyState>: its tokens follow the viewer's light/dark
                    preference and this surface is permanently dark, which rendered near-black
                    text on a near-black board the last time it was tried here. */}
                <div
                  aria-hidden="true"
                  className="flex size-20 items-center justify-center rounded-full bg-kds-card"
                >
                  <UtensilsCrossed className="size-9 text-kds-muted" aria-hidden="true" />
                </div>
                <div className="flex max-w-xl flex-col gap-1">
                  <p className={cn("font-bold text-kds-text", T_H1)}>
                    {checks.length === 0
                      ? "Nothing on the pass"
                      : filter === "ready"
                        ? "Nothing ready to run yet"
                        : "Every check is ready to run"}
                  </p>
                  <p className={cn("text-kds-muted", T_SMALL)}>
                    {checks.length === 0
                      ? "No check at this branch has been fired to a kitchen station. A check appears here the moment the POS sends it, and stays until every station's lines are ready and it has been served."
                      : filter === "ready"
                        ? `${outstandingCount} ${outstandingCount === 1 ? "check is" : "checks are"} still cooking. Switch to “All checks” to see what each station still owes.`
                        : "Run them, then serve them on the POS to clear the pass."}
                  </p>
                </div>
                {filter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    data-testid="expo-empty-show-all"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-2 font-semibold text-kds-text",
                      T_LABEL,
                    )}
                  >
                    Show all checks
                  </button>
                )}
              </div>
            ) : (
              <ul
                data-testid="expo-check-list"
                className="grid list-none gap-3 md:grid-cols-2 2xl:grid-cols-3"
              >
                {visible.map((check) => (
                  <li key={check.orderId}>
                    <ExpoCheckCard
                      check={check}
                      now={now}
                      canUpdate={canUpdate}
                      busyItemIds={busyItemIds}
                      onAdvance={advance}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </ZoneProvider>
  );
}
