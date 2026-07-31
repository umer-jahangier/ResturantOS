---
phase: 12-reporting-dashboards-nlq
plan: 09
status: complete
completed: 2026-07-19
wave: 5
executed_by: delegated executor (plumbing + page + mocks), finished in the orchestrator main loop after the agent died on a network error mid nav-append
---

# 12-09 SUMMARY — NLQ frontend (ask page + honest rejection UI)

## What was built
- Four-layer plumbing: `nlq.schema.ts` (Zod) → `nlq.adapter.ts` → `nlq.model.ts`
  (`NlqResult`, `NlqRow`, the `NlqRejectionCode` union) → `nlq.repository.ts` (`runQuery`, body
  carries ONLY `question`) → `use-nlq.ts` (pinned `useMutation<NlqResult, ApiError, ...>`).
- `/app/nlq` page, gated FeatureGuard `FEATURE_NLQ` (GROWTH+) + PermissionGuard `nlq.query.run`.
- `NlqAskBox`, `NlqResultPanel` (rows + the executed, tenant/branch-scoped SQL), and
  `NlqRejectionNotice` — every typed RejectionCode + 429 mapped to a clear, non-blaming message;
  never a raw code, stack, or the rejected SQL (12-07 withholds it as an anti-oracle measure).
- "Ask (NLQ)" nav item (flat + grouped) in `components/shared/sidebar-nav-items.ts`.
- MSW fixtures (`mocks/nlq.ts`) for the happy path AND every rejection shape, registered in
  `server.ts`. `__tests__/nlq/nlq-journey.test.ts` drives happy + 4 rejections (typed code asserts).

## Verification
- `tsc --noEmit` → 0, zero `any`.
- `eslint` → 0 (see the boundary fix below); ~8 pre-existing errors in unrelated 07.3-10 files untouched.
- `vitest run` → **266/266** (incl. the 6 new nlq journey tests).
- `next build` → green; `/app/nlq` in the route manifest.
- No live stack this session — MSW round-trip is the accepted evidence (10-13-H precedent).

## Real defect fixed while finishing
The dead agent left a **four-layer boundary violation**: `NlqRejectionNotice.tsx` imported
`@/lib/api-client/errors` directly, which the ESLint `no-restricted-imports` rule forbids in
`components/**`. Re-exported the error type as `NlqQueryError` through the Layer-3 hook (`use-nlq`),
matching that hook's own documented intent (decisions 04-02-C / 10-12-D), and pointed the component
at the alias. `npm run build` alone did NOT catch this (Next's build didn't fail on it) — `eslint` did.

## Deviations / notes
- Sidebar nav lives at `components/shared/sidebar-nav-items.ts`, NOT the plan's
  `lib/navigation/sidebar-nav-items.ts` (12-08 already established this).
- The rejection copy frames tenant/branch-filter refusals as "we couldn't PROVE it was safe", not
  user error — the validator refusing an exotic-but-legit query is an accepted design cost (12-04).

## Commits
- `17ee4a7` NLQ four-layer plumbing + MSW fixtures for every rejection shape
- `65b03ce` ask page + rejection UI + nav item + journey test + the layer-boundary fix
