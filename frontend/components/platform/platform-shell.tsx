"use client";

import * as React from "react";

import { MAIN_CONTENT_ID, SkipLink } from "@/components/shared/skip-link";
import { PlatformSidebar } from "@/components/platform/platform-sidebar";
import { PlatformTopBar } from "@/components/platform/platform-top-bar";

/**
 * Chrome for the SuperAdmin control plane (UI-SPEC §7.5).
 *
 * <h3>What changed, and why the shape did</h3>
 *
 * This was a single `<header>` carrying a wordmark, a chip, three inline links and a Sign-out
 * button — the whole console's navigation on one horizontal line. That was the right size for
 * three routes. It is the wrong size for a control plane with tenants, a cross-tenant user
 * directory, an RBAC catalogue, plans, subscriptions, analytics, an audit trail and a system
 * status page: eleven destinations across six domains cannot be grouped on a bar, and a flat list
 * of eleven links is not navigation, it is a menu.
 *
 * <p>So the console now has the tenant app's shape — a grouped rail on the left, a bar above the
 * work — and the tenant app's LANGUAGE down to the class: the same `bg-sidebar` ground one step
 * off the content background, the same brand-hue seam, the same UPPERCASE `tracking-eyebrow`
 * group labels, the same full-bleed slab rows, and the same `ActiveRail` — imported from
 * `components/shared/active-rail.tsx`, not re-implemented, so the two shells cannot drift.
 *
 * <h3>Sameness is the point, and the two differences carry all the weight</h3>
 *
 * A SuperAdmin is the same person who opens the tenant app. A console that looks like a second
 * product costs them a re-orientation on every visit and buys nothing. What must be unmistakable
 * is not "this is different software" but "this action is not scoped to one branch" — and that is
 * exactly what the two retained devices say:
 *
 * <ul>
 *   <li>the persistent 4px `--warning` rule across the very top of the viewport, which now sits
 *       OUTSIDE the scroll container so it cannot scroll away (it previously could — the shell was
 *       a scrolling column and the rule was the first thing to leave the screen);</li>
 *   <li>the PLATFORM chip, pinned before the breadcrumb on every screen.</li>
 * </ul>
 *
 * Both keep their `data-testid`s — `platform-warning-rule` here, `platform-chip` in the top bar —
 * because `e2e/journeys/superadmin-console.spec.ts` asserts on them as the proof that a
 * platform-wide action can never be mistaken for a tenant-scoped one.
 *
 * <h3>The layout is `h-screen overflow-hidden` and `<main>` owns the scroll</h3>
 *
 * The same structure `app/(tenant)/layout.tsx` uses, and for the same two reasons: the rail can be
 * full height with its own overflow (eleven items in six groups will not fit a phone-height
 * viewport), and the warning rule and the top bar stay put without either of them declaring
 * `sticky`, so there is one mechanism holding the chrome in place rather than three.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    /*
     * `<SkipLink>` is FIRST in the document — above the warning rule, the rail and the bar.
     * Its position in this file IS the mechanism: rendered after the sidebar it would still be a
     * skip link, still announced, still correct in a screenshot, and would still leave a keyboard
     * user tabbing through every nav row before reaching the page. `skip-link.tsx` carries the
     * measurement (22 stops on the tenant shell) that made this a rule rather than a preference.
     */
    <>
      <SkipLink />
      <div className="flex h-screen flex-col overflow-hidden">
        {/*
          The 4px `--warning` rule, on the semantic token rather than a literal so it tracks the
          theme in both light and dark. `shrink-0` because it is a signal, not slack: in a flex
          column a 4px band is the first thing a squeeze would take.
        */}
        <div
          className="h-1 w-full shrink-0 bg-warning"
          aria-hidden="true"
          data-testid="platform-warning-rule"
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <PlatformSidebar
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((prev) => !prev)}
            mobileOpen={mobileOpen}
            onNavigate={() => setMobileOpen(false)}
          />

          {/*
            The overlay scrim. A `<button>` rather than a `<div onClick>`: below `md` the rail is a
            fixed overlay covering the page, and dismissing it must be reachable from a keyboard
            and announced. `sr-only` text rather than a bare `aria-label` so the control has a real
            accessible name in every assistive technology.

            `bg-foreground/40`, not `bg-black/40` — the scrim has to darken a light theme and a
            dark one, and a fixed black wash over a `--neutral-1000` ground is invisible.
          */}
          {mobileOpen && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-foreground/40 md:hidden"
            >
              <span className="sr-only">Close platform navigation</span>
            </button>
          )}

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <PlatformTopBar
              mobileOpen={mobileOpen}
              onMobileMenuToggle={() => setMobileOpen((prev) => !prev)}
            />

            {/*
              `id` + `tabIndex={-1}`: the fragment target has to be focusable or the skip link
              scrolls and leaves the caret in the chrome, which is the failure mode this pattern is
              known for. The inset offset keeps the confirmation outline off the clipping edge.

              The gutter is UI-SPEC §2's — 24px below 1024, 32px at and above — consumed as the
              bridged `--space-*` steps rather than as arbitrary numbers, and it is owned HERE
              rather than by `PageBody` on each page. `PageBody` carries `pb-20` below `md` to
              clear `MobileBottomNav`, and this shell has no bottom nav, so every console screen
              would have opened on a phone with 80px of dead space under it. A page that DOES use
              `PageBody` still takes the gutter over through
              `main:has([data-page-body]) { padding: 0 }` in globals.css, so the two mechanisms
              cannot both apply.
            */}
            <main
              id={MAIN_CONTENT_ID}
              tabIndex={-1}
              className="min-h-0 flex-1 overflow-y-auto p-(--space-lg) focus-visible:outline-offset-[-2px] lg:p-(--space-xl)"
            >
              {children}
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
