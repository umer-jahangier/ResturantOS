"use client";

import { Radio, RefreshCw } from "lucide-react";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { DashboardTileGrid } from "@/components/reporting/DashboardTileGrid";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDashboardTiles } from "@/lib/hooks/reporting/use-reports";
import { useDashboardSocket } from "@/lib/hooks/reporting/use-dashboard-socket";
import { cn } from "@/lib/utils";

/**
 * Whether the board is live, said three ways.
 *
 * <p>This line was `bg-emerald-500` / `bg-amber-500` — two raw palette literals (gate G3) that
 * follow neither theme nor `--brand-h`, on the one control in the product whose whole job is to
 * tell a manager whether the numbers in front of them are current. They are `--success` and
 * `--warning` now, which is what they meant.
 *
 * <p>Hue never travels alone (D-38-13): the state is carried by the WORD ("Live" /
 * "Reconnecting…"), by the ICON SHAPE (a broadcast mark vs a retry arrow) and only then by the
 * colour. Drop the colour entirely and the line still reads correctly, which is the test.
 */
/**
 * The socket's state, as the demo's LIVE pill.
 *
 * <h3>Why a pill and not a line of coloured text</h3>
 *
 * This was `<Icon /> Live` in green — the same information, rendered as body copy, which is the
 * "cheap" read in miniature: the most important claim on the page (are these figures CURRENT?)
 * looked like a caption. `components/shared/top-bar.tsx` already ships the demo's pill for
 * browser connectivity; this is the same object bound to a different truth — the dashboard
 * WebSocket — so the two agree by construction rather than by resemblance.
 *
 * <p>Three channels, never hue alone (D-38-13 §4.2): the WORD changes, the border and fill change,
 * and the `title` says what the state means for the numbers below it. The 2s breath on the dot is
 * `animate-pulse`, whose keyframe moves opacity only — the demo's moves `transform: scale()`,
 * which would make this dot a containing block for fixed-position descendants. Reduced motion
 * removes it through the global net in `globals.css`.
 */
function ConnectionIndicator({ isConnected }: { isConnected: boolean }) {
  const Icon = isConnected ? Radio : RefreshCw;
  return (
    <p
      role="status"
      data-testid="realtime-connection"
      data-connected={isConnected}
      title={
        isConnected
          ? "Connected. Tiles update as soon as an order or till closes."
          : "Reconnecting. The figures below are the last values received, not current ones."
      }
      className={cn(
        "inline-flex items-center gap-(--space-xs) rounded-full border px-2.5 py-0.5",
        "text-label font-semibold tracking-[0.08em] uppercase",
        isConnected
          ? "border-success/30 bg-success/10 text-success"
          : "border-warning/30 bg-warning/10 text-warning-700 dark:text-warning-400",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {isConnected ? (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full bg-success"
          data-testid="realtime-pulse"
        />
      ) : null}
      {isConnected ? "Live" : "Reconnecting…"}
    </p>
  );
}

function RealtimeDashboard() {
  const { branchId } = useCurrentUser();
  // The REST snapshot (12-06) paints instantly on mount — a realtime dashboard that is blank
  // until the next order closes looks broken.
  //
  // `isError` is destructured here and PASSED DOWN, which is the whole of this screen's fix. The
  // grid rendered "No tiles yet — nothing has been computed for today" whenever `tiles` was
  // undefined, and a failed snapshot request produces exactly that: a manager whose reporting
  // service was down read a confident claim that their restaurant had taken no orders. GA-001,
  // bug shape 2 — the failure was never destructured, so it became an empty result one line later.
  const tilesQuery = useDashboardTiles(branchId);
  const { data: snapshotTiles, isLoading } = tilesQuery;
  // The WebSocket then keeps it live, merging into the SAME query-cache key as the snapshot.
  const { isConnected, tiles: liveTiles } = useDashboardSocket({ branchId });

  const tiles = liveTiles ?? snapshotTiles;

  return (
    <>
      <PageHeader
        title="Realtime Dashboard"
        description="Updates automatically when an order or till closes."
        actions={<ConnectionIndicator isConnected={isConnected} />}
      />
      {/*
        UI-SPEC §8.1.1 — the boundary wraps the smallest genuinely-unavailable region. The header
        and its connection indicator stay on screen when the snapshot fails, because they are
        still true: the socket may well be live while the REST snapshot is not.
      */}
      <DashboardTileGrid
        tiles={tiles}
        isLoading={isLoading}
        // A live socket that has already delivered tiles outranks a failed snapshot: the numbers
        // on screen are current, and replacing them with a failure notice would be its own lie.
        isError={tilesQuery.isError && liveTiles === undefined}
        error={tilesQuery.error}
        onRetry={() => void tilesQuery.refetch()}
        isRetrying={tilesQuery.isFetching}
      />
    </>
  );
}

/**
 * `/app/dashboard/realtime` — RPT-02.
 *
 * <p>One of the three surfaces N12 named as having drifted into a second visual language: no
 * `PageHeader`, no `StatTile`, a hand-rolled `h1` at `text-xl`, tile values at `text-3xl` and
 * two raw palette literals — all of it a corridor away from `/app/dashboard`, which is built
 * from the contract's primitives. No phase-38 plan owned this route, which is exactly why it
 * drifted, and it is on the shared grammar now.
 */
export default function RealtimeDashboardPage() {
  return (
    <PermissionGuard require="reporting.dashboard.view" fallback={<AccessDenied />}>
      <PageBody className="space-y-(--space-lg)">
        <RealtimeDashboard />
      </PageBody>
    </PermissionGuard>
  );
}
