import { defineConfig, devices } from "@playwright/test";

// D6/W1 scaffold: Playwright config + e2e job wiring only. The full ~50-journey
// suite runs against STAGING and spans every later phase — explicitly NOT a
// Phase-4 deliverable. E2E sources live under ./e2e with their OWN tsconfig so
// they never enter the app's tsc/lint (the app tsconfig excludes e2e/**).
const PORT = 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Build + start the standalone app for the smoke run; reuse a running dev
  // server locally. The protected-route redirect under test is enforced by
  // proxy.ts regardless of MSW, so no mock backend is required.
  webServer: {
    command: "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
