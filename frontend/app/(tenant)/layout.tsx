"use client";

import { Suspense, useState } from "react";

import { Sidebar } from "@/components/shared/sidebar";
import { TopBar } from "@/components/shared/top-bar";
import { MobileBottomNav } from "@/components/shared/mobile-bottom-nav";
import { SidebarSkeleton } from "@/components/skeletons/sidebar-skeleton";

// Protected tenant app area. Real pages live under /app/* so the route group
// has distinct, non-colliding URLs. proxy.ts gates this prefix.
//
// Shell chrome (DS-05): collapsible Sidebar (grouped, brand area, badges),
// TopBar (breadcrumb, ⌘K, notifications, ThemeToggle, profile), MobileBottomNav.
//
// DS-06: If a tenant brand colour is stored in localStorage under
// `tenant-theme-settings`, inject a <link rel="stylesheet" />> that loads the
// OKLCH CSS vars from /api/theme. Relies on client-side read so it is handled
// below the hydration boundary. Defaults gracefully to base globals.css tokens.

function TenantThemeInjector() {
  // Read tenant brand colour from localStorage (written by Appearance form in 04-08).
  // This runs client-side only; on SSR the link is omitted — no flash because
  // globals.css provides sensible defaults.
  if (typeof window === "undefined") return null;

  let brandColor: string | null = null;
  try {
    const raw = localStorage.getItem("tenant-theme-settings");
    if (raw) {
      const parsed = JSON.parse(raw) as { brandColor?: string };
      brandColor = parsed.brandColor ?? null;
    }
  } catch {
    // Silently ignore parse errors
  }

  if (!brandColor) return null;

  return (
    <link
      rel="stylesheet"
      href={`/api/theme?brandColor=${encodeURIComponent(brandColor)}`}
    />
  );
}

interface TenantLayoutProps {
  children: React.ReactNode;
}

export default function TenantLayout({ children }: TenantLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleMobileMenuToggle() {
    setMobileOpen((prev) => !prev);
  }

  return (
    <>
      <TenantThemeInjector />
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar with Suspense skeleton fallback (DS-02 integration) */}
        <Suspense fallback={<SidebarSkeleton />}>
          <Sidebar mobileOpen={mobileOpen} />
        </Suspense>

        {/* Mobile sidebar overlay backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onMobileMenuToggle={handleMobileMenuToggle} />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 md:pb-6">
            {children}
          </main>
        </div>

        {/* Mobile bottom navigation (md:hidden — DS-05) */}
        <MobileBottomNav />
      </div>
    </>
  );
}
