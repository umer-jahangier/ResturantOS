# Deferred Items — Phase 07.2

Out-of-scope discoveries logged during plan execution (not fixed, per Scope Boundary rule).

## From plan 07.2-07

- **`frontend/__tests__/lib/eslint-boundary.test.ts` > "flags a component importing a repository directly"** — times out (hardcoded 5000ms `it()` timeout vs. an actual ESLint `lintText()` run that took ~10s on this host). Confirmed pre-existing: file last touched in Phase 04-01 (commit `c5f2e5c`), untouched by any 07.2 plan, and fails identically in isolation (`pnpm vitest run __tests__/lib/eslint-boundary.test.ts`). Not caused by 07.2-07's changes — a slow-environment/timeout-tuning issue in a meta-test that lints ESLint's own config, unrelated to the finance files this plan touched. Recommend bumping the test's timeout (e.g. `it("...", async () => {...}, 15_000)`) in a future cleanup pass.
