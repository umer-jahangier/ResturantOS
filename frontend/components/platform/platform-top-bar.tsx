"use client";

import { usePathname } from "next/navigation";
import { LogOut, Menu } from "lucide-react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useLogout } from "@/lib/hooks/auth/use-logout";
import { platformNavGroups } from "@/components/platform/platform-nav-items";

/**
 * The console's top bar — breadcrumb, the context chip, and the bordered icon cluster.
 *
 * <h3>The chip is the one thing on this bar that is not the tenant app</h3>
 *
 * UI-SPEC §7.5 requires a persistent `--warning` rule and a PLATFORM chip "so nobody ever
 * confuses a platform-wide action with a tenant-scoped one". Both are kept, both keep their
 * `data-testid`s (`platform-warning-rule` lives in the shell, `platform-chip` here), and the chip
 * keeps the exact token trio `StatusBadge` uses for its warning variant —
 * `bg-warning/15 text-warning border-warning/30` — rather than a bespoke pairing, because the
 * UI-SPEC contrast tables are measured against those combinations and a one-off here would be an
 * unmeasured colour in the highest-stakes chrome in the product.
 *
 * <h3>Everything else is the tenant top bar's skin, on purpose</h3>
 *
 * Same `bg-sidebar` ground (one step off the content background, which is what makes chrome read
 * as a frame around the work rather than as more page), the same 14-unit height, the same
 * `.topbar-btn` treatment on every affordance — 8px radius, hairline border, recessed fill, and a
 * hover that lifts the BORDER and the ink and nothing else. Three affordances on one bar wearing
 * two different skins is the "3rd class" verdict in miniature.
 */

/** The `.topbar-btn` skin (`DEMO-COMPONENTS.md:301`, intent: "the chrome stays quiet"). */
const ICON_BUTTON =
  "touch-target inline-flex items-center justify-center rounded-lg border border-border bg-surface-2 p-2 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground";

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `href` → the label the nav already uses for it.
 *
 * <p>Derived from `platformNavGroups` rather than restated, so the breadcrumb and the rail can
 * never disagree about what a screen is called. The tenant shell learned this the expensive way:
 * GA-095 shipped a breadcrumb that Title-Cased URL segments while the sidebar three centimetres
 * away used real names, leaving the reader to decide whether "Ar Aging" and "AR Aging" were the
 * same screen.
 */
const NAV_LABELS: Record<string, string> = Object.fromEntries(
  platformNavGroups.flatMap((group) => group.items.map((item) => [item.href, item.label])),
);

/** Segments that are the parents of a detail route and have no page of their own. */
const SEGMENT_LABELS: Record<string, string> = {
  platform: "Platform",
  tenants: "Tenants",
  dashboard: "Overview",
  users: "Users",
  rbac: "Roles & permissions",
  impersonations: "Impersonations",
  "operator-audit": "Operator audit",
  plans: "Plans",
  subscriptions: "Subscriptions",
  analytics: "Analytics",
  audit: "Audit trail",
  system: "System status",
};

/**
 * One crumb per segment, resolved against the whole path.
 *
 * <p>A UUID segment is named after its COLLECTION rather than printed. Before the tenant shell
 * fixed this, every detail page in the product put a de-hyphenated, Title-Cased UUID in the trail
 * — "Tenants › 231aa42d 748f 42ed B80a 1f35c3a2498c" — which reads as a rendering bug, tells the
 * reader nothing, and pushes the useful part off the line. Naming the record would be better
 * still, but that needs a fetch per route; naming its TYPE needs nothing and is already right.
 */
function crumbLabel(segments: string[], index: number): string {
  const segment = segments[index]!;
  const href = `/${segments.slice(0, index + 1).join("/")}`;

  const fromNav = NAV_LABELS[href];
  if (fromNav) return fromNav;

  if (UUID_SEGMENT.test(segment)) {
    const parent = index > 0 ? segments[index - 1] : undefined;
    if (!parent || UUID_SEGMENT.test(parent)) return "Details";
    const singular = (SEGMENT_LABELS[parent] ?? parent).replace(/ies$/, "y").replace(/s$/, "");
    return singular;
  }

  return SEGMENT_LABELS[segment] ?? segment.replace(/-/g, " ");
}

function PlatformBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    /*
     * `NEXUS_ERP_Demo.html:157-159` — the ancestors dim, the CURRENT segment carries the weight,
     * and the separator is a "/" at 30% opacity rather than an icon, so "the slash never reads as
     * content". A full-strength chevron at label size is chrome competing with information.
     *
     * Below `md` the trail collapses to its LAST segment rather than disappearing: this bar is on
     * every console screen, and a phone rendering that is a hamburger, empty bar and two icons
     * never says which screen you are on. The ancestors stay `hidden md:flex` — an operator
     * navigated here and knows the path they took — and the separators go with them, so no line
     * ever opens on a "/".
     */
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-small">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span
            key={`${segment}-${index}`}
            className={cn("items-center gap-1.5", isLast ? "flex min-w-0" : "hidden md:flex")}
          >
            {index > 0 && (
              <span aria-hidden="true" className="hidden opacity-30 select-none md:inline">
                /
              </span>
            )}
            <span
              className={cn(
                "truncate",
                isLast ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {crumbLabel(segments, index)}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

export interface PlatformTopBarProps {
  onMobileMenuToggle: () => void;
  mobileOpen: boolean;
}

export function PlatformTopBar({ onMobileMenuToggle, mobileOpen }: PlatformTopBarProps) {
  const logout = useLogout();

  return (
    /*
     * OPAQUE, not translucent-plus-blur. The console's zone is expressive and a glass header
     * would composite legibly here — but the shell pins this bar above the one scroll container
     * on the screen, so it is over every console grid all the time, and separation by border plus
     * `elev-1` costs no compositing layer and reads identically. It does NOT declare `sticky`: the
     * shell is `h-screen overflow-hidden` and `<main>` owns the scroll, so a sticky header here
     * would be a second mechanism for a job already done. `bg-sidebar` rather than
     * `bg-background` is the other load-bearing choice: the
     * demo's topbar and its rail are the SAME surface, one step off the content ground, and that
     * single fact is most of why its chrome reads as a frame around the work.
     */
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 shadow-elev-1 lg:px-6">
      <button
        type="button"
        onClick={onMobileMenuToggle}
        aria-label={mobileOpen ? "Close platform navigation" : "Open platform navigation"}
        aria-expanded={mobileOpen}
        className={cn(ICON_BUTTON, "md:hidden")}
      >
        <Menu className="size-5" />
      </button>

      {/*
        THE CONTEXT CHIP. Not decoration and not a badge for the product name — it is the answer
        to "whose data am I about to change?", carried on every screen of the console, in the one
        hue the system reserves for a consequence a reader must notice before they act.
      */}
      <span
        data-testid="platform-chip"
        title="Every action in this console affects a whole restaurant group, not one branch."
        className="inline-flex shrink-0 items-center rounded-md border border-warning/30 bg-warning/15 px-2 py-0.5 text-label font-semibold tracking-brandmark text-warning uppercase"
      >
        Platform
      </span>

      <div className="min-w-0 flex-1">
        <PlatformBreadcrumb />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Sign out"
          className={cn(ICON_BUTTON, "disabled:opacity-60")}
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
