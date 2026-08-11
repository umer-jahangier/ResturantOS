import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one page heading (UI-SPEC §6.1, §11; brief §43).
 *
 * <h3>What the audit measured</h3>
 *
 * **60 files declared their own `<h1>`** and no `PageHeader` existed, so the heading was
 * re-typed sixty times and drifted: `/app/inventory/stock` and `/app/tables` shipped
 * `text-2xl font-semibold` (24px), `/app/purchasing/purchase-orders` shipped `text-xl` (20px),
 * and the contract (`--text-h1`) says 20/28 at weight 600. Worse, **four screens rendered no
 * `<h1>` at all** — `/app/pos`, `/app/pos/tills`, POS order management and
 * `/app/hr/attendance` — so a screen-reader user landing there got no page identity, and the
 * document-outline check had nothing to anchor on.
 *
 * <h3>Exactly one `<h1>`, structurally</h3>
 *
 * This component renders the `<h1>`. A page that uses it and *also* writes its own has two,
 * which gate G12a catches on the migrated routes. The heading is not configurable to a
 * different element on purpose: "let the caller pass `as`" is how the sixty copies started.
 *
 * <h3>Type comes from the bridge, not from a class the caller remembers</h3>
 *
 * `text-h1` is the utility 38-01 published from `--text-h1` (20/28). The caller cannot pass a
 * type class for the title, because every escape hatch offered here becomes the next `text-2xl`.
 */
export interface PageHeaderProps {
  /** The page title. Rendered as the page's one `<h1>` at `--text-h1`. */
  title: string;
  /**
   * One sentence on what this screen is and whose data it shows. Optional because a few
   * operational screens genuinely need none — not because it is decorative.
   */
  description?: React.ReactNode;
  /**
   * Contextual facts about what is being shown — a branch name, a count, a period. Sits
   * beneath the description at `--text-small`.
   */
  meta?: React.ReactNode;
  /**
   * **One** primary action (UI-SPEC §4.1: accent is reserved for the single primary action per
   * screen region). Secondary actions belong in `overflow`.
   */
  actions?: React.ReactNode;
  /** Lower-frequency actions, as a menu trigger. Keeps `actions` down to the one that matters. */
  overflow?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  meta,
  actions,
  overflow,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex flex-wrap items-start justify-between gap-(--space-md)", className)}
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-h1 font-semibold text-balance">{title}</h1>
        {description ? (
          <p className="mt-(--space-xs) text-body text-foreground-secondary">{description}</p>
        ) : null}
        {meta ? <div className="mt-(--space-xs) text-small text-foreground-tertiary">{meta}</div> : null}
      </div>

      {actions || overflow ? (
        <div className="flex shrink-0 items-center gap-(--space-sm)">
          {actions}
          {overflow}
        </div>
      ) : null}
    </div>
  );
}
