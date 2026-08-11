import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one owner of a page's outer gutter (UI-SPEC §2, D-38-02).
 *
 * <h3>Why a component rather than a class everyone remembers to use</h3>
 *
 * `app/(tenant)/layout.tsx` hard-coded `p-4 lg:p-6 pb-20 md:pb-6` on `<main>`. That is a
 * reasonable default and it had one fatal consequence: **no page could ever be full-bleed.**
 * The POS terminal, the KDS board and a floor plan all need to reach the viewport edge, and
 * all three were instead rendering inside 16–24px of back-office gutter they could not remove
 * — the audit photographed the KDS board as "a dark board floating in light chrome".
 *
 * So the gutter moves here, where a page can decline it.
 *
 * <h3>How the migration stays incremental (and why `:has()` is in globals.css)</h3>
 *
 * Fifty-five routes do not use this component yet. Deleting the padding from `<main>` outright
 * would strip the gutter from every one of them in a single commit — a 65-route visual change
 * dressed up as a refactor, and unattributable when something looks wrong.
 *
 * Instead `<main>` keeps its padding as the default, and `globals.css` drops that padding only
 * when a `PageBody` is present:
 *
 * ```css
 * main:has([data-page-body]) { padding: 0; }
 * ```
 *
 * An unmigrated page therefore renders **byte-identically** to before, and a migrated page gets
 * its gutter from here. Each later screen plan migrates its own routes, so a regression is
 * attributable to one screen rather than to one enormous commit.
 *
 * <h3>The gutter values are the contract's, not new ones</h3>
 *
 * UI-SPEC §2: `lg` (24px) below 1024px, `xl` (32px) at and above. Those are the bridged
 * `--space-*` steps published by 38-01, consumed as `p-(--space-lg)` / `lg:p-(--space-xl)` — not arbitrary numbers.
 * `pb-20` survives below `md` because `MobileBottomNav` overlays the bottom of the viewport and
 * content underneath it is unreachable.
 */
export interface PageBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Reach the viewport edge — no gutter at all. For the POS terminal, the KDS board and the
   * floor plan (UI-SPEC §5: `operational` surfaces own their viewport).
   *
   * <p>Still emits `data-page-body`, which is what suppresses the shell's default padding.
   * A full-bleed page that did not emit it would inherit the back-office gutter and the opt-out
   * would silently do nothing.
   */
  fullBleed?: boolean;
}

export function PageBody({ fullBleed = false, className, children, ...rest }: PageBodyProps) {
  return (
    <div
      data-page-body={fullBleed ? "full-bleed" : "gutter"}
      className={cn(
        fullBleed
          ? // No padding, and no bottom clearance either: a full-bleed surface manages its
            // own scroll region. The POS cart and the KDS columns both do.
            "h-full"
          : "p-(--space-lg) pb-20 md:pb-(--space-lg) lg:p-(--space-xl)",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
