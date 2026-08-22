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
   * Decline the back-office gutter and take the viewport. For the POS terminal, the KDS board
   * and the floor plan (UI-SPEC §5: `operational` surfaces own their viewport).
   *
   * <p>Still emits `data-page-body`, which is what suppresses the shell's default padding.
   * A full-bleed page that did not emit it would inherit the back-office gutter and the opt-out
   * would silently do nothing.
   *
   * <p>"Full-bleed" means *not the fixed back-office gutter*; it does not mean zero. See the
   * inline note on the emitted class for the percentage gutter this now carries and why the
   * KDS opts back out of it.
   */
  fullBleed?: boolean;
}

export function PageBody({ fullBleed = false, className, children, ...rest }: PageBodyProps) {
  return (
    <div
      data-page-body={fullBleed ? "full-bleed" : "gutter"}
      className={cn(
        fullBleed
          ? // No VERTICAL padding and no bottom clearance: a full-bleed surface manages its own
            // scroll region, and the POS cart and the KDS columns both do.
            //
            // But the inline axis is not zero any more, and that was a real defect: this branch
            // emitted `h-full` and nothing else, so the POS opened edge-to-edge on a 1440px
            // monitor with the first menu tile touching the bezel. Reviewed as "literally
            // expanding to full screen with 0 padding at left and right".
            //
            // The gutter is a PERCENTAGE, not a step off the spacing ladder, because the thing
            // being asked for scales: ~2.5% of the viewport on each side at every width the
            // terminal ships to. `clamp()` bounds it at both ends so it never becomes either
            // invisible or absurd — 8px is the floor below ~320px, 64px the ceiling above
            // 2560px. Measured: 390px → 10px, 768px → 19px, 1024px → 26px, 1440px → 36px,
            // 1920px → 48px. That is the 2–5% the review asked for and it holds on a phone.
            //
            // What it deliberately is NOT: the fixed 255px back-office gutter wave 4 removed.
            // A percentage that yields 36px at 1440 cannot grow into a 255px inset, and the
            // ceiling makes that structural rather than a promise.
            //
            // The cart is unaffected — `lg:w-[360px] lg:shrink-0` is a fixed track that the
            // container's padding cannot compress (pos-terminal.tsx, asserted by
            // `__tests__/pos/pos-layout-css.test.ts`); the gutter comes out of the menu grid,
            // whose `repeat(auto-fill, minmax(130px, 1fr))` is built to absorb it.
            //
            // The KDS opts back out — see `[data-page-body="full-bleed"]:has([data-surface="kds"])`
            // in globals.css. Padding here would inset the board's dark ground and show app
            // chrome down both edges, which is the "dark board floating in light chrome" the
            // audit photographed and the whole reason `fullBleed` exists.
            "h-full px-[clamp(var(--space-sm),2.5%,var(--space-3xl))]"
          : "p-(--space-lg) pb-20 md:pb-(--space-lg) lg:p-(--space-xl)",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
