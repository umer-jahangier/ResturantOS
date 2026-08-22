"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, Search } from "lucide-react";
import { useTheme } from "@teispace/next-themes";

import { ThemeToggle, nextThemeInCycle } from "@/components/ui/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CommandPalette,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command-palette";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useLogout } from "@/lib/hooks/auth/use-logout";

interface TopBarProps {
  onMobileMenuToggle?: () => void;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Words the breadcrumb must not Title-Case, keyed by their URL form.
 *
 * <p>GA-095: `replace(/\b\w/g, c => c.toUpperCase())` capitalises the first letter of every word
 * and lowercases nothing, which is right for "purchase-orders" and wrong for every acronym in a
 * finance app. Live: `/app/finance/ar-aging` rendered "App Finance **Ar Aging**" and
 * `/app/finance/gl` rendered "**Gl**" — while the sidebar and the tab bar, three centimetres
 * away, both said "AR Aging" and "General Ledger" correctly. The user is left deciding whether
 * "Ar" and "AR" are the same screen.
 *
 * <p>An allow-list rather than a heuristic: "is this two letters?" would also shout at a genuine
 * two-letter word, and there is no rule that distinguishes an acronym from a short noun. These
 * are the segments the product actually routes on, and a new one is a one-line addition.
 */
const SEGMENT_OVERRIDES: Record<string, string> = {
  gl: "General Ledger",
  "ar-aging": "AR Aging",
  "ap-aging": "AP Aging",
  ar: "AR",
  ap: "AP",
  hr: "HR",
  kds: "KDS",
  pos: "POS",
  nlq: "Ask (NLQ)",
  fbr: "FBR",
  crm: "Customers",
  uom: "UoM",
  po: "PO",
};

// Prettify a URL path segment into a human-readable label.
function prettifySegment(segment: string): string {
  const override = SEGMENT_OVERRIDES[segment.toLowerCase()];
  if (override) {
    return override;
  }
  return segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The label for one segment, given the collection segment before it.
 *
 * <p>An id segment used to go through {@link prettifySegment} like any other, so every detail page
 * in the app — vendors, purchase orders, invoices, ingredients, customers — put a de-hyphenated,
 * Title-Cased UUID in the breadcrumb: "Purchasing › Vendors › 231aa42d 748f 42ed B80a 1f35c3a2498c".
 * It reads as a rendering bug, tells the user nothing, and pushes the useful part off the line.
 *
 * <p>Naming the record would be better still, but that needs a fetch per route; naming its TYPE
 * needs nothing and is already right in every case: "Vendors/{id}" is a Vendor.
 */
function segmentLabel(segment: string, parent: string | undefined): string {
  if (!UUID_SEGMENT.test(segment)) {
    return prettifySegment(segment);
  }
  if (!parent || UUID_SEGMENT.test(parent)) {
    return "Details";
  }
  return prettifySegment(parent.replace(/ies$/, "y").replace(/s$/, ""));
}

function Breadcrumb() {
  const pathname = usePathname();

  const allSegments = pathname.split("/").filter(Boolean);
  // Keep last 3 to avoid overflow — but resolve labels against the FULL path, so an id whose
  // collection fell outside the window is still named after it rather than becoming "Details".
  const start = Math.max(0, allSegments.length - 3);
  const segments = allSegments.slice(start);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1 text-sm">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const parent = allSegments[start + index - 1];
        return (
          <span key={index} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
            <span className={isLast ? "font-medium text-foreground" : "text-muted-foreground"}>
              {segmentLabel(segment, parent)}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

// Every entry here must resolve to a route that exists (UI-SPEC §4.2, §4.3).
// `/app/settings` used to sit in this list and in the profile menu below; it had no
// `page.tsx` and `sidebar-nav-items.ts` marked it `comingSoon: true` all along — only the
// shell chrome never got the memo. `/settings/profile` was dead the same way.
//
// 19-01: both destinations now exist — `/app/settings` and `/app/profile` have real pages —
// so they come back, each gated the way the page itself is. Profile carries no gate at all:
// every signed-in user has one, which is the point of GA-019.
// The real GlobalSearch (business objects, permission-filtered) is UI-SPEC §4.4 / step 6;
// this list stays a stopgap, but a stopgap without 404s.
const NAV_COMMANDS: { label: string; href: string; roles?: string[]; permissions?: string[] }[] = [
  { label: "Dashboard", href: "/app/dashboard" },
  { label: "Your profile", href: "/app/profile" },
  { label: "Users", href: "/app/users", permissions: ["rbac.manage", "rbac.user.manage"] },
  { label: "Settings", href: "/app/settings", permissions: ["rbac.manage", "branch.manage"] },
  { label: "Appearance", href: "/settings/appearance", roles: ["OWNER", "TENANT_ADMIN"] },
];

export function TopBar({ onMobileMenuToggle }: TopBarProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { userId, branchId, roles, permissions } = useCurrentUser();
  const canSeeAppearance = roles.includes("OWNER") || roles.includes("TENANT_ADMIN");
  // `any` of the listed codes, matching the backend's own `hasAnyAuthority(…)` gates: OWNER holds
  // `rbac.manage`, TENANT_ADMIN deliberately holds only the narrower codes (13-02).
  const canSeeSettings =
    permissions.includes("rbac.manage") || permissions.includes("branch.manage");
  const navCommands = NAV_COMMANDS.filter(
    (cmd) =>
      (!cmd.roles || cmd.roles.some((role) => roles.includes(role))) &&
      (!cmd.permissions || cmd.permissions.some((code) => permissions.includes(code))),
  );
  const {
    data: myBranches = [],
    isLoading: branchesLoading,
    isError: branchesError,
  } = useMyBranches();
  const logout = useLogout();

  // User initial for avatar circle — fallback to "U"
  const userInitial = userId ? userId.slice(0, 1).toUpperCase() : "U";
  const branchName =
    branchId != null ? (myBranches.find((branch) => branch.id === branchId)?.name ?? null) : null;

  function handleLogout() {
    logout.mutate();
  }

  return (
    <>
      {/*
       * Opaque, not translucent-plus-blur (D-34-02). This header is a sibling of the
       * page content, so it renders ABOVE the POS terminal and the KDS board on every
       * one of those routes — a compositing filter here is a compositing filter on the
       * operational zone, forcing a repaint of the screen beneath it on the cheap
       * Android tablet a restaurant actually buys. The chrome cannot be richer than the
       * poorest zone it can appear over.
       *
       * `bg-background` is the SAME role token the page beneath already resolves, so
       * this introduces no new contrast pairing: every text-on-header pairing is a
       * phase-20 §3.8 row that is already measured (foreground on background, 17.4:1
       * light / 16.1:1 dark). Separation is now carried by the border plus elev-1
       * rather than by translucency, which is what the token exists for.
       */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 shadow-elev-1 lg:px-6">
        {/* Mobile hamburger */}
        <button
          type="button"
          className="touch-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
          aria-label="Toggle mobile menu"
          onClick={onMobileMenuToggle}
        >
          <Menu className="size-5" />
        </button>

        {/* Breadcrumb */}
        <div className="flex-1">
          <Breadcrumb />
        </div>

        {/* Active branch indicator — always visible so users know their ABAC scope */}
        {/*
         * Three states, because the chip's own comment says it is "always visible so users know
         * their ABAC scope" — and a failed `useMyBranches` made it silently disappear, which is
         * the one outcome that comment forbids. A person who cannot see which branch they are
         * scoped to will read the figures on the screen as the whole business's.
         */}
        {branchesLoading ? (
          <Skeleton className="hidden h-6 w-28 md:inline-flex" aria-label="Loading branch" />
        ) : branchesError ? (
          <span
            data-testid="top-bar-branch-unavailable"
            title="The branch list could not be loaded, so the active branch cannot be named."
            className="hidden items-center rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-label font-medium text-warning md:inline-flex"
          >
            Branch unavailable
          </span>
        ) : branchName ? (
          <span className="hidden md:inline-flex items-center rounded-full border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {branchName}
          </span>
        ) : null}

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* ⌘K search button */}
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="hidden md:flex touch-target items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Open command palette"
          >
            <Search className="size-3.5" />
            <span className="text-xs">Search…</span>
            <kbd className="ml-1 hidden rounded border bg-background px-1 py-0.5 text-[10px] font-mono lg:inline">
              ⌘K
            </kbd>
          </button>

          {/* Mobile search icon */}
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="md:hidden touch-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Search"
          >
            <Search className="size-4" />
          </button>

          {/* GA-059: the notifications bell is gone, not quietened.

              It was a `<button>` with NO `onClick` (measured: `bellHasHandler=false`; clicking it
              left `body.innerHTML.length` unchanged at 54310 and opened zero popovers), carrying
              a permanent destructive red dot and the literal `aria-label="Notifications (3
              unread)"`. Every user, on every page, was told there were three unread items —
              screen-reader users were told it in those exact words — and no interaction could
              ever reveal them, because there is no notification reader anywhere in the product.

              A control that cannot act, advertising a count that is not real, is not a
              placeholder: it is the shell manufacturing anxiety it has no way to resolve.
              Removing it costs nothing (nothing was reachable through it) and removes a standing
              lie. Phase 25 owns the real notification centre and brings the bell back with a
              count that comes from the server. */}

          {/* Theme toggle (DS-07) */}
          <ThemeToggle />

          {/* Profile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="touch-target inline-flex size-8 items-center justify-center rounded-full bg-primary-solid text-primary-solid-foreground text-sm font-semibold transition-opacity hover:opacity-90"
                aria-label="Open profile menu"
              >
                {userInitial}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/* `Profile` → /settings/profile and `Settings` → /app/settings were removed here
                  because neither route existed. 19-01 built them, at `/app/profile` and
                  `/app/settings`, so they return — which is the whole of GA-019's second half:
                  for six of the eight seeded roles this menu was `Log out` alone.

                  Profile is offered to EVERYONE. It is the one page in the product whose gate is
                  "you are signed in": changing your own password takes the subject from the token
                  and has no field for anyone else, so there is no permission that could sensibly
                  withhold it. */}
              <DropdownMenuItem asChild>
                <Link href="/app/profile">Your profile</Link>
              </DropdownMenuItem>
              {canSeeSettings ? (
                <DropdownMenuItem asChild>
                  <Link href="/app/settings">Settings</Link>
                </DropdownMenuItem>
              ) : null}
              {canSeeAppearance ? (
                <DropdownMenuItem asChild>
                  <Link href="/settings/appearance">Appearance</Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={handleLogout}
                disabled={logout.isPending}
              >
                {logout.isPending ? "Logging out…" : "Log out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Command palette (DS-04 integration — DS-05 mount point) */}
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandGroup heading="Navigation">
          {navCommands.map((cmd) => (
            <CommandItem
              key={cmd.href}
              onSelect={() => {
                setCmdOpen(false);
                window.location.href = cmd.href;
              }}
            >
              {cmd.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          {/* GA-092: this was `onSelect={() => setCmdOpen(false)}` — it closed the palette and
              did nothing else. Measured `document.documentElement.className` before and after:
              `changed=false`. One third of the palette's entire contents was a no-op, while a
              working ThemeToggle sat in the same header. It now calls the same `next-themes`
              setter that toggle does, so the two agree. */}
          <CommandItem
            onSelect={() => {
              setCmdOpen(false);
              setTheme(nextThemeInCycle(theme));
            }}
          >
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandPalette>
    </>
  );
}
