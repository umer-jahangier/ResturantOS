"use client";

import * as React from "react";

import { useReducedMotion } from "@/lib/hooks/ui/use-reduced-motion";

export interface PointerTiltOptions {
  /** Maximum rotation in degrees at the element's edge. Kept small — this is depth, not a toy. */
  maxDeg?: number;
  /** Disable entirely (e.g. the consuming component is not in the expressive zone). */
  enabled?: boolean;
}

export interface PointerTiltHandlers {
  onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}

export interface PointerTilt {
  ref: React.RefObject<HTMLElement | null>;
  handlers: PointerTiltHandlers;
  /** Whether the gesture is actually active — false on coarse pointers, reduced motion, disabled. */
  active: boolean;
}

/**
 * Pointer-driven tilt: a small rotation toward the cursor that reads as depth (D-34-06).
 *
 * <h3>Three properties this hook exists to guarantee</h3>
 *
 * <b>1. It measures once per gesture.</b> The element's rectangle is read on pointer ENTER and
 * cached for the duration. Reading `getBoundingClientRect()` inside the move handler forces a
 * synchronous layout on every frame — which is precisely the cost this phase claims to avoid,
 * and it produces a primitive that benchmarks beautifully in isolation and stutters on a real
 * page where the layout is expensive to recompute.
 *
 * <b>2. It writes once per frame.</b> Moves are coalesced through `requestAnimationFrame`, so a
 * 1000Hz gaming mouse cannot schedule 1000 style writes per second.
 *
 * <b>3. It writes transforms only, via custom properties.</b> The hook never touches the
 * stylesheet's own declarations; it sets `--tilt-x` / `--tilt-y` and the CSS decides what to do
 * with them. Nothing outside the transform and opacity families is animated, so the work stays
 * on the compositor.
 *
 * <h3>Where it refuses to engage, and why each is re-checked</h3>
 *
 * <ul>
 *   <li><b>Coarse pointer</b> — a POS tablet. There is no cursor to tilt toward, and a touch
 *       "hover" is a tap that has not committed yet.</li>
 *   <li><b>Reduced motion</b> — this is imperative motion, so the stylesheet's reduced-motion
 *       block cannot reach it. It has to consult the preference itself, and it re-consults when
 *       the user changes it mid-session.</li>
 *   <li><b>Explicitly disabled</b> — the consuming component passes `enabled: false` outside the
 *       expressive zone.</li>
 * </ul>
 *
 * <p>A POS tablet satisfies the first two of those, which is the point: the exclusion is not one
 * check that could be forgotten but three that overlap.
 */
export function usePointerTilt(options: PointerTiltOptions = {}): PointerTilt {
  const { maxDeg = 4, enabled = true } = options;

  const ref = React.useRef<HTMLElement | null>(null);
  const rect = React.useRef<DOMRect | null>(null);
  const frame = React.useRef<number | null>(null);
  const pending = React.useRef<{ x: number; y: number } | null>(null);

  const prefersReducedMotion = useReducedMotion();
  const coarsePointer = useCoarsePointer();

  const active = enabled && !prefersReducedMotion && !coarsePointer;

  const write = React.useCallback(() => {
    frame.current = null;
    const el = ref.current;
    const next = pending.current;
    if (!el || !next) return;
    el.style.setProperty("--tilt-x", `${next.x.toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${next.y.toFixed(2)}deg`);
  }, []);

  const clear = React.useCallback(() => {
    const el = ref.current;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pending.current = null;
    rect.current = null;
    if (el) {
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
    }
  }, []);

  // If the preference flips to reduced mid-gesture, drop any transform already applied rather
  // than leaving the element frozen at an angle.
  React.useEffect(() => {
    if (!active) clear();
  }, [active, clear]);

  React.useEffect(() => clear, [clear]);

  const onPointerEnter = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!active) return;
      // MEASURE ONCE. Everything after this is arithmetic on a cached rectangle.
      rect.current = e.currentTarget.getBoundingClientRect();
    },
    [active],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!active) return;
      const box = rect.current;
      if (!box || box.width === 0 || box.height === 0) return;

      // -0.5 … +0.5 from the element's centre.
      const px = (e.clientX - box.left) / box.width - 0.5;
      const py = (e.clientY - box.top) / box.height - 0.5;

      // Rotating about X responds to VERTICAL movement and vice versa — that inversion is what
      // makes the tilt feel like the surface leaning toward the cursor rather than away.
      pending.current = { x: -py * maxDeg * 2, y: px * maxDeg * 2 };

      if (frame.current === null) frame.current = requestAnimationFrame(write);
    },
    [active, maxDeg, write],
  );

  const onPointerLeave = React.useCallback(() => clear(), [clear]);

  return {
    ref,
    active,
    handlers: { onPointerEnter, onPointerMove, onPointerLeave },
  };
}

/** `(pointer: coarse)`, re-evaluated on change — a device can gain or lose a mouse. */
function useCoarsePointer(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const list = window.matchMedia("(pointer: coarse)");
      if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      }
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    },
    () => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
      return window.matchMedia("(pointer: coarse)").matches;
    },
    // Server: assume coarse, so the conservative first paint has no tilt.
    () => true,
  );
}
