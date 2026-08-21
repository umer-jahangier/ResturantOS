"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { NavGroup, NavItem } from "@/components/shared/sidebar-nav-items";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useNavGroupVisibility } from "@/lib/hooks/auth/use-nav-visibility";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { matchScore } from "@/lib/command-palette/match";
import {
  ACTION_COMMANDS,
  PAGE_COMMANDS,
  commandSearchFields,
  type CommandCategory,
  type CommandDescriptor,
} from "@/lib/command-palette/registry";
import {
  parseRecents,
  recentsServerSnapshot,
  recentsSnapshot,
  recordRecent,
  subscribeRecents,
} from "@/lib/command-palette/recents";

/**
 * Layer 3 for the command palette (38-11 task 3).
 *
 * <h3>What this hook is, and what it deliberately is not</h3>
 *
 * It answers three questions and no others: **which commands may this principal see**, **which of
 * them match what has been typed**, and **which did they pick last time**. It performs no I/O; the
 * registry it filters is a static module. That is why it is testable with nothing but a seeded
 * session, and why the palette component can be handed its output as plain props.
 *
 * <h3>Permission filtering reuses the sidebar's own hook — on purpose (task 4)</h3>
 *
 * `useNavGroupVisibility` composes four gates (`permission` with `all`/`any`, `feature`, `roles`,
 * `comingSoon`) and its output for six role fixtures is frozen by `nav-permission-matrix.test.tsx`.
 * That test says in as many words that *"whatever renders the nav after the revamp — rail, panel,
 * bottom bar, command palette — must route through it"*. So the whole registry is handed to it as
 * one synthetic group and filtered by the predicate it returns. A palette with its own permission
 * logic would be a fifth copy of the rules, and the first place a cashier would find General
 * Ledger.
 *
 * Note the posture this inherits: nav visibility **fails open** on an unreachable feature-flag
 * endpoint (GA-002 — one 503 once removed eight of eleven nav items). The palette is a menu, not
 * an authorization boundary; the worst case of a wrong yes is one refused round trip, and the
 * worst case of a wrong no is a restaurant that cannot find its own point of sale.
 *
 * <h3>The query is debounced; results are not cleared while it settles (task 9)</h3>
 *
 * Matching itself is synchronous and would not need a debounce — the debounce exists so the
 * ENTITY searches the component mounts off `debouncedQuery` do not fire a request per keystroke.
 * Because the previous `debouncedQuery` keeps producing results until the new one lands, the list
 * never blanks between keystrokes.
 */

export interface CommandGroupResult {
  category: CommandCategory;
  commands: CommandDescriptor[];
}

export interface UseCommandPaletteResult {
  /** The raw input value — bind it straight to the box. */
  query: string;
  setQuery: (next: string) => void;
  /** What searching should actually run against. */
  debouncedQuery: string;
  hasQuery: boolean;
  /** Recents, quick actions, pages and settings — already permission-filtered and matched. */
  groups: CommandGroupResult[];
  /** The categories this principal's palette searches, for the empty state to name. */
  searchedCategories: CommandCategory[];
  /** The sidebar's own predicate, exposed so entity categories can be gated with it too. */
  isVisible: (item: NavItem) => boolean;
  /** Remember a selection. `id` is a registry id or an entity id — anything stable. */
  recordSelection: (commandId: string) => void;
}

const ALL_COMMANDS: CommandDescriptor[] = [...ACTION_COMMANDS, ...PAGE_COMMANDS];

const COMMANDS_BY_ID = new Map(ALL_COMMANDS.map((command) => [command.id, command]));

/**
 * One synthetic group so `useNavGroupVisibility` — which takes a `NavGroup` — can filter the whole
 * registry with a single hook call. `CommandDescriptor extends NavItem`, so this is a widening
 * cast and not a conversion.
 */
const REGISTRY_AS_NAV_GROUP: NavGroup = { label: "Command palette", items: ALL_COMMANDS };

/** The order groups appear in. Entity categories are interleaved by the component. */
const STATIC_CATEGORY_ORDER: CommandCategory[] = ["Recent", "Quick actions", "Pages", "Settings"];

const DEBOUNCE_MS = 150;

function rank(command: CommandDescriptor, query: string): number {
  return matchScore(commandSearchFields(command), query);
}

export function useCommandPalette(): UseCommandPaletteResult {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  const { userId } = useCurrentUser();
  const { isItemVisible } = useNavGroupVisibility(REGISTRY_AS_NAV_GROUP);

  const recentsRaw = useSyncExternalStore(
    subscribeRecents,
    () => recentsSnapshot(userId),
    recentsServerSnapshot,
  );

  const visibleCommands = useMemo(
    () => ALL_COMMANDS.filter((command) => isItemVisible(command)),
    [isItemVisible],
  );

  const groups = useMemo<CommandGroupResult[]>(() => {
    const byCategory = new Map<CommandCategory, CommandDescriptor[]>();

    if (hasQuery) {
      const scored = visibleCommands
        .map((command) => ({ command, score: rank(command, trimmedQuery) }))
        .filter((entry) => entry.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.command.label.length - b.command.label.length ||
            a.command.label.localeCompare(b.command.label),
        );
      for (const { command } of scored) {
        const bucket = byCategory.get(command.category) ?? [];
        bucket.push(command);
        byCategory.set(command.category, bucket);
      }
    } else {
      // No query: the palette is a directory. Recents lead, then the verbs, then everywhere the
      // principal may go — which for most roles is the first time the whole of their product has
      // been listed in one place.
      const recentCommands = parseRecents(recentsRaw)
        .map((id) => COMMANDS_BY_ID.get(id))
        .filter((command): command is CommandDescriptor => command !== undefined)
        // A command that has since been revoked or removed is dropped, never rendered greyed.
        .filter((command) => isItemVisible(command));
      if (recentCommands.length > 0) byCategory.set("Recent", recentCommands);

      for (const command of visibleCommands) {
        const bucket = byCategory.get(command.category) ?? [];
        bucket.push(command);
        byCategory.set(command.category, bucket);
      }
    }

    return STATIC_CATEGORY_ORDER.filter((category) => (byCategory.get(category)?.length ?? 0) > 0)
      .map((category) => ({ category, commands: byCategory.get(category) ?? [] }));
  }, [hasQuery, trimmedQuery, visibleCommands, recentsRaw, isItemVisible]);

  /**
   * The categories this principal's palette can search — computed from what they may actually
   * see, not from a constant. D-38-16's rule about numbers applies to promises too: an empty state
   * that lists "Vendors" to someone with no purchasing access is telling them their search covered
   * ground it never touched.
   */
  const searchedCategories = useMemo<CommandCategory[]>(() => {
    const present = new Set(visibleCommands.map((command) => command.category));
    return STATIC_CATEGORY_ORDER.filter(
      (category) => category !== "Recent" && present.has(category),
    );
  }, [visibleCommands]);

  const recordSelection = useCallback(
    (commandId: string) => {
      recordRecent(userId, commandId);
    },
    [userId],
  );

  return {
    query,
    setQuery,
    debouncedQuery: trimmedQuery,
    hasQuery,
    groups,
    searchedCategories,
    isVisible: isItemVisible,
    recordSelection,
  };
}
