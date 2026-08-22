"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { useTheme } from "@teispace/next-themes";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format/locale";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { isOperatorRoute } from "@/components/pos/operator-strip";

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
    /*
     * `NEXUS_ERP_Demo.html:157-159` — three rules, and the third is the one that was missing:
     *
     *   .topbar-breadcrumb { font-size: 13px; color: var(--text-2); gap: 6px }
     *   .topbar-breadcrumb .current { color: var(--text); font-weight: 600 }
     *   .topbar-sep { opacity: 0.3 }
     *
     * The separator is a "/" at 30% opacity, not an icon. Its intent note is exact: *"the slash
     * never reads as content"*. A full-strength `ChevronRight` at the same size as the labels is
     * six glyphs of chrome competing with four words of information, which is what ours was.
     *
     * The ancestors dim and the CURRENT segment carries the weight, so the trail reads as one
     * line with an emphasis rather than as four equal words.
     *
     * <h3>Below `md` the trail collapses to its last segment — it does not disappear</h3>
     *
     * <p>This nav was `hidden md:flex`, and everything else on the bar that carries meaning is
     * `md:`-gated too: the branch chip, the connection pill and the clock. So the measured
     * phone rendering of this header was a hamburger, a stretch of empty bar, and three icons
     * — <b>the one surface that is on every screen never said which screen you were on</b>, on
     * the device class the product owner asked to be judged on.
     *
     * <p>The fix is not to shrink four segments onto a 390px line; it is to show the segment
     * that answers the question. The ancestors stay `hidden md:flex` (a phone user navigated
     * here and knows the path they took), the current segment truncates rather than wraps, and
     * the separators go with the ancestors so no line ever opens on a "/". At `md` and up the
     * full trail is byte-identical to what shipped.
     */
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-small">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const parent = allSegments[start + index - 1];
        return (
          <span
            key={index}
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
              {segmentLabel(segment, parent)}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

/**
 * Does the shell chrome render ABOVE an operational screen on this route?
 *
 * <p>The shell's own zone is `restrained` and cannot be anything else, because — as
 * `app/(tenant)/layout.tsx` puts it — *"the chrome cannot be richer than the poorest zone it can
 * appear over"*. But `restrained` is the zone of the CHROME, not of the page under it, and React
 * context cannot tell this component that a KDS board is mounted below: the zone provider for
 * the board lives inside `<main>`, i.e. underneath this header, not above it.
 *
 * <p>So the one perpetual animation in this file is gated on the ROUTE, the same instrument the
 * operator shell is gated on. `/app/pos/**` never reaches here at all (the layout returns the
 * operator shell before TopBar is rendered); `/app/kitchen/**` DOES — a KDS station board is a
 * back-office-shelled route — and a wall display that runs unattended for a twelve-hour shift is
 * the last surface in the product that should carry a 2s breathing dot two feet above it.
 */
function isOperationalRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (isOperatorRoute(pathname)) return true;
  return pathname === "/app/kitchen" || pathname.startsWith("/app/kitchen/");
}

/**
 * The LIVE pill (`NEXUS_ERP_Demo.html:175-182`), bound to something real.
 *
 * <h3>Why this is a connectivity pill and not a decoration that says LIVE</h3>
 *
 * The demo's pill is a static `<div>` and its dot pulses forever regardless of anything. Shipping
 * that would repeat GA-059 exactly: this shell already carried a notification bell with
 * `aria-label="Notifications (3 unread)"`, permanently, with no notification reader anywhere in
 * the product — and the note left when it was deleted is the rule for this file. *"A control that
 * cannot act, advertising a count that is not real, is not a placeholder: it is the shell
 * manufacturing anxiety it has no way to resolve."*
 *
 * <p>The demo's own INTENT note says what the device is for — *"a 2s breath that says this data is
 * arriving, not cached … earned because staleness is the one thing a live ops dashboard must
 * never fake"* — and this product has a truthful source for exactly that claim:
 * `lib/offline/use-online-status.ts`, the browser's `online`/`offline` events, already trusted by
 * the POS to decide whether an order is sent or queued. So the pill states connectivity: LIVE
 * when the screens can reach the server, OFFLINE when they cannot and the figures on screen are
 * therefore last-known rather than current. On a restaurant's wifi that is not a hypothetical.
 *
 * <h3>Three channels, not one (D-38-13 §4.2)</h3>
 *
 * Hue is never the only signal: the pill states the condition in WORDS, changes its border and
 * fill, and carries a `title` that says what the state means for what the reader is looking at.
 * It survives greyscale and colour-blindness with the text alone.
 */
function ConnectionPill({ animate }: { animate: boolean }) {
  const { isOnline } = useOnlineStatus();

  return (
    <span
      role="status"
      data-testid="top-bar-connection"
      data-online={isOnline}
      title={
        isOnline
          ? "Connected. Screens are reading from the server."
          : "No connection. Figures on screen are the last values received, not current ones."
      }
      className={cn(
        "hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-label font-semibold tracking-brandmark md:inline-flex",
        isOnline
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          isOnline ? "bg-success" : "bg-destructive",
          // Tailwind's stock `animate-pulse` is `pulse 2s … infinite` and its keyframe moves
          // OPACITY only — the demo's moves `transform: scale()` as well, which would make this
          // dot a containing block for fixed descendants and put a transform in the shell that
          // renders above `receipt-print.css`'s `position: fixed` bill. Same 2s breath, none of
          // the compositing consequences. Reduced motion removes it through the global net in
          // `globals.css`, which the demo's hand-rolled keyframe would also have needed.
          animate && "animate-pulse",
        )}
      />
      {isOnline ? "LIVE" : "OFFLINE"}
    </span>
  );
}

/**
 * The wall clock (`NEXUS_ERP_Demo.html:161-162` + `:1344`) — mono, dimmest tier, ambient.
 *
 * <h3>Two of this repo's lint rules meet here, and one shape satisfies both</h3>
 *
 * The precedent is `components/reporting/DashboardTileGrid.tsx:49-58`, which solved the identical
 * problem: `react-hooks/purity` forbids reading the wall clock during render (the prerender and
 * the hydration would disagree on a value that changes every second — a text mismatch), and
 * `react-hooks/set-state-in-effect` forbids seeding it synchronously from the effect body. So the
 * time lives in state and is written ONLY from timer callbacks, and until the first one fires
 * nothing is rendered — which is the honest rendering of "this component does not know what time
 * it is yet" and is also what makes the server and the client agree at first paint.
 *
 * <h3>Why it ticks every 30s and not every second</h3>
 *
 * The demo calls `toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })` on a 1s
 * interval — 59 of every 60 renders produce the identical string. This header is mounted on every
 * back-office route including the KDS board, so a per-second re-render of the whole top bar is a
 * cost paid on a wall display for a digit that does not exist. 30s is the coarsest interval that
 * cannot show a stale minute.
 *
 * <p>Formatted through `lib/format/locale.ts`, which pins BOTH the locale and the time zone. A
 * bare `toLocaleTimeString` is the G5 defect — it resolves to the server's ICU default in the
 * prerender and to `navigator.language` in the browser.
 */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    // Not called synchronously here: `react-hooks/set-state-in-effect`. A zero-delay timeout is
    // the next macrotask, so the clock still appears on the frame after mount.
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  if (!now) return null;

  return (
    <span className="hidden font-mono text-small tabular-nums text-foreground-tertiary md:inline">
      {formatDateTime(now, { hour: "2-digit", minute: "2-digit" })}
    </span>
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
  const isOperational = isOperationalRoute(usePathname());
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
       * poorest zone it can appear over. That rule is unchanged and is why the only
       * animation below is gated on the route.
       *
       * `bg-sidebar`, changed from `bg-background` (38-shell). The demo's topbar and its
       * rail are the SAME surface — both `--bg-2`, one step off the content ground
       * `--bg` (`NEXUS_ERP_Demo.html:69, :150`) — and that single fact is most of why its
       * chrome reads as a frame around the work rather than as more page. Ours painted
       * the header the same colour as the page, so there was nothing to frame.
       *
       * This is not a new colour and not a new pairing: `--sidebar` is a declared role
       * token that already encodes exactly this relationship (`--neutral-50` against a
       * `--neutral-0` page in light; `--neutral-950` against `--neutral-1000` in dark),
       * and the header's foreground pairings barely move. Measured against the shipped
       * stylesheet with the repo's own `css-tokens.ts` + `wcagContrastCheck`, `--background`
       * -> `--sidebar`:
       *
       *   light  --foreground        19.19 -> 18.38:1     dark  19.23 -> 18.38:1
       *   light  --muted-foreground   5.80 ->  5.55:1     dark   8.71 ->  8.32:1
       *
       * and the three tokens this rebuild newly puts on the chrome measure
       * --foreground-tertiary 5.55 / 8.32, --primary 5.60 / 9.19, --success 5.05 / 8.76
       * (light / dark) on `--sidebar`. Every one clears 4.5:1 with room. Separation is
       * still the border plus elev-1, never translucency.
       */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-sidebar-border bg-sidebar px-4 shadow-elev-1 lg:px-6">
        {/*
          Mobile hamburger. Carries the demo's `.topbar-btn` skin — 8px radius, hairline border,
          a recessed fill, and a hover that lifts the BORDER and the ink and nothing else
          (`DEMO-COMPONENTS.md:301`, intent: "the chrome stays quiet"). It is byte-identical to
          the mobile search button eight lines down, which already had it.

          It was `rounded-md` with no border and no fill: on a phone — where this is the FIRST
          control on the first bar of every screen — a bare glyph sitting beside two bordered
          chips does not read as restraint, it reads as an unstyled button. Three affordances on
          one bar wearing two different skins is the "3rd class" verdict in miniature.
        */}
        <button
          type="button"
          className="touch-target inline-flex items-center justify-center rounded-lg border border-border bg-surface-2 p-2 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground md:hidden"
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
          <span className="hidden md:inline-flex items-center rounded-full border bg-muted/60 px-2.5 py-0.5 text-label font-medium text-muted-foreground">
            {branchName}
          </span>
        ) : null}

        {/*
          The demo's right cluster, in its order (`NEXUS_ERP_Demo.html:161`,
          `.topbar-right { margin-left: auto; gap: 12px }`): status pill, then the mono clock,
          then the icon affordances, then identity. Ours keeps the branch chip in front of them
          because it is the one thing on this bar that changes what the NUMBERS underneath mean.
        */}
        <ConnectionPill animate={!isOperational} />
        <Clock />

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* ⌘K search button */}
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="hidden md:flex touch-target items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-small text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            aria-label="Open command palette"
          >
            <Search className="size-3.5" />
            <span className="text-label">Search…</span>
            {/* `--surface-3` rather than `--background`: the chip already sits on `--surface-2`,
                and a key printed in the PAGE colour on a chip that is not the page reads as a
                hole punched through the chrome. */}
            <kbd className="ml-1 hidden rounded-sm border border-border bg-surface-3 px-1 py-0.5 font-mono text-label lg:inline">
              ⌘K
            </kbd>
          </button>

          {/* Mobile search icon */}
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="md:hidden touch-target inline-flex items-center justify-center rounded-lg border border-border bg-surface-2 p-2 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
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
                className="touch-target inline-flex size-8 items-center justify-center rounded-full bg-linear-to-br from-primary-400 to-secondary-400 text-small font-bold text-primary-solid-foreground transition-opacity hover:opacity-90"
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
