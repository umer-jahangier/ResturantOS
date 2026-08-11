# Phase 34 — deferred items

Out-of-scope discoveries found while executing this phase. Per the executor scope boundary,
these are logged and NOT fixed: they were not caused by this phase's changes and belong to
whoever owns the files.

## Pre-existing / concurrent-agent issues (not phase 34)

| Found | Item | Evidence | Owner |
|---|---|---|---|
| 34-01 task 2 | `lib/adapters/shared.ts:79` — `toLocaleString` called with `string \| number`, three overloads all reject it | `npx tsc --noEmit`. File modified at 22:11 **during** this phase's run by another executor agent; it typechecked clean at 22:09. | whoever is editing `lib/adapters/shared.ts` |
| 34-01 task 2 | `__tests__/lib/money-display-authority.test.ts:10` — cannot resolve `@shared-fixtures/money-display-vectors.json` | `npx tsc --noEmit`. Untracked file created at 22:10 by another agent; the tsconfig path alias does not exist. | same |
| 34-01 task 3 | `e2e/tables-and-menu-images.spec.ts:53` — "Object is possibly 'undefined'" | `npm run e2e:typecheck`. Unmodified in the working tree; last touched by commit `e55f4b8` (phase 19b). Genuinely pre-existing. | phase 19b surface |

## Environment conditions observed (not defects)

- **`pos-service` flaps repeatedly.** Another executor agent is adding `PrintJobService` /
  `PrintJobController` to `pos-service` and rebuilding it. The journeys observability guard
  fails any spec that observes a 503, so `operational-zone-containment.spec.ts` failed several
  runs for reasons unrelated to this phase. It passes in isolation against a settled service.
  The guard was deliberately **not** loosened — a blanket 503 tolerance would be a permanent
  hole for every spec in the suite, not just this one.

- **No POS persona can reach the order-detail drawer in the current seed.** Floor View renders
  zero table cards for saffron/zaitoon/marina POS personas, and every persona lands on "Your
  till is closed" because no till session is seeded. This is why 34-01's runtime portal test
  uses the command palette rather than the drawer the plan named. If a future phase wants that
  surface covered at runtime, the seed needs a table and an open till.
