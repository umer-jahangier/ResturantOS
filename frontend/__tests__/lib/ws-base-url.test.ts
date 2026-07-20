/**
 * Proves the single-source-of-truth WS base resolver (lib/hooks/ws-base-url.ts):
 * - configured NEXT_PUBLIC_WS_BASE_URL is used verbatim as the FULL base (no re-prepended
 *   scheme) — this is the root-cause fix for UAT Test 3 (RPT-02) / Test 4.
 * - unset/empty falls back to a same-origin window.location-derived base.
 * - STATIC GUARD: none of the three browser WS hooks can reference an unset
 *   NEXT_PUBLIC_*_WS_URL or build a socket URL directly from window.location.host — the
 *   historical bug (silently targeting ws://localhost:3000, which does not proxy WS
 *   upgrades) can never silently reappear.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOOK_FILES = [
  "lib/hooks/reporting/use-dashboard-socket.ts",
  "lib/hooks/kds/use-kds-socket.ts",
  "lib/hooks/pos/use-pos-orders-socket.ts",
] as const;

// vitest runs with cwd at the frontend/ package root (see vitest.config.ts's rootDir alias).
const repoRoot = process.cwd();

describe("ws-base-url", () => {
  const originalEnv = process.env.NEXT_PUBLIC_WS_BASE_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_WS_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_WS_BASE_URL = originalEnv;
    }
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("builds a WS URL from the configured full ws:// base without re-prepending a scheme", async () => {
    process.env.NEXT_PUBLIC_WS_BASE_URL = "ws://localhost:8080";
    vi.resetModules();
    const { wsUrl } = await import("@/lib/hooks/ws-base-url");

    const url = wsUrl("/api/v1/reporting/dashboard/x");

    expect(url).toBe("ws://localhost:8080/api/v1/reporting/dashboard/x");
    expect(url).not.toContain("ws://ws://");
    expect(url).not.toContain("localhost:3000");
  });

  it("falls back to a same-origin base when the env var is unset/empty", async () => {
    delete process.env.NEXT_PUBLIC_WS_BASE_URL;
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "app.example.com" },
    });
    vi.resetModules();
    const { resolveWsBaseUrl } = await import("@/lib/hooks/ws-base-url");

    expect(resolveWsBaseUrl()).toBe("wss://app.example.com");
  });

  describe("static guard — the localhost:3000 regression can never silently reappear", () => {
    it.each(HOOK_FILES)("%s never references an unset NEXT_PUBLIC_*_WS_URL", (relPath) => {
      const source = readFileSync(path.join(repoRoot, relPath), "utf-8");
      expect(source).not.toMatch(/NEXT_PUBLIC_\w*_WS_URL/);
    });

    it.each(HOOK_FILES)("%s never builds its socket URL directly from window.location.host", (relPath) => {
      const source = readFileSync(path.join(repoRoot, relPath), "utf-8");
      expect(source).not.toMatch(/window\.location\.host/);
    });

    it.each(HOOK_FILES)("%s builds its socket URL via wsUrl(", (relPath) => {
      const source = readFileSync(path.join(repoRoot, relPath), "utf-8");
      expect(source).toMatch(/wsUrl\(/);
    });
  });
});
