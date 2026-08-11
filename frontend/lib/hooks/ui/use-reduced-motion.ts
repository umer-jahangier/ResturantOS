"use client";

import * as React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The user's reduced-motion preference, for IMPERATIVE motion (D-34-03).
 *
 * <h3>Why a hook is needed at all when the stylesheet already handles this</h3>
 *
 * A CSS media query cannot reach JavaScript-driven motion. A pointer-driven tilt writes a
 * transform from an event handler; no stylesheet rule is involved, so
 * `@media (prefers-reduced-motion: reduce)` has nothing to override. Any imperative motion in
 * this codebase therefore has to consult the preference ITSELF, and
 * `__tests__/lib/motion/motion-vocabulary.test.ts` asserts that every module writing a
 * transform from JavaScript imports this hook.
 *
 * <h3>Why it re-subscribes rather than reading once</h3>
 *
 * A user who turns the system setting on mid-session — often precisely because something on
 * screen is making them unwell — should be honoured immediately, not after a reload. The
 * listener is what makes that true.
 *
 * <h3>Why the server value is `true`</h3>
 *
 * There is no media query on the server. Resolving to `true` (motion suppressed) means the
 * server render and the first client paint are the CONSERVATIVE ones, and the correction after
 * hydration is *toward* motion rather than away from it. The opposite default flashes a
 * decorative animation at exactly the user who asked not to see one — which is the failure
 * that matters, and it is not symmetric with the other direction.
 *
 * <p>Implemented with `useSyncExternalStore`, the same SSR-safe pattern
 * `components/shared/page-transition.tsx` and `components/ui/theme-toggle.tsx` already use, so
 * there is no setState-in-effect and no hydration mismatch.
 */
export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const list = window.matchMedia(QUERY);
  // `addEventListener` is the modern API; `addListener` is kept for older WebViews, which is
  // the browser class this product actually runs on in a restaurant.
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

function getClientSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return true;
}
