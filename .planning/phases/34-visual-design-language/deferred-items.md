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

## Added during 34-03

| Found | Item | Evidence | Owner |
|---|---|---|---|
| 34-03 task 1 | `next build` cannot be run to completion — another agent is mid-edit in `components/users/assign-role-dialog.tsx`, `components/users/user-detail-panel.tsx`, `lib/repositories/user.repository.ts`. The reported error changed between two consecutive runs (`PaginatedResult.items` missing, then `Cannot find name 'bulkApply'`), naming files phase 34 does not touch. | `npm run build`; file mtimes 11s before the run | whoever is editing `components/users/**` |

Phase 34's own files were verified clean by a scoped `tsc --noEmit` filter and by the full
unit suite. The build DID compile successfully in every run — only the typecheck stage failed,
and only on the other agent's in-flight files.

## Added at end of session (34-06 / 34-07)

**The journeys suite could not be re-run at the end of the phase.** `auth-setup` fails on the
SuperAdmin login with a 502 from the gateway, and earlier in the same window with a socket hang
up. A direct `curl` to `/api/v1/auth/login` returned 200 between those failures, so the stack is
flapping rather than broken.

Cause, as far as it can be attributed: the stale `git stash` popped mid-session left merge
conflicts in `gateway/src/main/resources/application.yml`,
`gateway/.../JwtGlobalFilter.java`, and four `auth-service` files. Another agent resolved and
rebuilt them; the 502 is consistent with `platform-admin-service` or its gateway route being
mid-restart.

**What this means for phase 34's evidence:** the runtime gates below were all observed GREEN
earlier in the session against a settled stack, and are green in the record, but were not
re-confirmed in one final consolidated run:

| Spec | Last observed |
|---|---|
| `operational-zone-containment.spec.ts` (POS + KDS sweeps, portal stamp) | green |
| `operational-zone-containment.spec.ts` — containing-block guard | green, plus its negative control |
| `reduced-motion.spec.ts` — 9 tests, both directions | green |

The **positive control** (`the dashboard resolves a compositing filter somewhere`) was still
SKIPPING at its last successful run, because the dashboard had no glass at that point. Glass
landed on the portlets afterwards (`794c7b9c`), so it should now pass — **that has not been
observed** and is the single most useful thing for whoever resumes to confirm first, since it is
what proves the containment gate is not passing merely because the product has no glass anywhere.

Unit coverage is unaffected: the full frontend suite is **876 tests / 91 files, all passing**,
lint clean (0 errors, 10 pre-existing warnings).
