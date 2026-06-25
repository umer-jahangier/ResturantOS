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
