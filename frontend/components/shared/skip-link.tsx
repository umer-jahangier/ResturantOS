"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The id every shell stamps on its `<main>`, and the only thing {@link SkipLink} ever points at.
 *
 * <p>Exported as a constant rather than written as the string `"main-content"` in four places,
 * because a skip link whose target id was renamed is a skip link that scrolls nowhere and
 * silently leaves focus on itself — the one failure mode of this pattern that looks fine in a
 * screenshot. Gate G12 reads this constant, so a rename that misses a shell fails the gate
 * rather than the user.
 */
export const MAIN_CONTENT_ID = "main-content";

export interface SkipLinkProps {
  className?: string;
  /** Override the label. Defaults to "Skip to content". */
  children?: React.ReactNode;
}

/**
 * The first focusable element on every page (UI-SPEC §11, brief §40; plan 38-15 task 1).
 *
 * <h3>The measurement this exists for</h3>
 *
 * `e2e/audit-38-a11y.mjs` pressed Tab against `/app/purchasing/purchase-orders` and counted the
 * stops before focus entered `<main>`: **22**. Stop 22 was the anchor "Vendors" — a tab strip,
 * not page content. Stops 1–21 were the branch switcher and the sidebar's nav links, re-walked
 * from the top on every single page load, on all 65 routes, by every keyboard user. The same
 * probe counted `a[href^="#"]` on the page: **0**. There was no skip link anywhere in the
 * product, so there was no way to decline that walk.
 *
 * <h3>Why it is a component in the shell and not a snippet per route</h3>
 *
 * A skip link is only correct if it is FIRST in the tab order, which is a property of the
 * document, not of a page. Sixty-five pages each remembering to render one is sixty-five
 * chances to render it second — after the sidebar — where it is worse than useless: it looks
 * present to a reviewer and still costs 21 stops. So it is mounted by the two shells that own
 * `<main>` (`app/(tenant)/layout.tsx` and `components/platform/platform-shell.tsx`), above the
 * sidebar in the DOM, and a route cannot forget it or move it.
 *
 * <h3>Off-screen by position, not by `sr-only`, and never by `transform`</h3>
 *
 * Two constraints decide this and both are load-bearing:
 *
 * <p>1. `sr-only` → `focus:not-sr-only` toggles `position` from *both* sides — `sr-only` sets
 * `absolute`, `not-sr-only` sets `static`, and a `focus:fixed` alongside it is a third utility
 * writing the same property. Which one wins is Tailwind's internal utility ordering, i.e. not
 * something this file controls. Parking the link permanently at `fixed; top: -6rem` and moving
 * only `top` on focus writes one property from one place, so the resting state is not a
 * cascade race. It also keeps the link in the accessibility tree at all times, which
 * `display: none` would not.
 *
 * <p>2. **No `transform`.** The obvious idiom for this is `-translate-y-full`, and it is
 * forbidden here twice over. `receipt-print.css:181` anchors `.receipt-root` with
 * `position: fixed`, and a `transform` on any ANCESTOR makes that ancestor the containing block
 * for its fixed descendants **at print time as well as on screen** — this link renders in the
 * shell, which is an ancestor of the receipt route. And `zone-containment.test.ts` scans the
 * BUILT stylesheet for containing-block creators outside `[data-zone="expressive"]`, so a
 * `-translate-y-*` utility here would emit a `transform` rule rooted at nothing and fail G5.
 * `top` moves the box with neither consequence.
 *
 * <h3>Focus is moved by hand, not left to the fragment</h3>
 *
 * `<main>` carries `tabIndex={-1}` so it can hold focus, but browser behaviour on a same-page
 * fragment has historically differed on whether focus follows the scroll. Calling `focus()`
 * makes the outcome the same everywhere — and, more practically, makes it *testable*: jsdom
 * implements no fragment navigation at all, so a unit test of the native path would assert
 * nothing. `preventScroll` is deliberately NOT passed; the scroll is half the affordance.
 */
export function SkipLink({ className, children = "Skip to content" }: SkipLinkProps) {
  function handleSkip(event: React.MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById(MAIN_CONTENT_ID);
    if (!target) return;
    event.preventDefault();
    target.focus();
    // Keep the address bar honest for anyone who then reloads or shares the URL.
    if (typeof history !== "undefined" && typeof history.replaceState === "function") {
      history.replaceState(null, "", `#${MAIN_CONTENT_ID}`);
    }
  }

  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      data-slot="skip-link"
      data-testid="skip-to-content"
      onClick={handleSkip}
      className={cn(
        // Parked above the viewport, in the tab order, in the a11y tree. `-top-24` clears a
        // 44px-tall control with room to spare.
        "fixed -top-24 left-(--space-sm) z-50 inline-flex min-h-11 items-center rounded-md",
        "bg-primary-solid px-(--space-md) text-body font-medium text-primary-solid-foreground",
        "shadow-elev-2",
        // `focus`, not `focus-visible`: this control has no pointer affordance to speak of —
        // it is off-screen until it holds focus — so there is no "focused by click" case to
        // distinguish. The global `:focus-visible` outline in globals.css still paints on it.
        "focus:top-(--space-sm)",
        className,
      )}
    >
      {children}
    </a>
  );
}
