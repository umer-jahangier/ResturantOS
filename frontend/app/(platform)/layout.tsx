"use client";

import type { ReactNode } from "react";

import { PlatformGuard } from "@/components/platform/platform-guard";
import { PlatformShell } from "@/components/platform/platform-shell";

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
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformGuard>
      <PlatformShell>{children}</PlatformShell>
    </PlatformGuard>
  );
}
