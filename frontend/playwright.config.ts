import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright projects, in three tiers.
 *
 *   smoke      — always runs, needs NO backend. This is what CI's `e2e` job executes today
 *                (.github/workflows/ci.yml:357-385) and it must stay backend-free, because a
 *                job that needs sixteen Spring Boot services cannot run on a PR.
 *
 *   auth-setup — logs every seeded persona in through the REAL gateway and writes one
 *                storage state each, plus the tenant slug manifest. Serial, single worker:
 *                the gateway's /api/v1/auth/** bucket is per-IP (replenish 2/s, burst 100),
 *                so parallel logins spend one shared budget.
 *
 *   journeys   — the real browser suite. Depends on auth-setup. Requires a live stack AND a
 *                seeded database, so it is opt-in via E2E_STACK=1 rather than something a
 *                stray `pnpm e2e` can trip over with a confusing failure.
 *
 *   legacy     — the fifteen pre-existing live-stack specs at e2e/*.spec.ts. They predate
 *                this harness, hard-code `cashier@demo.local`, and are opt-in via
 *                E2E_LEGACY=1 so they neither block CI nor get silently deleted.
 *
 * Anything under e2e/ that is in no project's testDir simply does not run — that is the
 * intended containment, not an oversight.
 */

const PORT = 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

const STACK = process.env.E2E_STACK === "1";
const LEGACY = process.env.E2E_LEGACY === "1";

const chrome = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // 'list' locally; GitHub annotations in CI; always an HTML report so a failed journey can
  // be opened with its trace instead of re-run blind.
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },

  projects: [
    {
      name: "smoke",
      testDir: "./e2e/smoke",
      use: chrome,
    },

    ...(STACK
      ? [
          {
            name: "auth-setup",
            testDir: "./e2e/setup",
            testMatch: /.*\.setup\.ts$/,
            use: chrome,
            // One worker, serially: see the rate-limit note above.
            workers: 1,
            fullyParallel: false,
            /**
             * Nineteen logins cannot fit in Playwright's 30s default, and MUST NOT be made
             * to by removing the pacing that keeps them under the rate limit.
             *
             * The arithmetic: 19 logins × 550ms of deliberate pacing ≈ 10.5s floor, plus up
             * to 3s per TOTP-enrolled persona (6 of them) when `totpStable` declines to
             * submit a code that is about to expire mid-flight, plus linear backoff on any
             * transient 429/502/503. Measured: 9.7s–12.5s typically, and a 30s TIMEOUT
             * observed once on 2026-08-07 under load from a parallel suite.
             *
             * A timeout here fails EVERY journey (they all depend on this project), so the
             * budget is set well clear of the worst case rather than at the median.
             */
            timeout: 180_000,
          },
          {
            name: "journeys",
            testDir: "./e2e/journeys",
            dependencies: ["auth-setup"],
            use: chrome,
          },
        ]
      : []),

    ...(LEGACY
      ? [
          {
            name: "legacy",
            testDir: "./e2e",
            // Top-level specs only — not smoke/, setup/ or journeys/.
            testMatch: /e2e\/[^/]+\.spec\.ts$/,
            use: chrome,
          },
        ]
      : []),
  ],

  // With a live stack the app must be the DEV server talking to the real gateway: a
  // `pnpm build` here would take minutes and buy nothing, since the backend is already the
  // real one. Without a stack, build+start is what the CI smoke job wants.
  webServer: {
    command: STACK ? "pnpm dev" : "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
