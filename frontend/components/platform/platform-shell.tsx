"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, LogOut, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/lib/hooks/auth/use-logout";

/**
 * Chrome for the SuperAdmin control plane (UI-SPEC §7.5).
 *
 * <h3>It must never look like the tenant app</h3>
 *
 * A persistent `--warning` 4px top border and a "PLATFORM" chip in the shell bar, exactly as the
 * spec requires, "so nobody ever confuses a platform-wide action with a tenant-scoped one". This
 * is the highest-blast-radius surface in the product: a suspend here takes a restaurant offline.
 *
 * <h3>Its own nav</h3>
 *
 * `platformNavItems` in `components/shared/sidebar-nav-items.ts` declares these routes but has
 * zero application-code consumers and still marks `/platform/tenants` `comingSoon` (GA-053). That
 * file is owned by another concurrent workstream, so the console carries its own nav rather than
 * editing it — which also means the shell has navigation at all, where before it rendered a bare
 * `<header>` and a SuperAdmin had none.
 *
 * Only routes that exist are listed. A nav pointing at a 404 is the defect GA-053 records; adding
 * more of them while fixing it would be an odd trade.
 */
const NAV = [
  { href: "/platform/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/platform/tenants", label: "Tenants", icon: Building2 },
  // Added with the endpoint that backs it, not before. This route was a 404 until
  // GET /api/v1/platform/impersonations existed; a nav entry pointing at one of those is GA-053.
  { href: "/platform/impersonations", label: "Impersonations", icon: ShieldAlert },
] as const;

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        The 4px --warning rule. Uses the semantic token, not a literal colour — Phase 20 forbids
        new colours and this band has to track the theme in both light and dark.
      */}
      <div
        className="h-1 w-full bg-warning"
        aria-hidden="true"
        data-testid="platform-warning-rule"
      />

      {/*
       * Phase 34: the console header is a glass overlay surface.
       *
       * Safe here in a way it would not be in the tenant shell: this header only ever renders
       * inside the platform route group, which is expressive end to end, so it can never
       * composite over an operational screen the way TopBar can. `--surface-1` is a declared
       * substrate in 34-02's manifest, so the header's text keeps a measured pairing.
       */}
      <header className="glass-surface-overlay sticky top-0 z-30 flex items-center gap-4 rounded-none border-x-0 border-t-0 px-6 py-3">
        <Link href="/platform/dashboard" className="font-semibold">
          RestaurantOS
        </Link>
        {/*
          Same token trio `StatusBadge` uses for its warning variant
          (`bg-warning/15 text-warning border-warning/30`) rather than a bespoke pairing — the
          UI-SPEC contrast tables are measured against those combinations, and a one-off here
          would be an unmeasured colour in the highest-stakes chrome in the product.
        */}
        <span
          className="rounded-md border border-warning/30 bg-warning/15 px-2 py-0.5 text-xs font-semibold tracking-wide text-warning uppercase"
          data-testid="platform-chip"
        >
          Platform
        </span>

        <nav aria-label="Platform" className="ml-4 flex items-center gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
