"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useTheme } from "@teispace/next-themes";
import { CornerDownLeft, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useZone } from "@/components/providers/zone-provider";
import { nextThemeInCycle } from "@/components/ui/theme-toggle";
import { matchScore } from "@/lib/command-palette/match";
import type { CommandCategory, CommandDescriptor } from "@/lib/command-palette/registry";
import { useCommandPalette } from "@/lib/hooks/ui/use-command-palette";
import { useOrderSummaries } from "@/lib/hooks/pos/use-orders";
import { useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import type { NavItem } from "@/components/shared/sidebar-nav-items";

/**
 * The command palette — the primary navigator (UI-SPEC §10, phase 20 §0).
 *
 * <h3>What was measured, and what it means</h3>
 *
 * The file this replaces was 87 lines. It rendered whatever `children` the top bar passed —
 * five links and a theme toggle — and filtered them with `cmdk`'s built-in **subsequence**
 * matcher. Typing `ord` returned one result, *Dashboard*, because d-a-s-h-b-**o**-a-**r**-**d**
 * contains o, r and d in that order. Nine tenths of the product was not in it at all.
 *
 * That is not a cosmetic gap. The sidebar carries 19–23 items depending on route and a keyboard
 * user spends 22 Tab presses reaching page content (38-15); the palette is the escape hatch from
 * both, and it did not work. It now searches **60 routes** — every screen the signed-in principal
 * is permitted to open, including the ~20 that have no sidebar entry at all — plus the quick
 * actions, plus live orders and vendors.
 *
 * <h3>The demo has no command palette, so this is spec-driven (D-38-15)</h3>
 *
 * `38-DECISIONS-DEMO.md` D-38-15 is explicit about what the demo may and may not be used for. It
 * contains no palette, so there is nothing to calibrate against and nothing has been invented to
 * look like one: the layout follows the shared dialog, the type roles and the surface tokens this
 * phase already fixed, and every behavioural rule comes from UI-SPEC §10's contract table.
 *
 * <h3>Layers (task 3)</h3>
 *
 * Nothing in this file imports Layer 1 or Layer 2 — no `api-client`, no repository, no `axios`.
 * The permitted, matched, ranked command list arrives from `useCommandPalette()` (Layer 3), and
 * the two live categories come from `useOrderSummaries` / `useVendors`, which are Layer-3 hooks
 * the POS and purchasing screens already use. `command-palette.test.tsx` asserts the import list,
 * because "does not fetch" is the kind of rule that is true on the day it is written.
 *
 * <h3>Zone — the rule that would otherwise be written and do nothing</h3>
 *
 * Radix portals this to `document.body`, outside every `ZoneProvider` subtree, so a zone-scoped
 * CSS rule written against DOM ancestry matches nothing here: present in the stylesheet, absent
 * on the screen. `useZone()` reads the zone at this component's position in the REACT tree — which
 * the portal preserves — and it is stamped onto the portalled node by hand, exactly as `dialog.tsx`
 * does for the overlay and as 34-01 established. Glass therefore applies only where the stamped
 * zone earns it, and never over the POS terminal or the KDS board.
 *
 * <h3>The body is a separate component, and that is load-bearing</h3>
 *
 * `PaletteBody` is mounted only while the dialog is open, so the order search does not exist —
 * not merely "is disabled" — on the 82 routes where the palette is shut. React forbids
 * conditional hooks; it does not forbid conditional components, and that distinction is what
 * lets a permission gate keep a request from being made at all: a cashier's palette never mounts
 * `VendorResults`, so `/api/v1/purchasing/vendors` is never called and never 403s.
 */

/** How many rows one live category may contribute. Enough to recognise, not enough to bury. */
const ENTITY_LIMIT = 6;

/**
 * Live categories wait for two characters. One character matches a large fraction of any
 * restaurant's order book and would send a request per keystroke for a result nobody can read.
 */
const MIN_ENTITY_QUERY = 2;

/**
 * The gate on the ORDER category — `pos.order.view` + `FEATURE_POS`, which is precisely what
 * `app/(tenant)/app/pos/orders/[orderId]/receipt/page.tsx` guards itself with. The category and
 * its destination are gated on the same code on purpose: reprinting is reading, and a result the
 * user may see is a result they may open.
 */
const ORDER_CATEGORY_GATE: NavItem = {
  label: "Orders",
  href: "/app/pos",
  icon: Search,
  permission: "pos.order.view",
  feature: "FEATURE_POS",
};

/** The gate on the VENDOR category — `vendor.view` + `FEATURE_VENDOR`, the purchasing layout's. */
const VENDOR_CATEGORY_GATE: NavItem = {
  label: "Vendors",
  href: "/app/purchasing/vendors",
  icon: Search,
  permission: "vendor.view",
  feature: "FEATURE_VENDOR",
};

/** The reveal the palette's theme action must use. See {@link PaletteBody} for why it is explicit. */
const CENTRED_THEME_REVEAL = {
  type: "circular",
  origin: "center",
  duration: 420,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * @deprecated Superseded by the registry and IGNORED.
   *
   * The prop is kept so `top-bar.tsx` — owned by another wave — continues to compile and continues
   * to open a working palette. What it used to pass (Dashboard, Your profile, Users, Settings,
   * Appearance, Toggle theme) is a strict SUBSET of what the registry now offers under the same
   * permission rules, so rendering it as well would only duplicate six rows. Nothing is lost by
   * dropping it and the fix goes live without waiting on a file this plan may not touch.
   */
  children?: React.ReactNode;
}

/** Human list: `a`, `a and b`, `a, b and c`. Used by the empty state to name what it searched. */
function formatList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const zone = useZone();

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="command-palette"
        data-zone={zone}
        data-testid="command-palette"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-2xl"
        aria-label="Command palette"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search every page, setting, action, order and vendor you have access to.
        </DialogDescription>
        <PaletteBody onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const {
    query,
    setQuery,
    debouncedQuery,
    hasQuery,
    groups,
    searchedCategories,
    isVisible,
    recordSelection,
  } = useCommandPalette();

  const listRef = React.useRef<HTMLDivElement>(null);
  const [selected, setSelected] = React.useState("");

  /**
   * Re-select the first row when the whole result set is replaced.
   *
   * <h3>A cmdk limitation, measured rather than assumed</h3>
   *
   * `cmdk@1.1.1` picks the first row only while its `value` is empty — its item-registration
   * callback reads `state.value || selectFirstItem()`. It clears that value when the SELECTED
   * element unmounts, but it finds that element by querying the DOM
   * (`[cmdk-item][aria-selected="true"]`) inside the unmount cleanup; when a filter change swaps
   * out every row at once, React has already detached it, the query returns null and the value is
   * left pointing at a row that no longer exists. The observable result is a palette where you
   * type `general ledger`, see exactly one row, press Enter — and nothing happens. That is the
   * whole point of a keyboard navigator, so it is repaired here rather than lived with.
   *
   * The repair reads the rendered list, and only acts when nothing at all is selected, so it
   * converges in one extra render and never fights the user's arrow keys. It is deliberately not
   * a synthetic key event: `value`/`onValueChange` are cmdk's documented controlled API.
   *
   * Known cost, stated plainly: cmdk refreshes `selectedItemId` — which backs
   * `aria-activedescendant` — only inside its own `setState('value')` path, which the controlled
   * prop bypasses. So on the render where this correction fires, `aria-selected` is right and
   * `aria-activedescendant` can lag by one row; the first arrow key restores it, because arrow
   * navigation goes through cmdk's own path. The alternative was leaving Enter dead.
   */
  // Deliberately dependency-free: the rendered rows change when the debounced query, the order
  // search or the vendor child's cache changes, and the last of those is not observable from here.
  // It cannot loop — it writes only when NOTHING is selected and the first row differs from what
  // is already stored, and cmdk marks that row selected on the very next render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const options = Array.from(list.querySelectorAll<HTMLElement>("[cmdk-item]"));
    if (options.length === 0) return;
    if (options.some((option) => option.getAttribute("aria-selected") === "true")) return;
    const first = options[0]?.getAttribute("data-value");
    if (first && first !== selected) setSelected(first);
  });

  const canSearchOrders = isVisible(ORDER_CATEGORY_GATE);
  const canSearchVendors = isVisible(VENDOR_CATEGORY_GATE);
  const entityQuery = debouncedQuery.length >= MIN_ENTITY_QUERY ? debouncedQuery : "";

  /**
   * The one server-side search in the palette. `/api/v1/pos/orders?q=` matches order number, table
   * name AND the attached customer's name or phone across every status (S0-05), so this single
   * category answers three of UI-SPEC §10's scope words rather than one.
   *
   * `enabled` is false unless the principal may see orders and has typed two characters, so this
   * costs nothing for a role without POS and nothing while the box is empty.
   */
  const orders = useOrderSummaries(undefined, {
    q: entityQuery,
    size: ENTITY_LIMIT,
    enabled: canSearchOrders && entityQuery.length > 0,
  });
  const orderRows = orders.data?.data ?? [];

  const searchedLabels: string[] = [
    ...(canSearchOrders ? ["Orders"] : []),
    ...(canSearchVendors ? ["Vendors"] : []),
    ...searchedCategories,
  ];

  function close() {
    onOpenChange(false);
  }

  /**
   * Run a registry command.
   *
   * <h3>`origin: "center"` is passed explicitly, and it is not redundant (D-38-14)</h3>
   *
   * `theme-provider.tsx` does set `origin: "center"` at the provider, but the fork's own default is
   * `'cursor'` — the circular reveal blooms from the last **pointerdown** position. A palette
   * driven entirely from the keyboard has no meaningful pointer position: the last click might have
   * been the ⌘K button, a table cell, or a spot the user has since scrolled away from, so the wipe
   * opens from an arbitrary corner and reads as a rendering glitch rather than an intent. Stating
   * it per call means this control keeps its behaviour even if the provider's default is ever
   * relaxed for a surface that genuinely wants a cursor-anchored reveal.
   *
   * The cycle itself is `nextThemeInCycle` — the same function the header's `ThemeToggle` uses.
   * GA-092 found this entry doing literally nothing (`document.documentElement.className` unchanged
   * before and after), and a binary flip written here instead would skip `system` and silently
   * disagree with the button three centimetres away.
   */
  function runCommand(command: CommandDescriptor) {
    recordSelection(command.id);
    close();
    if (command.effect === "toggle-theme") {
      setTheme(nextThemeInCycle(theme), { transition: CENTRED_THEME_REVEAL });
      return;
    }
    router.push(command.href);
  }

  /**
   * Open a live result. Deliberately NOT recorded in recents: an order number is a thing that
   * happened once, and keeping it would spend one of five slots on a check nobody will reopen
   * while pushing a route the user reaches daily off the list.
   */
  function openEntity(href: string) {
    close();
    router.push(href);
  }

  return (
    <Command
      label="Command palette"
      value={selected}
      onValueChange={setSelected}
      /**
       * The single most important prop in this file. `cmdk`'s built-in filter is `command-score`,
       * a SUBSEQUENCE matcher, and it is the entire reason `ord` returned *Dashboard*. Turning it
       * off hands both filtering and ordering to `matchScore` — prefix and word-boundary only —
       * and, per `Y()` in cmdk's source, makes `Command.Empty` render on "no items at all" rather
       * than "nothing passed my filter", which is what the empty state below needs.
       */
      shouldFilter={false}
      className="flex flex-col overflow-hidden [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-foreground-tertiary"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-foreground-tertiary" aria-hidden="true" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          data-testid="command-palette-input"
          placeholder="Search pages, settings, orders…"
          className="h-12 w-full bg-transparent text-body outline-none placeholder:text-foreground-tertiary"
        />
        <kbd className="hidden shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-label text-foreground-tertiary sm:inline">
          esc
        </kbd>
      </div>

      <Command.List
        ref={listRef}
        data-testid="command-palette-list"
        className="max-h-[min(60vh,26rem)] overflow-x-hidden overflow-y-auto p-1"
      >
        <Command.Empty className="px-4 py-8 text-center">
          {orders.isFetching ? (
            <p className="text-body text-foreground-secondary">Searching…</p>
          ) : (
            <>
              <p className="text-body text-foreground">{`Nothing matches "${debouncedQuery}".`}</p>
              {searchedLabels.length > 0 ? (
                <p className="mt-1 text-small text-foreground-tertiary">
                  {`Searched ${formatList(searchedLabels)}.`}
                </p>
              ) : null}
            </>
          )}
        </Command.Empty>

        {canSearchOrders && entityQuery.length > 0 && orderRows.length > 0 ? (
          <Command.Group heading="Orders">
            {orderRows.map((order) => {
              const label = order.orderNo ?? `Order ${order.orderId.slice(0, 8)}`;
              const meta = [order.derivedStatus.replaceAll("_", " ").toLowerCase(), order.tableName]
                .filter((part): part is string => Boolean(part))
                .join(" · ");
              return (
                <PaletteRow
                  key={order.orderId}
                  value={`order:${order.orderId}`}
                  testId={`command-palette-order-${order.orderId}`}
                  label={label}
                  meta={meta}
                  onSelect={() => openEntity(`/app/pos/orders/${order.orderId}/receipt`)}
                />
              );
            })}
          </Command.Group>
        ) : null}

        {canSearchVendors && entityQuery.length > 0 ? (
          <VendorResults query={entityQuery} onOpen={openEntity} />
        ) : null}

        {groups.map((group) => (
          <Command.Group key={group.category} heading={headingFor(group.category, hasQuery)}>
            {group.commands.map((command) => {
              const Icon = command.icon;
              return (
                <PaletteRow
                  key={command.id}
                  value={command.id}
                  testId={`command-palette-item-${command.id}`}
                  label={command.label}
                  meta={command.description}
                  icon={
                    <Icon className="size-4 shrink-0 text-foreground-tertiary" aria-hidden="true" />
                  }
                  onSelect={() => runCommand(command)}
                />
              );
            })}
          </Command.Group>
        ))}
      </Command.List>

      <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-3 py-2 text-label text-foreground-tertiary">
        <span className="inline-flex items-center gap-1">
          <CornerDownLeft className="size-3" aria-hidden="true" />
          to open
        </span>
        <span aria-hidden="true">↑↓ to move</span>
        <span className="ml-auto">esc to close</span>
      </div>
    </Command>
  );
}

/**
 * Vendors, matched client-side over the roster the purchasing screens already cache.
 *
 * A separate component because it must not exist unless the principal holds `vendor.view` — see
 * the note on `PaletteBody` above. `useVendors()` takes no `enabled` option, so a conditional
 * MOUNT is the only way to keep a cashier's palette from issuing a request that would 403.
 */
function VendorResults({ query, onOpen }: { query: string; onOpen: (href: string) => void }) {
  const { data } = useVendors();

  const matches = React.useMemo(() => {
    return (data ?? [])
      .filter((vendor) => vendor.active)
      .map((vendor) => ({
        vendor,
        score: matchScore(
          [vendor.name, vendor.contactPerson ?? "", vendor.phone ?? "", vendor.email ?? ""],
          query,
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.vendor.name.localeCompare(b.vendor.name))
      .slice(0, ENTITY_LIMIT);
  }, [data, query]);

  if (matches.length === 0) return null;

  return (
    <Command.Group heading="Vendors">
      {matches.map(({ vendor }) => (
        <PaletteRow
          key={vendor.id}
          value={`vendor:${vendor.id}`}
          testId={`command-palette-vendor-${vendor.id}`}
          label={vendor.name}
          meta={vendor.contactPerson ?? vendor.phone ?? undefined}
          onSelect={() => onOpen(`/app/purchasing/vendors/${vendor.id}`)}
        />
      ))}
    </Command.Group>
  );
}

function headingFor(category: CommandCategory, hasQuery: boolean): string {
  if (category === "Recent") return hasQuery ? "Recent" : "Recent — jump back in";
  return category;
}

/**
 * One row.
 *
 * `value` is set explicitly and is unique. cmdk derives a row's value from its text content when
 * none is given, and this list legitimately contains repeated labels (a "Vendors" page and a
 * "Vendors" category, "Settings" twice) — duplicate values collapse two rows into one selection
 * target and break arrow navigation in a way that looks like a rendering bug.
 */
function PaletteRow({
  value,
  label,
  meta,
  icon,
  testId,
  onSelect,
}: {
  value: string;
  label: string;
  meta?: string;
  icon?: React.ReactNode;
  testId: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      data-testid={testId}
      className={cn(
        "flex cursor-default items-center gap-3 rounded-md px-3 py-2 outline-none select-none",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-body">{label}</span>
      {meta ? (
        <span className="max-w-[45%] shrink-0 truncate text-small text-foreground-tertiary">
          {meta}
        </span>
      ) : null}
    </Command.Item>
  );
}

/**
 * Kept for `top-bar.tsx`, which still imports all three. They are no longer used by the palette
 * itself — its rows come from the registry — and they exist so the wave that owns the top bar can
 * remove its `children` block on its own schedule rather than in a commit it did not plan.
 */
function CommandItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof Command.Item>) {
  return (
    <Command.Item
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-body outline-none select-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Command.Group>) {
  return (
    <Command.Group
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-foreground-tertiary",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Command.Separator>) {
  return <Command.Separator className={cn("-mx-1 h-px bg-border", className)} {...props} />;
}

export { CommandPalette, CommandItem, CommandGroup, CommandSeparator };
