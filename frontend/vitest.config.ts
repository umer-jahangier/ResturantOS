import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Root dir without a trailing slash so the "@/..." alias resolves like tsconfig.
const rootDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@\//, replacement: `${rootDir}/` }],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "__tests__/**/*.{test,spec}.{ts,tsx}",
      // 08.2-14: colocated component tests (components/**/__tests__/**) — the project's
      // established convention is __tests__/components/<domain>/**, but this plan's own
      // acceptance criteria fix the test file's path under components/inventory/__tests__/,
      // so the discovery glob is widened rather than fighting the plan's literal path.
      "components/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      // 26-01: colocated tests for the lib/ layers (schemas, adapters, models). Same reasoning as
      // the components glob above — the plan's acceptance criteria fix the test file's path at
      // lib/adapters/__tests__/print.adapter.test.ts, and a test file that no glob discovers is a
      // test file that silently never runs.
      "lib/**/__tests__/**/*.{test,spec}.{ts,tsx}",
    ],
    // Visible to the whole test process BEFORE any test module is imported, so the
    // module-level constant in lib/hooks/ws-base-url.ts captures the real gateway base
    // rather than undefined (which would fall back to same-origin ws://localhost:3000 under
    // jsdom — the exact regression the ws-base-url tests guard against). Mirrors
    // scripts/start-dev.sh / deploy/.env's dev value.
    env: {
      NEXT_PUBLIC_WS_BASE_URL: "ws://localhost:8080",
    },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      // FE is an "other" area (Pitfall 9): gate the touched contract files at ≥60%.
      thresholds: {
        "lib/repositories/session.repository.ts": {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
        "lib/adapters/auth.adapter.ts": {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
      },
    },
  },
});
