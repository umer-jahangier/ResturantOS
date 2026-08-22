"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The link-based section strip that sits under a module's page header (UI-SPEC §11, §9.2).
 *
 * <h3>The defect this replaces</h3>
 *
 * Five layouts hand-rolled the same strip — `inventory`, `purchasing`, `hr`, `hr/settings`,
 * `finance` — each as `<nav className="mb-4 flex gap-4 border-b">` with links styled
 * `border-b-2 px-1 pb-2 …`. Copied five times, it had already drifted: three said `text-small`
 * and two said `text-sm` (a G1 offence in each). More importantly the shape itself is wrong at a
 * phone width, in two independent ways that the audit measured separately and that share one
 * cause:
 *
 * | | measured | why |
 * |---|---|---|
 * | elements past the viewport at 390px | purchasing's six labels lay out to **~560px** inside a 342px content box, with no `flex-wrap` and no scroll container | a bare `flex` |
 * | controls under 44×44 at 390px | every link is **~20px tall** (`px-1 pb-2` around a 14px line) | no minimum height |
 *
 * The second is the larger share of `inventory-stock`'s "14 controls below 44px": six of them are
 * these tabs, and they are the *primary navigation of the module* — the controls a user on a
 * phone reaches for first.
 *
 * <h3>It wraps; it does not scroll</h3>
 *
 * The plan's rule is *adapt the interface, do not shrink it*. The two candidate adaptations for a
 * row that no longer fits are a horizontally-scrolling strip and wrapping onto a second line. A
 * scroll strip hides the existence of the tabs past the edge — the user cannot see that
 * "Payments" and "Analytics" are there — which is the same defect as the desktop table on a
 * phone, in miniature. Wrapping keeps every destination visible and costs one line of height, so
 * it wraps.
 *
 * <p>`gap-y-0` is deliberate: the links carry their own 44px box, so a row gap would add space on
 * top of space. The bottom rule stays on the `<nav>` and therefore under the *last* row, which is
 * what makes a wrapped strip still read as one strip.
 *
 * <h3>Zone (D-38-04)</h3>
 *
 * `transition-colors` only. No transform, no entrance animation — this renders inside module
 * layouts that the POS and KDS shells also pass through, and a containing-block creator here
 * would be an ancestor of the receipt root on the print path.
 */
export interface SectionTab {
  href: string;
  label: string;
}

export interface SectionTabsProps {
  tabs: readonly SectionTab[];
  /** Names the landmark, e.g. `"Inventory"`. Required — a `<nav>` without one is "navigation". */
  label: string;
  /**
   * Forwarded verbatim as `data-testid`. The five call sites already ship
   * `inventory-tabs` / `purchasing-tabs` / `hr-tabs` / `hr-settings-tabs` / `finance-tabs`, and
   * those ids are load-bearing in existing specs, so the shared component takes the id rather
   * than imposing one.
   */
  testId?: string;
  className?: string;
}

export function SectionTabs({ tabs, label, testId, className }: SectionTabsProps) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      data-testid={testId}
      className={cn("mb-4 flex flex-wrap gap-x-4 gap-y-0 border-b", className)}
    >
      {tabs.map((tab) => {
        const active = pathname?.startsWith(tab.href) ?? false;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // `touch-target` is the 44×44 floor (WCAG 2.2 SC 2.5.5). `items-center` is what
              // turns that minimum into a centred label instead of a tall box with the text
              // pinned to the top.
              "touch-target inline-flex items-center justify-center border-b-2 px-1 text-small font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
