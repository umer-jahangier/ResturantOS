"use client";

import React, { useEffect, useState } from "react";

import { T_BODY, T_DISPLAY, T_SMALL } from "@/components/dashboard/dashboard-type";
import type { DashboardPreset } from "@/components/dashboard/presets";
import { cn } from "@/lib/utils";

/**
 * The container every role dashboard shares (UI-SPEC §7.3: "the dashboard is not a page;
 * it is a container of role-assigned portlets").
 *
 * The header states the QUESTION this dashboard answers and the time frame it answers it
 * over. Both are in the preset data, so a reader can tell at a glance whether they are
 * looking at "today, live" or "the last 30 days" — the previous single dashboard showed
 * four numbers with no time frame at all, which meant "Closed sales" could equally have
 * been today's, this week's, or all of history. It was all of history.
 *
 * `density` is a real switch, not a label: §7.3 gives an owner `comfortable` and a manager
 * `compact`, because a manager scans and an owner reads.
 */
export function DashboardShell({
  preset,
  children,
}: {
  preset: DashboardPreset;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn("flex flex-col", preset.density === "compact" ? "gap-4" : "gap-6")}
      data-testid="dashboard"
      data-preset={preset.id}
      data-density={preset.density}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className={cn("font-semibold", T_DISPLAY)}>{preset.question}</h1>
        <p className={cn("text-foreground-tertiary", T_SMALL)} data-testid="dashboard-timeframe">
          {preset.timeFrame}
        </p>
      </header>
      {children}
    </section>
  );
}

/**
 * One row of portlets. Column counts are fixed per row rather than per breakpoint guesswork:
 * a four-tile KPI row is four tiles on a desktop and stacks on a phone, and a two-panel row
 * is two panels. Anything cleverer produces a 3-2 orphan on the one width nobody tested.
 */
export function PortletRow({
  density,
  columns,
  children,
}: {
  density: "comfortable" | "compact";
  /**
   * How many across at the widest breakpoint. Derived by the renderer from the row's DECLARED
   * size in the preset table, not from how many portlets survived the permission filter — a
   * reader who lacks one permission gets a gap where that tile would be, not a silently
   * re-flowed page whose four-up KPI row has become a three-up one.
   *
   * <p>`3` was added in phase 38 for the four new role dashboards, whose rows are not all
   * powers of two. Without it a three-portlet row had to render as `columns={4}` and leave a
   * quarter-width hole on every desktop.
   */
  columns: 1 | 2 | 3 | 4;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid",
        /*
         * Phase 34: a staggered entrance across the row (D-34-02, expressive only).
         *
         * `.vdl-stagger` is inert outside the expressive zone, and it sets no resting style —
         * strip the class and every tile is exactly where it is now, at full opacity. Under a
         * reduced-motion preference the rule resolves `animation: none` and the grid simply
         * appears, which is what D-34-03 asks for: absence, not a faster flourish.
         *
         * The delay per child is computed by the stylesheet from `--vdl-i`, so adding a fifth
         * portlet to a preset never means rewriting four delays.
         */
        "vdl-stagger",
        density === "compact" ? "gap-3" : "gap-4",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 lg:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
        columns === 4 && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
      )}
    >
      {React.Children.map(children, (child, i) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ style?: React.CSSProperties }>, {
              style: {
                ...((child as React.ReactElement<{ style?: React.CSSProperties }>).props.style ??
                  {}),
                ["--vdl-i" as string]: String(i),
              },
            })
          : child,
      )}
    </div>
  );
}

/**
 * A ticking "now", for the tiles that measure age.
 *
 * `Date.now()` read in a component body is an impure render — the React Compiler rejects it
 * (`Cannot call impure function during render`) and it is genuinely wrong: two components
 * reading the clock in the same render can disagree, and neither ever updates. A cached
 * timestamp advanced on an interval is pure at render time and honest about staleness.
 *
 * 15 seconds, not one. A manager's "late tickets" count does not need to tick like a
 * stopwatch, and a per-second re-render of six queries' worth of tiles buys nothing —
 * the ageing thresholds it feeds are measured in minutes.
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** A one-line note under a row — used where a number needs a caveat the tile cannot hold. */
export function RowNote({ children }: { children: React.ReactNode }) {
  return <p className={cn("text-foreground-tertiary", T_BODY)}>{children}</p>;
}
