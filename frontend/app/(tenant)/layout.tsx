"use client";

import { Suspense, useEffect, useState } from "react";

import { Sidebar } from "@/components/shared/sidebar";
import { TopBar } from "@/components/shared/top-bar";
import { MobileBottomNav } from "@/components/shared/mobile-bottom-nav";
import { SidebarSkeleton } from "@/components/skeletons/sidebar-skeleton";
import { PageTransition } from "@/components/shared/page-transition";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useBootstrapping } from "@/components/providers/session-provider";

// Protected tenant app area. Real pages live under /app/* so the route group
// has distinct, non-colliding URLs. proxy.ts + SessionProvider gate this prefix.
//
// Shell chrome (DS-05): collapsible Sidebar (grouped, brand area, badges),
// TopBar (breadcrumb, ⌘K, notifications, ThemeToggle, profile), MobileBottomNav.
//
// DS-06: If a tenant brand colour is stored in localStorage under
// `tenant-theme-settings`, inject a <link rel="stylesheet"> that loads OKLCH CSS
// vars from /api/theme. Uses useEffect so the server render and first client paint
// both produce no link element — globals.css defaults apply until the stylesheet
// loads, avoiding a hydration mismatch.

function TenantThemeInjector() {
  useEffect(() => {
    let link: HTMLLinkElement | null = null;

    try {
      const raw = localStorage.getItem("tenant-theme-settings");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { brandColor?: string };
      const brandColor = parsed.brandColor;
      if (!brandColor) return;

      link = document.createElement("link");
      link.id = "tenant-theme-stylesheet";
      link.rel = "stylesheet";
      link.href = `/api/theme?brandColor=${encodeURIComponent(brandColor)}`;
      document.head.appendChild(link);
    } catch {
      // localStorage unavailable or JSON parse error — silently skip.
    }

    return () => {
      link?.remove();
    };
  }, []);

  return null;
}

interface TenantLayoutProps {
  children: React.ReactNode;
}

export default function TenantLayout({ children }: TenantLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { branchId } = useCurrentUser();
  const { isBootstrapping } = useBootstrapping();

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
          {/*
           * key={branchId} remounts page content on branch switch so components
           * can't accidentally display stale cross-branch data.
           * While bootstrapping (reload before refresh completes), show a spinner
           * rather than an empty-state caused by branchId being "".
           */}
          <main
            key={branchId}
            className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 md:pb-6"
          >
            {isBootstrapping ? (
              <div className="flex h-full items-center justify-center">
                <div
                  role="status"
                  aria-label="Loading session…"
                  className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
                />
              </div>
            ) : (
              <PageTransition className="h-full">{children}</PageTransition>
            )}
          </main>
        </div>

        {/* Mobile bottom navigation (md:hidden — DS-05) */}
        <MobileBottomNav />
      </div>
    </>
  );
}
