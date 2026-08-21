"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * `InsetRow` — the bordered inset tile (N3).
 *
 * <h3>Why this file exists: it is already in the product 21 times, unnamed</h3>
 *
 * `demo-calibration/DEMO-COMPONENTS.md:384` measured the single largest un-componentised
 * pattern in `Docs/NEXUS_ERP_Demo.html`: `padding:10px; background:var(--bg-3);
 * border:1px solid var(--border); border-radius:8px`, repeated **21×** across purchase-order
 * cards, campaign cards, staff and shift rows, report cards and branch cards — as a raw
 * `style=""` attribute every single time, because the author never noticed they had invented a
 * component. An unnamed pattern is a pattern that drifts: four of the 21 already carry a
 * hand-written `onmouseover` border swap, and no two of them agree on the gap between rows.
 * Naming it is the whole contribution.
 *
 * <h3>What it is — and what it deliberately is not</h3>
 *
 * A **layout primitive**: a leading slot, a primary line, a secondary line, a trailing slot,
 * and (static rows only) a footer. It knows nothing about shifts, vendors, campaigns or
 * branches. The moment it learns what a "shift" is, it stops being the thing that appears 21
 * times and becomes the thing that appears once.
 *
 * It **composes with** `components/dashboard/portlets/portlet.tsx` rather than competing with
 * it. `RecordList`/`ExceptionList` are divide-y lists — hairline separators inside one card,
 * for a homogeneous run of records. `InsetRow` is a *bordered tile*: it survives on its own,
 * it survives in a grid, and it survives when the rows are not homogeneous (a PO card with an
 * approve action next to one with an ETA). Reach for the portlet lists when the rows are a
 * table that lost its chrome; reach for this when each row is an object.
 *
 * <h3>Zones (D-38-04): safe on `operational` BY DEFAULT</h3>
 *
 * Designed for `restrained` and `expressive`, and **safe on `operational` (POS, KDS) without
 * an opt-out** — there is no `backdrop-filter`, no `glass-surface`, no entrance animation, no
 * parallax and no tilt anywhere in this file. The only motion is `transition-colors` on the
 * interactive variants' border, which is state feedback rather than decorative motion and is
 * already the idiom inside the operational zone (`components/pos/order-type-toggle.tsx:37`,
 * `components/kds/station-picker.tsx:220`). Richness is opt-in and stays the caller's
 * business: pass `shadow-depth-1` or `vdl-lift` through `className` on a surface where D-38-04
 * permits it. Nothing here has to be turned OFF to make the POS safe.
 *
 * <h3>Borders (D-38-13): the decorative tier, on purpose</h3>
 *
 * The hairline is `--border` (~1.26:1), which is the demo's own card hairline reproduced and
 * is **correct** — D-38-13 rules 1.36:1 legal for decoration and reserves
 * `--border-interactive` (3:1) for controls whose boundary is the only thing marking them.
 * A tile carries a fill, a radius and its own content; its border is not load-bearing. Using
 * the interactive tier here would make all 21 of these shout at once, which is precisely the
 * failure D-38-13's split exists to avoid.
 *
 * <h3>Accessibility</h3>
 *
 * The demo's version is `<div onclick=…>` eleven times over — `38-DECISIONS-DEMO.md` D-38-15
 * lists its accessibility as a pure NEGATIVE reference ("0 aria-*, 0 focus-visible,
 * `<div onclick>` for every interactive row"). So:
 *
 * · `onSelect` renders a real `<button type="button">`; `href` renders a real link. Both are
 *   tab-reachable, both fire on Enter/Space for free, and both take the global
 *   `:focus-visible` outline (`globals.css:927`) plus a border tint as a second channel.
 * · **A row cannot be interactive AND carry a `footer`.** The prop types are a union, so
 *   `<InsetRow onSelect={…} footer={<Button/>}>` is a compile error rather than a `<button>`
 *   nested inside a `<button>` — which is what the demo's PO cards would have produced.
 * · Everything inside the tile is phrasing content (`<span>`), so the markup stays valid when
 *   the wrapper is a `<button>` or an `<a>`.
 * · `selected` is never colour alone (D-38-13): it adds a **ring**, so the selected tile is
 *   visibly *thicker* than its neighbours in greyscale, and it publishes `aria-current`.
 *   State that carries *meaning* rather than mere selection belongs in `trailing` as a
 *   `StatusBadge`, which already pairs every hue with an icon and a word.
 *
 * <h3>Money</h3>
 *
 * This component formats nothing. `trailing` is a slot; money arrives already wrapped in
 * `components/ui/money-display.tsx` (bigint paisa in, one shared formatter). A tile that knew
 * how to render an amount would be the fifth place in this product that converts paisa, and
 * the journal screen has already shipped totals 100× too large once.
 */

/** The three demo densities collapse to two: the 10px tile, and an 8px one for dense grids. */
type Density = "comfortable" | "compact";

interface InsetRowCommonProps {
  /** Icon, avatar, index chip — anything that identifies the row before you read it. */
  leading?: React.ReactNode;
  /** The row's identity. Truncates; the row is a tile, not a paragraph. */
  primary: React.ReactNode;
  /** One line of context under the identity. */
  secondary?: React.ReactNode;
  /**
   * Value, badge or time, aligned to the primary line. Unstyled on purpose — a
   * `StatusBadge`, a `MoneyDisplay` or a bare timestamp all drop in unchanged.
   */
  /** Interactive variants forbid this — see `trailing?: never` on the button/link props. */
  trailing?: React.ReactNode;
  density?: Density;
  /**
   * Marks this tile as the current one in a set. Adds a ring (a THICKNESS channel, readable
   * without colour — D-38-13) on top of the tint, and publishes `aria-current="true"`.
   */
  selected?: boolean;
  /**
   * `li` when the tile is one of a run inside a `<ul>`/`<ol>`, which is most of the demo's 21.
   * `div` standalone or in a grid. Defaults to `div` because a stray `<li>` outside a list is
   * an invalid-markup bug that renders fine and is therefore never noticed.
   */
  as?: "div" | "li";
  className?: string;
  "data-testid"?: string;
}

interface InsetRowStaticProps extends InsetRowCommonProps {
  onSelect?: never;
  href?: never;
  actionLabel?: never;
  disabled?: never;
  /**
   * A third region below `secondary` — the demo's "Est. $448 · [Approve]" line. Available on
   * STATIC rows only: a footer holds controls, and controls do not nest inside a control.
   */
  footer?: React.ReactNode;
}

interface InsetRowButtonProps extends InsetRowCommonProps {
  /** Renders the tile as a real `<button type="button">`. */
  onSelect: () => void;
  href?: never;
  /** Accessible name, when the visible primary line is not a complete one ("Generate P&L"). */
  actionLabel?: string;
  disabled?: boolean;
  footer?: never;
  /**
   * Same reason as `footer`: controls do not nest inside a control. `trailing` renders INSIDE
   * the <button>/<a>, so an interactive trailing node emits a button inside a button — invalid
   * HTML, and the inner control is unreachable by keyboard. Static rows may still use it.
   */
  trailing?: never;
}

interface InsetRowLinkProps extends InsetRowCommonProps {
  /** Renders the tile as a real link. */
  href: string;
  onSelect?: never;
  actionLabel?: string;
  disabled?: never;
  footer?: never;
  /**
   * Same reason as `footer`: controls do not nest inside a control. `trailing` renders INSIDE
   * the <button>/<a>, so an interactive trailing node emits a button inside a button — invalid
   * HTML, and the inner control is unreachable by keyboard. Static rows may still use it.
   */
  trailing?: never;
}

export type InsetRowProps = InsetRowStaticProps | InsetRowButtonProps | InsetRowLinkProps;

/*
 * `bg-surface-2`, not a recessed token, and the reason is a real divergence from the demo.
 * The demo is dark-only (D-38-14) and recesses its tile to `--bg-3`, DARKER than the card. Our
 * ramp inverts by theme — surface-2 is neutral-100 in light (darker than the white card) and
 * neutral-900 in dark (lighter than the neutral-950 card) — so one token reads as "separated
 * from the card" in both themes, where a literally-darker fill would vanish into the dark
 * background. This is the same call `components/ui/data-grid/data-grid.tsx:214,286` already
 * made for the demo's other `--bg-3` surface, its recessed table-header strip. One answer, not
 * two.
 *
 * `rounded-lg` IS the demo's 8px: `globals.css:576` sets `--radius: 0.5rem` and `:213` maps
 * `--radius-lg` straight onto it. Not a bare `rounded` (gate G2) and not a coincidence.
 */
const TILE_BASE =
  "flex w-full list-none items-start rounded-lg border border-border bg-surface-2 text-left";

const DENSITY: Record<Density, string> = {
  comfortable: "gap-(--space-sm) p-2.5",
  compact: "gap-2 p-2",
};

/** Border tint on hover is the demo's own affordance (its four report cards hand-roll it). */
const INTERACTIVE =
  "cursor-pointer transition-colors hover:border-primary/50 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50";

const SELECTED = "border-primary ring-2 ring-primary/40";

export function InsetRow({
  leading,
  primary,
  secondary,
  trailing,
  footer,
  density = "comfortable",
  selected = false,
  as = "div",
  href,
  onSelect,
  actionLabel,
  disabled,
  className,
  "data-testid": testId,
}: InsetRowProps) {
  const tile = cn(
    TILE_BASE,
    DENSITY[density],
    selected && SELECTED,
    (href || onSelect) && INTERACTIVE,
    className,
  );

  const body = (
    <>
      {leading ? (
        <span className="flex shrink-0 items-center" data-slot="inset-row-leading">
          {leading}
        </span>
      ) : null}
      <span className="block min-w-0 flex-1">
        <span className="flex items-start justify-between gap-(--space-sm)">
          <span
            className="block min-w-0 truncate text-body font-medium"
            data-slot="inset-row-primary"
          >
            {primary}
          </span>
          {trailing ? (
            <span className="shrink-0" data-slot="inset-row-trailing">
              {trailing}
            </span>
          ) : null}
        </span>
        {secondary ? (
          <span
            className="mt-1 block text-small text-foreground-tertiary"
            data-slot="inset-row-secondary"
          >
            {secondary}
          </span>
        ) : null}
        {footer ? (
          <span className="mt-1.5 block text-small" data-slot="inset-row-footer">
            {footer}
          </span>
        ) : null}
      </span>
    </>
  );

  const shared = {
    className: tile,
    "data-slot": "inset-row",
    "data-selected": selected ? "true" : undefined,
    "aria-current": selected ? ("true" as const) : undefined,
    "data-testid": testId,
  };

  let node: React.ReactElement;
  if (href !== undefined) {
    node = (
      <Link href={href} aria-label={actionLabel} {...shared}>
        {body}
      </Link>
    );
  } else if (onSelect !== undefined) {
    node = (
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-label={actionLabel}
        {...shared}
      >
        {body}
      </button>
    );
  } else {
    const Tag = as;
    node = <Tag {...shared}>{body}</Tag>;
  }

  // A control is never itself a list item: the `<li>` OWNS the control. Skipping this wrapper
  // would drop the row out of the list's item count for a screen-reader user the moment the
  // row became clickable — the list would silently shrink as it gained affordances.
  if (as === "li" && (href !== undefined || onSelect !== undefined)) {
    return <li className="list-none">{node}</li>;
  }

  return node;
}
