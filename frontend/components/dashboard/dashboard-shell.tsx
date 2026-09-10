"use client";

import React, { useEffect, useState } from "react";

import { T_BODY, T_DISPLAY, T_LABEL, T_SMALL } from "@/components/dashboard/dashboard-type";
import type { DashboardPreset } from "@/components/dashboard/presets";
import { formatDateTime } from "@/lib/format/locale";
import { cn } from "@/lib/utils";

/**
 * WHERE the restaurant and the branch come from, and why not from here.
 *
 * <p>The demo's dashboard opens on a dateline — "Monday, 14 April 2025 — Al-Baik Restaurant,
 * Branch 1" — and it is doing more work than it looks: it tells a reader which of several
 * branches these figures are FOR, which is the one question a four-tile KPI row cannot answer
 * about itself. We have both halves (`useTenantBrand`, `useMyBranches`) and neither belongs in
 * this file, because both are `useQuery` calls and this shell is rendered by eight dashboard
 * components that every unit test renders directly, with their own data hooks mocked and NO
 * `QueryClientProvider` above them. Calling a query here would throw "No QueryClient set" in
 * every one of those tests — a shell that cannot be rendered in isolation is a shell that stops
 * being tested.
 *
 * <p>So the identity is PUSHED IN from `tenant-dashboard.tsx`, which is the one component that
 * only ever renders under the app's providers, and it defaults to nothing. Absent, the dateline
 * is still a real dateline; present, it names the branch.
 */
export interface DashboardIdentity {
  /** The tenant's trading name, e.g. "Al-Baik Restaurant". `null` until it is known. */
  brand: string | null;
  /** The branch these figures were computed for, e.g. "Branch 1". `null` when unknown. */
  branchName: string | null;
}

const EMPTY_IDENTITY: DashboardIdentity = { brand: null, branchName: null };

const DashboardIdentityContext = React.createContext<DashboardIdentity>(EMPTY_IDENTITY);

export function DashboardIdentityProvider({
  identity,
  children,
}: {
  identity: DashboardIdentity;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ brand: identity.brand, branchName: identity.branchName }),
    [identity.brand, identity.branchName],
  );
  return (
    <DashboardIdentityContext.Provider value={value}>{children}</DashboardIdentityContext.Provider>
  );
}

export function useDashboardIdentity(): DashboardIdentity {
  return React.useContext(DashboardIdentityContext);
}

/** "Monday, 14 April 2025" — the demo's own dateline shape, through the pinned formatter. */
const DATELINE: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
};

/**
 * Today, formatted once at mount.
 *
 * <p>A lazy `useState` initializer, not a read in the component body: the React Compiler rejects
 * `Date.now()` during render as impure, and it is. Not `useNow()` either — a dateline does not
 * need a heartbeat, and putting one here would re-render four dashboards a minute to redraw a
 * string that changes at midnight.
 *
 * <p>`formatDateTime` pins `Asia/Karachi`, so the server render and the client render of the same
 * instant produce the same characters; `suppressHydrationWarning` at the call site covers the
 * one-in-a-million paint that straddles midnight.
 */
function useTodayLabel(): string {
  const [today] = useState(() => formatDateTime(Date.now(), DATELINE));
  return today;
}

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
 *
 * <h3>Phase 38 — the three devices this header was missing</h3>
 *
 * <ol>
 *   <li><b>The display serif.</b> The question is the one line on the page a reader stops on,
 *       and it was set in the same face as the caption under it. `font-heading` is Fraunces
 *       (D-38-13, `globals.css:40-43`) and this is the largest of its call sites.</li>
 *   <li><b>A dateline.</b> The demo's subtitle answers "these figures are for WHEN, and for
 *       WHOM" — the two questions a KPI row silently assumes. See {@link DashboardIdentity}
 *       for why the branch half arrives from above rather than from a query here.</li>
 *   <li><b>The time frame as a PILL rather than a right-aligned sentence.</b> It used to be
 *       grey body text floating at the far right of the header, which reads as an afterthought
 *       and collides with the title at the width where the two meet. As a bordered chip it is
 *       an object with a job, and it wraps under the title on a phone instead of squeezing it.</li>
 * </ol>
 */
export function DashboardShell({
  preset,
  children,
}: {
  preset: DashboardPreset;
  children: React.ReactNode;
}) {
  const today = useTodayLabel();
  const { brand, branchName } = useDashboardIdentity();
  // An em dash separates the date from the place; a middle dot separates place from branch.
  // Both halves are optional, and a dangling separator is worse than a shorter line.
  const place = [brand, branchName].filter(Boolean).join(" · ");

  return (
    <section
      className={cn("flex flex-col", preset.density === "compact" ? "gap-4" : "gap-6")}
      data-testid="dashboard"
      data-preset={preset.id}
      data-density={preset.density}
    >
      <header className="flex flex-col gap-(--space-sm) md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={cn("font-heading font-semibold tracking-tight", T_DISPLAY)}>
            {preset.question}
          </h1>
          <p
            className={cn("text-foreground-tertiary", T_SMALL)}
            data-testid="dashboard-dateline"
            suppressHydrationWarning
          >
            {place ? `${today} — ${place}` : today}
          </p>
        </div>
        <p
          className={cn(
            "inline-flex w-fit shrink-0 items-center rounded-full border border-border",
            "bg-surface-1 px-3 py-1 font-semibold tracking-[0.08em] uppercase",
            "text-foreground-secondary",
            T_LABEL,
          )}
          data-testid="dashboard-timeframe"
        >
          {preset.timeFrame}
        </p>
      </header>
      {children}
    </section>
  );
}

/**
 * How a row divides its width.
 *
 * <p>`even` is n equal columns. `lead` is the demo's dashboard row — a `2fr 1fr` split, with the
 * wide half carrying the chart or the record table and the narrow half carrying the meter stack
 * beside it (`DEMO-COMPONENTS.md`, the dashboard grid). A 50/50 split of those two is the reason
 * our version reads flat: an eight-row table and a four-line meter stack are not the same object
 * and should not be the same width.
 */
export type RowLayout = "even" | "lead";

/**
 * One row of portlets. Column counts are fixed per row rather than per breakpoint guesswork:
 * a four-tile KPI row is four tiles on a desktop and stacks on a phone, and a two-panel row
 * is two panels. Anything cleverer produces a 3-2 orphan on the one width nobody tested.
 */
export function PortletRow({
  density,
  columns,
  layout = "even",
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
  /** Only meaningful at `columns={2}`; ignored elsewhere. See {@link RowLayout}. */
  layout?: RowLayout;
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
        /*
         * 38-14 task 2: the portlet grid reflows 4 → 2 → 1, and the two thresholds are `md`
         * (768) and `xl` (1280) — widths the audit measures, not `sm` (640), which it does not.
         *
         * <p>The `sm` step was doing real damage rather than nothing. Between 640 and 767 the
         * shell is already in its MOBILE state — the sidebar is `hidden md:flex` and
         * `MobileBottomNav` is `md:hidden` — so a four-up dashboard was folding to two columns
         * inside a viewport that still had no sidebar to pay for them, giving a portlet ~310px.
         * Below `md` the whole product is one column; the dashboard now says so too.
         */
        columns === 1 && "grid-cols-1",
        /*
         * `minmax(0, …)` on both tracks, not a bare `2fr 1fr`. A grid track's default minimum is
         * `auto`, so one long unbroken string — an order number, a vendor name — inflates its
         * column past its share and the "2fr 1fr" silently becomes "1.4fr 1.6fr" on exactly the
         * rows that have data in them.
         */
        columns === 2 &&
          (layout === "lead"
            ? "grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            : "grid-cols-1 lg:grid-cols-2"),
        columns === 3 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
        columns === 4 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
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
