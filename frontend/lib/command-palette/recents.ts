/**
 * The palette's recent selections — last five, per user, on this device.
 *
 * <h3>Why an external store rather than `useState` + `useEffect`</h3>
 *
 * `localStorage` does not exist while the page is being rendered on the server, so a naive
 * `useState(() => JSON.parse(localStorage…))` throws during SSR and the usual repair —
 * read it in an effect and `setState` — is the pattern `theme-toggle.tsx` already rejected here
 * (`react-hooks/set-state-in-effect`), because it renders once with the wrong answer and then
 * corrects itself in a second commit. `useSyncExternalStore` has a first-class server snapshot,
 * so the palette renders "no recents yet" on the server, the real five in the browser, and React
 * reconciles it as one hydration rather than a flash.
 *
 * The snapshot is the **raw JSON string**, not the parsed array: `useSyncExternalStore` compares
 * snapshots by identity and re-renders forever if `getSnapshot` mints a new array each call. The
 * cache below is what makes the string stable — it is only replaced when something actually
 * writes.
 *
 * <h3>Per user, and why that is not merely tidy</h3>
 *
 * A restaurant's back office is one physical machine that several people sign into during a day.
 * A shared recents list would show a manager's last five screens to the cashier who logs in after
 * them — a small leak of what management has been looking at, from a feature whose whole purpose
 * is convenience. Keyed by `userId`, so switching accounts switches the list. It is a convenience
 * cache and nothing more: ids only, no labels, no data, and an id whose command has since been
 * removed or become forbidden is dropped on read rather than rendered.
 */

export const RECENTS_LIMIT = 5;

const STORAGE_PREFIX = "restaurantos.command-palette.recents";
const EMPTY = "[]";

const listeners = new Set<() => void>();
const cache = new Map<string, string>();

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId || "anonymous"}`;
}

function readRaw(userId: string): string {
  const key = storageKey(userId);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let raw = EMPTY;
  try {
    raw = window.localStorage.getItem(key) ?? EMPTY;
  } catch {
    // Private-mode Safari and locked-down kiosk browsers both throw on access rather than
    // returning null. Recents are a convenience; losing them is not an error worth surfacing.
    raw = EMPTY;
  }
  cache.set(key, raw);
  return raw;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Stable snapshot for `useSyncExternalStore`. Returns the raw JSON, never a fresh array. */
export function recentsSnapshot(userId: string): string {
  if (typeof window === "undefined") return EMPTY;
  return readRaw(userId);
}

/** There are no recents on the server. Constant, so hydration has nothing to reconcile. */
export function recentsServerSnapshot(): string {
  return EMPTY;
}

export function subscribeRecents(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) {
      // Another tab wrote. Drop the cache so the next snapshot re-reads, then re-render.
      cache.clear();
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Parse a snapshot into ids. Tolerates anything — a corrupt entry costs the list, not the app. */
export function parseRecents(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/** Push `commandId` to the front, de-duplicated, capped at {@link RECENTS_LIMIT}. */
export function recordRecent(userId: string, commandId: string): void {
  if (typeof window === "undefined") return;
  const key = storageKey(userId);
  const next = [commandId, ...parseRecents(readRaw(userId)).filter((id) => id !== commandId)].slice(
    0,
    RECENTS_LIMIT,
  );
  const raw = JSON.stringify(next);
  cache.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Quota or a disabled store. The in-memory cache still serves this session.
  }
  notify();
}

/** Test seam — drops the memo so a fixture's `localStorage.setItem` is seen. */
export function resetRecentsCache(): void {
  cache.clear();
  notify();
}
