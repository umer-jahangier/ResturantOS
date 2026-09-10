"use client";

import type { ReactNode } from "react";

import { PlatformGuard } from "@/components/platform/platform-guard";
import { PlatformShell } from "@/components/platform/platform-shell";
import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * The SuperAdmin control plane (19c).
 *
 * <h3>What this replaced</h3>
 *
 * Fourteen lines rendering a `<header>` with one sentence and no navigation. The whole console was
 * that file plus a nine-line dashboard page — 0 anchors, 0 `<nav>` elements, and no call to
 * `/api/v1/platform/**` anywhere outside `e2e/` (GA-010). Every plan claiming "a SuperAdmin
 * enables the flag" was describing a `curl`.
 *
 * <h3>Authorization, which this route group did not have</h3>
 *
 * `PlatformGuard` wraps everything, and it wraps the SHELL too, not just the pages. That ordering
 * matters: rendering platform chrome around an access-denied message would still show a tenant
 * user the console's navigation and tell them which platform screens exist. The guard decides
 * first; the shell only exists for a principal entitled to see it.
 *
 * The comment this file used to carry said "proxy.ts gates this prefix". It does not — it checks
 * for a forgeable marker cookie that every logged-in user of every tenant has, and its own header
 * comment says it is not a security boundary. See `PlatformGuard` for why the real check cannot
 * live there.
 *
 * <h3>The shell under it is now a rail, not a bar</h3>
 *
 * `PlatformShell` grew from a single `<header>` of three inline links into the tenant app's own
 * shape — a grouped sidebar and a top bar — because the console's routes went from three to
 * eleven across six domains, and eleven links do not group on a bar. The nesting here is
 * unchanged and must stay in this order: <b>guard, then zone, then shell</b>.
 *
 * <h3>Why this layout does NOT own the page gutter</h3>
 *
 * `<main>` lives inside `PlatformShell`, which is what makes the sidebar full-height and lets the
 * content column scroll on its own. So the gutter is declared there, on the element that has it,
 * rather than here on a wrapper that would have to reach through the shell to apply it.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformGuard>
      {/*
       * ZONE: expressive (D-34-02), declared INSIDE the guard for the same reason the
       * shell is inside it. An access-denied response dressed in the console's surface
       * treatment still tells a tenant user that a platform console exists and roughly
       * what it looks like. The guard decides first; the zone only exists for a
       * principal entitled to see the console.
       */}
      <ZoneProvider zone="expressive">
        <PlatformShell>{children}</PlatformShell>
      </ZoneProvider>
    </PlatformGuard>
  );
}
