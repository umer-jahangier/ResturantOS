"use client";

import Link from "next/link";

import { PortletRow } from "@/components/dashboard/dashboard-shell";
import { T_H2 } from "@/components/dashboard/dashboard-type";
import {
  ExceptionList,
  KpiTile,
  RankedList,
  RecordList,
  type ExceptionListData,
  type KpiTileData,
  type RankedListData,
  type RecordListData,
} from "@/components/dashboard/portlets/portlet";
import { PortletShell } from "@/components/dashboard/portlets/portlet";
import { TrendChart, type TrendSeries } from "@/components/dashboard/portlets/trend-chart";
import type { DashboardPreset, PortletSpec, PortletType } from "@/components/dashboard/presets";
import { visiblePortlets } from "@/components/dashboard/presets";
import { QueryBoundary, type QueryLike } from "@/components/ui/query-boundary";
import { cn } from "@/lib/utils";

/**
 * The generic portlet renderer — what makes `presets.ts` a layout engine rather than a comment.
 *
 * <h3>The finding this file answers</h3>
 *
 * The phase-38 audit proved `PortletSpec.type`, `.drillTo` and `.row` were DEAD DATA. Nothing
 * anywhere branched on `p.type`; there was no generic renderer; each of the four dashboards
 * hand-wrote its JSX and consulted the preset only for a `Set` of ids, then guarded each
 * hardcoded block with `shown.has("<id>")`. `drillTo` was re-typed as a string literal at all
 * nineteen call sites, and `row` was read by nobody. Changing a portlet's `type` in the table
 * changed nothing on screen.
 *
 * <p>That is a worse failure than a missing feature, because `presets.ts` opens with a long
 * argument FOR layout-as-data — "you cannot read a component and see what a cashier will get"
 * — and the code underneath it was exactly the invisible `if (permissions.includes(...))`
 * branching the argument warns about, wearing a table's clothes. The two available repairs were
 * to delete the three fields or to make them real. Deleting them would have left eight
 * dashboards (four existing, four new) each hand-writing its own grid, its own drill targets and
 * its own permission guards — the defect the file exists to prevent, multiplied by two. So the
 * renderer got built.
 *
 * <h3>What is now load-bearing, and how it is held</h3>
 *
 * <ul>
 *   <li><b>`row`</b> — {@link PortletGrid} groups by it and emits one {@link PortletRow} per
 *       row, in order. Move a portlet from row 3 to row 1 in the table and it moves on screen.
 *   <li><b>`type`</b> — dispatched at runtime by {@link renderPortlet}, AND bound at compile
 *       time by {@link PortletModels}: the model a dashboard supplies for an id must be the
 *       variant that id's declared `type` names. Retype a portlet in `presets.ts` and its
 *       dashboard stops compiling until the data matches.
 *   <li><b>`drillTo`</b> / <b>`title`</b> — passed from the spec. A dashboard cannot disagree
 *       with the table about where a tile goes, because it is never asked.
 *   <li><b>`permission`</b> — one call to `visiblePortlets`, here, covering every slot including
 *       `Shortcuts`. The old hand-written path gated the KPI tiles and rendered the 72px
 *       primary action unconditionally two lines below them, which is why an INVENTORY_MANAGER
 *       was shown "Open POS" for a POS they hold no `pos.order.create` for.
 * </ul>
 *
 * <h3>Column counts come from the DECLARED row, not the surviving one</h3>
 *
 * A row of four KPI tiles stays a four-column grid for a reader who may only see three of them.
 * Deriving the count from the filtered list would re-flow the page per principal — the same
 * dashboard would be a 4-up for an owner and a 3-up for someone one permission short, and the
 * two would be impossible to compare in a screenshot. This preserves the behaviour the four
 * hand-written dashboards already had, where `columns` was a literal.
 *
 * <h3>One error boundary per portlet, and it is optional</h3>
 *
 * `manager-dashboard.tsx:175-193` records why: a page-wide `QueryBoundary` fails its array as a
 * unit, so one transient 503 from any one service replaced the whole dashboard with a single
 * error box. That is not hypothetical — it is what the audit's first screenshot captured. Each
 * model therefore carries its OWN `boundary`, naming only the queries that portlet actually
 * reads, and a portlet that reads nothing asynchronous omits it.
 *
 * <p>Note the cost, stated: a portlet wrapped in a boundary does not receive `PortletRow`'s
 * `--vdl-i` clone, because `QueryBoundary` renders a fragment. The renderer therefore passes the
 * stagger index down itself, as a `style`, to the portlet — which is also the first time that
 * index has reached the DOM at all (see `PortletShellProps.style`).
 */

// ── The model vocabulary ─────────────────────────────────────────────────────

/** Data for a `TrendChart` slot. `emptyLabel` is what the panel says with no trading days. */
export interface TrendChartData {
  categories: string[];
  series: TrendSeries[];
  emptyLabel: string;
}

/**
 * The icon shape, declared structurally rather than as `typeof ChefHat`.
 *
 * <p>Same choice `stat-tile.tsx:117-120` makes: a lucide icon satisfies it without a cast, and
 * this module does not take a value import on an icon library it never renders itself.
 */
export type ShortcutIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** One 72px action in a `Shortcuts` slot. */
export interface ShortcutAction {
  href: string;
  label: string;
  icon: ShortcutIcon;
}

export interface ShortcutsData {
  actions: ShortcutAction[];
}

/** The queries one portlet reads, and what to call them in the failure sentence. */
export interface PortletBoundary {
  query: QueryLike | QueryLike[];
  /** What failed to load, in the reader's words — "late tickets", "the exception list". */
  what: string;
  /** One sentence naming what still works while this service is down. Only used on a 503. */
  stillWorks?: string;
}

/**
 * The six portlet bodies, discriminated by the same `kind` the preset table calls `type`.
 *
 * <p>Each variant carries only the DATA half: id, title, drill target, density and row all come
 * from the spec, so a dashboard physically cannot restate them differently.
 */
export type PortletBody =
  | ({ kind: "KpiTile" } & KpiTileData)
  | ({ kind: "TrendChart" } & TrendChartData)
  | ({ kind: "RankedList" } & RankedListData)
  | ({ kind: "ExceptionList" } & ExceptionListData)
  | ({ kind: "RecordList" } & RecordListData)
  | ({ kind: "Shortcuts" } & ShortcutsData);

export type PortletModel = PortletBody & { boundary?: PortletBoundary };

/** The model variant a portlet of declared type `T` must be given. */
export type ModelFor<T extends PortletType> = Extract<PortletBody, { kind: T }> & {
  boundary?: PortletBoundary;
};

/**
 * The compile-time binding between the preset table and the dashboard that feeds it.
 *
 * <p>`PortletModels<typeof OWNER_PORTLETS>` is `{ "owner-net-sales": ModelFor<"KpiTile">;
 * "owner-sales-trend": ModelFor<"TrendChart">; … }` — every id required, each pinned to the
 * variant its `type` names. Add a portlet to a preset and its dashboard fails to compile until
 * the data exists; retype one and the same happens. This is the mechanism that stops `type` from
 * drifting back into decoration once the renderer is a few months old.
 */
export type PortletModels<P extends readonly PortletSpec[]> = {
  [S in P[number] as S["id"]]: ModelFor<S["type"]>;
};

/** The loose shape {@link PortletGrid} accepts; each dashboard's map narrows it. */
export type PortletModelMap = Record<string, PortletModel>;

// ── Shortcuts — the sixth portlet type, implemented for the first time ───────

/**
 * The single 72px primary action §7.3 asks for on the focused presets.
 *
 * 72px is not decoration: it is the touch target a cashier hits without looking, on a
 * counter-mounted screen, with wet hands. Everything else on those dashboards is secondary to
 * getting them into the surface where their work happens.
 *
 * <p>It lives here, inside the renderer, because that is the only way it can be permission-gated
 * by the same pass that gates everything else. As a hand-written `<Link>` in
 * `focused-dashboard.tsx` it sat two lines below tiles that WERE gated and was rendered
 * unconditionally — the audit's finding, and the reason two roles were offered a POS they cannot
 * open. `Shortcuts` was also the one declared portlet type with no implementation anywhere
 * (`grep -rn "function Shortcuts|<Shortcuts" components app lib` → no matches); it now has one.
 */
function PrimaryAction({ href, label, icon: Icon }: ShortcutAction) {
  return (
    <Link
      href={href}
      data-testid="dashboard-primary-action"
      className={cn(
        "inline-flex h-[72px] items-center justify-center gap-3 rounded-lg px-8 font-semibold",
        // --primary-700 is the light-theme solid fill. §3.8 measured 500 and 600 against
        // white and both FAIL contrast; 700 is 5.46:1. The token remembers so nobody has to.
        "bg-primary-700 text-white hover:bg-primary-800",
        T_H2,
      )}
    >
      <Icon className="size-6" aria-hidden="true" />
      {label}
    </Link>
  );
}

function Shortcuts({
  id,
  actions,
  style,
}: {
  id: string;
  actions: ShortcutAction[];
  style?: React.CSSProperties;
}) {
  return (
    <div
      data-portlet={id}
      data-testid={`portlet-${id}`}
      className="flex flex-wrap gap-3"
      style={style}
    >
      {actions.map((action) => (
        <PrimaryAction key={action.href} {...action} />
      ))}
    </div>
  );
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * One portlet, chosen by its DECLARED type.
 *
 * <p>The `kind` guards are not belt-and-braces: {@link PortletModels} already pins the model to
 * the spec at the declaration site, but {@link PortletGrid} takes the widened
 * {@link PortletModelMap} so a preset and a map can, in principle, be handed to it separately.
 * A mismatch renders NOTHING rather than throwing — a dashboard is not worth taking down over a
 * misaddressed tile — and `role-dashboards.test.tsx` asserts every shipped preset is covered.
 */
function renderPortlet(
  spec: PortletSpec,
  model: PortletModel | undefined,
  density: "comfortable" | "compact",
  index: number,
): React.ReactElement | null {
  if (!model) return null;
  // The stagger index, passed down rather than left to `PortletRow`'s clone — the clone cannot
  // reach a portlet wrapped in a `QueryBoundary`, which renders a fragment.
  const style = { ["--vdl-i" as string]: String(index) } as React.CSSProperties;
  const chrome = { id: spec.id, title: spec.title, drillTo: spec.drillTo, density, style };

  switch (spec.type) {
    case "KpiTile":
      return model.kind === "KpiTile" ? <KpiTile key={spec.id} {...chrome} {...model} /> : null;
    case "RankedList":
      return model.kind === "RankedList" ? (
        <RankedList key={spec.id} {...chrome} {...model} />
      ) : null;
    case "ExceptionList":
      return model.kind === "ExceptionList" ? (
        <ExceptionList key={spec.id} {...chrome} {...model} />
      ) : null;
    case "RecordList":
      return model.kind === "RecordList" ? (
        <RecordList key={spec.id} {...chrome} {...model} />
      ) : null;
    case "Shortcuts":
      return model.kind === "Shortcuts" ? (
        <Shortcuts key={spec.id} id={spec.id} actions={model.actions} style={style} />
      ) : null;
    case "TrendChart":
      if (model.kind !== "TrendChart") return null;
      return (
        <PortletShell
          key={spec.id}
          id={spec.id}
          title={spec.title}
          drillTo={spec.drillTo}
          drillLabel={`${spec.title} — open the full report`}
          density={density}
          style={style}
        >
          {model.categories.length === 0 ? (
            <p className="text-small text-foreground-tertiary">{model.emptyLabel}</p>
          ) : (
            <TrendChart categories={model.categories} series={model.series} />
          )}
        </PortletShell>
      );
    default:
      return null;
  }
}

/** 1 → 1, 2 → 2, 3 → 3, 4 or more → 4. Derived from the row's DECLARED size. */
function columnsFor(declaredInRow: number): 1 | 2 | 3 | 4 {
  if (declaredInRow >= 4) return 4;
  if (declaredInRow === 3) return 3;
  if (declaredInRow === 2) return 2;
  return 1;
}

const ROWS = [1, 2, 3] as const;

/**
 * The whole grid, driven by the preset.
 *
 * <p>A dashboard component's entire job is now: run its queries, turn the results into a
 * {@link PortletModels} map, and hand both to this. No JSX per portlet, no `shown.has(...)`
 * guard, no repeated `drillTo` literal, and no row whose column count disagrees with the table.
 */
export function PortletGrid({
  preset,
  permissions,
  models,
}: {
  preset: DashboardPreset;
  permissions: readonly string[];
  models: PortletModelMap;
}) {
  const visible = visiblePortlets(preset, permissions);
  const visibleIds = new Set(visible.map((p) => p.id));

  return (
    <>
      {ROWS.map((row) => {
        const declared = preset.portlets.filter((p) => p.row === row);
        const shown = declared.filter((p) => visibleIds.has(p.id));
        if (shown.length === 0) return null;

        return (
          <PortletRow key={row} density={preset.density} columns={columnsFor(declared.length)}>
            {shown.map((spec, index) => {
              const model = models[spec.id];
              const body = renderPortlet(spec, model, preset.density, index);
              if (body === null) return null;
              if (!model?.boundary) return body;
              return (
                <QueryBoundary
                  key={spec.id}
                  query={model.boundary.query}
                  what={model.boundary.what}
                  stillWorks={model.boundary.stillWorks}
                >
                  {body}
                </QueryBoundary>
              );
            })}
          </PortletRow>
        );
      })}
    </>
  );
}
