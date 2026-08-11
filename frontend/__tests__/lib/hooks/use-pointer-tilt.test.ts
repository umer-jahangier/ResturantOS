import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePointerTilt } from "@/lib/hooks/ui/use-pointer-tilt";

/**
 * The tilt hook's three load-bearing properties: measure once, write once per frame, and refuse
 * to engage where it must not.
 *
 * <p>The measure-once behaviour is asserted by COUNTING `getBoundingClientRect` calls across a
 * burst of moves, not by reading the source. A hook that reads the rectangle per move benchmarks
 * beautifully in isolation and stutters on a real page, and no amount of reading the code makes
 * that visible — only counting does.
 */

let matches: Record<string, boolean> = {};
const listeners = new Map<string, Set<() => void>>();

function setMedia(query: string, value: boolean) {
  matches[query] = value;
  listeners.get(query)?.forEach((fn) => fn());
}

beforeEach(() => {
  matches = { "(prefers-reduced-motion: reduce)": false, "(pointer: coarse)": false };
  listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return matches[query] ?? false;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(fn);
    },
    removeEventListener: (_: string, fn: () => void) => listeners.get(query)?.delete(fn),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A stand-in element that counts its own measurements. */
function makeElement() {
  const el = document.createElement("div");
  const rectCalls = { count: 0 };
  el.getBoundingClientRect = () => {
    rectCalls.count += 1;
    return { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 } as DOMRect;
  };
  return { el, rectCalls };
}

const pointerEvent = (el: HTMLElement, clientX: number, clientY: number) =>
  ({ currentTarget: el, clientX, clientY }) as unknown as React.PointerEvent<HTMLElement>;

describe("usePointerTilt", () => {
  it("measures the element ONCE per gesture, not once per move", () => {
    const { el, rectCalls } = makeElement();
    const { result } = renderHook(() => usePointerTilt());
    result.current.ref.current = el;

    act(() => result.current.handlers.onPointerEnter(pointerEvent(el, 10, 10)));
    expect(rectCalls.count).toBe(1);

    act(() => {
      for (let i = 0; i < 50; i += 1) {
        result.current.handlers.onPointerMove(pointerEvent(el, 10 + i, 20 + i));
      }
    });

    expect(
      rectCalls.count,
      "the rectangle was re-read during pointer moves. That forces a synchronous layout on " +
        "every frame — the exact cost this phase claims to avoid.",
    ).toBe(1);
  });

  it("writes at most once per animation frame no matter how fast the pointer moves", async () => {
    const { el } = makeElement();
    const setProperty = vi.spyOn(el.style, "setProperty");

    const { result } = renderHook(() => usePointerTilt());
    result.current.ref.current = el;

    act(() => result.current.handlers.onPointerEnter(pointerEvent(el, 0, 0)));
    setProperty.mockClear();

    act(() => {
      for (let i = 0; i < 100; i += 1) {
        result.current.handlers.onPointerMove(pointerEvent(el, i, i));
      }
    });

    // Nothing written yet — the writes are coalesced into a frame.
    expect(setProperty).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    // One frame => two properties (x and y), not 200.
    expect(setProperty.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("writes ONLY transform-family custom properties", () => {
    const { el } = makeElement();
    const setProperty = vi.spyOn(el.style, "setProperty");
    const { result } = renderHook(() => usePointerTilt());
    result.current.ref.current = el;

    act(() => result.current.handlers.onPointerEnter(pointerEvent(el, 0, 0)));
    act(() => result.current.handlers.onPointerMove(pointerEvent(el, 150, 80)));
    act(() => result.current.handlers.onPointerLeave());

    for (const [prop] of setProperty.mock.calls) {
      expect(
        ["--tilt-x", "--tilt-y"].includes(prop as string),
        `the hook wrote "${prop}". It must write transform values only — anything else moves ` +
          `work onto the main thread.`,
      ).toBe(true);
    }
  });

  it("resets the tilt to zero on pointer leave", () => {
    const { el } = makeElement();
    const { result } = renderHook(() => usePointerTilt());
    result.current.ref.current = el;

    act(() => result.current.handlers.onPointerEnter(pointerEvent(el, 0, 0)));
    act(() => result.current.handlers.onPointerLeave());

    expect(el.style.getPropertyValue("--tilt-x")).toBe("0deg");
    expect(el.style.getPropertyValue("--tilt-y")).toBe("0deg");
  });

  it("does not engage on a coarse pointer — a POS tablet", () => {
    matches["(pointer: coarse)"] = true;
    const { el, rectCalls } = makeElement();
    const { result } = renderHook(() => usePointerTilt());
    result.current.ref.current = el;

    expect(result.current.active).toBe(false);
    act(() => result.current.handlers.onPointerEnter(pointerEvent(el, 0, 0)));
    act(() => result.current.handlers.onPointerMove(pointerEvent(el, 50, 50)));
    expect(rectCalls.count).toBe(0);
  });

  it("does not engage under a reduced-motion preference", () => {
    // This is imperative motion — no stylesheet rule can reach it, so the hook must consult
    // the preference itself.
    matches["(prefers-reduced-motion: reduce)"] = true;
    const { el, rectCalls } = makeElement();
    const { result } = renderHook(() => usePointerTilt());
    result.current.ref.current = el;

    expect(result.current.active).toBe(false);
    act(() => result.current.handlers.onPointerEnter(pointerEvent(el, 0, 0)));
    expect(rectCalls.count).toBe(0);
  });

  it("does not engage when explicitly disabled (outside the expressive zone)", () => {
    const { el, rectCalls } = makeElement();
    const { result } = renderHook(() => usePointerTilt({ enabled: false }));
    result.current.ref.current = el;

    expect(result.current.active).toBe(false);
    act(() => result.current.handlers.onPointerEnter(pointerEvent(el, 0, 0)));
    expect(rectCalls.count).toBe(0);
  });

  it("re-consults the preference when the user changes it MID-SESSION", () => {
    // A user who turns reduced motion on part-way through — often precisely because something
    // on screen is making them unwell — is honoured without a reload.
    const { el } = makeElement();
    const { result } = renderHook(() => usePointerTilt());
    result.current.ref.current = el;
    expect(result.current.active).toBe(true);

    act(() => setMedia("(prefers-reduced-motion: reduce)", true));

    expect(result.current.active).toBe(false);
    // And any transform already applied is dropped, rather than freezing the element at an angle.
    expect(el.style.getPropertyValue("--tilt-x")).toBe("0deg");
  });
});
