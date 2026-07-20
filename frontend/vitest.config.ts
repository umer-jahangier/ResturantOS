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
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
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
