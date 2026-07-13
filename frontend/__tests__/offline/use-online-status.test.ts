/**
 * useOnlineStatus (POS-26/D-11) — the hook must derive connectivity purely from
 * `navigator.onLine` + the browser `online`/`offline` events. It must NOT issue any
 * fetch on mount (the old implementation pinged `HEAD /api/v1/pos/menu/categories`,
 * which hit the Next origin with no auth/rewrite and produced repeated console 404s).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOnlineStatus } from "@/lib/offline/use-online-status";

describe("useOnlineStatus", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("issues NO fetch on mount", () => {
    renderHook(() => useOnlineStatus());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues NO fetch even after time passes (no ping interval)", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useOnlineStatus());
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns isOnline=true initially when navigator.onLine is true", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it("sets isOnline=false on an 'offline' event and true again on 'online'", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.isOnline).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.isOnline).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
