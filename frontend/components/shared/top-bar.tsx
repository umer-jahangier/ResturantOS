"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronRight,
  Menu,
  Search,
} from "lucide-react";

import { ThemeToggle } from "@/components/ui/theme-toggle";
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
import { useLogout } from "@/lib/hooks/auth/use-logout";

const BRANCH_NAMES: Record<string, string> = {
  "b0000001-0000-4000-8000-000000000001": "Main Branch (HQ)",
  "b0000002-0000-4000-8000-000000000002": "Downtown Branch",
};

interface TopBarProps {
  onMobileMenuToggle?: () => void;
}

// Prettify a URL path segment into a human-readable label.
function prettifySegment(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function Breadcrumb() {
  const pathname = usePathname();

  // Split and filter empty segments; keep last 3 to avoid overflow
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .slice(-3);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1 text-sm">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span key={index} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight className="size-3 text-muted-foreground" />
            )}
            <span
              className={
                isLast
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }
            >
              {prettifySegment(segment)}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

const NAV_COMMANDS = [
  { label: "Dashboard", href: "/app/dashboard" },
  { label: "Settings", href: "/app/settings" },
  { label: "Appearance", href: "/settings/appearance" },
];

export function TopBar({ onMobileMenuToggle }: TopBarProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const { userId, branchId } = useCurrentUser();
  const logout = useLogout();

  // User initial for avatar circle — fallback to "U"
  const userInitial = userId ? userId.slice(0, 1).toUpperCase() : "U";
  // Branch name resolved from known seed branches; Phase-3 will use live API data
  const branchName = branchId ? (BRANCH_NAMES[branchId] ?? "Unknown Branch") : null;

  function handleLogout() {
    logout.mutate();
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur px-4 lg:px-6">
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
        {branchName && (
          <span className="hidden sm:inline-flex items-center rounded-full border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {branchName}
          </span>
        )}

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* ⌘K search button */}
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex touch-target items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
            className="sm:hidden touch-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Search"
          >
            <Search className="size-4" />
          </button>

          {/* Notifications bell */}
          <div className="relative">
            <button
              type="button"
              className="touch-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Notifications (3 unread)"
            >
              <Bell className="size-4" />
            </button>
            {/* Hardcoded stub count — real notification system in later phase */}
            <span
              className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-destructive"
              aria-hidden="true"
            />
          </div>

          {/* Theme toggle (DS-07) */}
          <ThemeToggle />

          {/* Profile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="touch-target inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Open profile menu"
              >
                {userInitial}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings/profile">Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/app/settings">Settings</Link>
              </DropdownMenuItem>
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
          {NAV_COMMANDS.map((cmd) => (
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
          <CommandItem onSelect={() => setCmdOpen(false)}>
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandPalette>
    </>
  );
}
