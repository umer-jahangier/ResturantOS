"use client";

import { Suspense, useEffect, useState } from "react";

import { Sidebar } from "@/components/shared/sidebar";
import { TopBar } from "@/components/shared/top-bar";
import { MobileBottomNav } from "@/components/shared/mobile-bottom-nav";
import { SidebarSkeleton } from "@/components/skeletons/sidebar-skeleton";
import { ZoneProvider } from "@/components/providers/zone-provider";
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
    /*
     * ZONE: restrained (D-34-02).
     *
     * This is the default for admin CRUD, lists, forms and menu management — and it
     * is deliberately what the shell CHROME gets even when an expressive page is
     * rendered beneath it. TopBar and MobileBottomNav are siblings of the page
     * content, not descendants of it, so they composite over the POS terminal and the
     * KDS board whenever an operator is on those routes. The chrome therefore cannot
     * be allowed to become richer than the poorest zone it can appear over: a glass
     * header above a POS screen is a compositing filter on the POS screen.
     *
     * Expressive pages nested inside this shell (the dashboard) declare their own
     * zone at the page, which is the nesting case the containment gate checks.
     */
    <ZoneProvider zone="restrained">
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
          <main key={branchId} className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 md:pb-6">
            {isBootstrapping ? (
              <div className="flex h-full items-center justify-center">
                <div
                  role="status"
                  aria-label="Loading session…"
                  className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
                />
              </div>
            ) : (
              /*
               * No page-transition wrapper (D-34-02, UI-SPEC §3.12).
               *
               * This layout wraps EVERY route in the shell, so a 350ms fade-and-slide here
               * played on the POS terminal and the KDS station board on every navigation —
               * the same class of defect as the compositing filters 34-01 removed, and for
               * the same reason: a shell cannot know which zone it is wrapping, so applying
               * motion here applies it to the two screens that must never have any.
               *
               * §3.12 already said "there is no page-transition animation", with the
               * arithmetic: an operator navigates ~200 times a shift and pays the duration
               * every time.
               *
               * The entrance vocabulary now lives in globals.css as `.vdl-enter` /
               * `.vdl-stagger`, scoped to [data-zone="expressive"], and an expressive page
               * OPTS IN at the page or portlet level — where the choice is visible to whoever
               * makes it. That per-surface choice is what the whole zoning decision rests on.
               *
               * PageTransition and PageTransitionMotion still exist but are no longer
               * referenced by the shell. Deleting them is a shell change beyond this phase;
               * leaving them wired was the actual defect.
               */
              children
            )}
          </main>
        </div>

        {/* Mobile bottom navigation (md:hidden — DS-05) */}
        <MobileBottomNav />
      </div>
    </ZoneProvider>
  );
}
