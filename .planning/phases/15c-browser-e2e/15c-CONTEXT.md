# Phase 15c — Browser E2E harness

**Branch:** `phase-13-access-repair`
**Requirement (verbatim):** rigorous browser testing of everything — "no system gap, no design
or UI/UX issue, no errors."

---

## Why this phase exists, in one paragraph

Phase 13 proved the **API** works: `seed_restaurantos.py --phase verify` logs 19 principals in
through the real gateway and calls a role-appropriate endpoint for each. That is a strong
claim and it is genuinely met. It is also **not the claim the user is making**. "Each role has
only its allowed functionality" is a statement about what a person sees and can reach in a
browser, and an HTTP 200 cannot answer it. The gap between "the API permits it" and "the UI
renders it" is exactly where this phase's findings live — and every one of them was invisible
to the existing verification.

The audit finding that motivated Phase 13 applies here in a second form:

> `.planning/phases/03-*/03-VERIFICATION.md` scored Phase 3 **24 / 24 passed** while citing a
> controller that does not exist.

A harness that is committed but never executed is the same failure wearing different clothes.
So the standard for this phase is: **every number reported is the output of a command run in
the state being reported**, and where a journey fails because the product is broken, that is
recorded as a defect rather than tuned away.

---

## What was already here

A prior design agent had built — but **not committed** — a real and well-reasoned foundation:

- `frontend/playwright.config.ts` with four projects (smoke / auth-setup / journeys / legacy)
- `e2e/fixtures/` — persona catalog, gateway client, TOTP, storage-state auth fixture
- `e2e/journeys/` — persona access matrix, TOTP step-up, tenant feature gating (30 tests)

It was verified first, not redone: **30/30 passed in 21.7s** before anything was added. Its
measured findings (the per-IP rate-limit budget, the `@Version` login race, the CORS
constraint on `X-Forwarded-For`, the POS service-worker hang) are load-bearing and were kept.

Two things it referenced did not exist: `.planning/research/adaptivity/browser-e2e.md` was
never written, and the work was untracked. This phase commits it.

---

## The three failure modes that make this stack hard to test

Each produces a RED SUITE THAT IS NOT A TEST FAILURE. All three were hit during this phase.

1. **A stale Eureka lease.** `/actuator/health` answers 200 on the service's own port while
   the gateway 503s everything routed to it. Hit twice: auth-service (its jar was replaced
   under the running JVM by a concurrent build → `NoClassDefFoundError` on a lazily-loaded
   class → heartbeat died → evicted), and platform-admin-service.
2. **A wedged service.** Health 200, every other path hangs.
3. **The per-IP credential bucket.** `/api/v1/auth/**` replenishes at 2/s with a burst of 100
   and `/auth/refresh` shares it, so every page load spends from it.

`scripts/e2e/browser-e2e.sh` checks all three **before** running anything and names them in
their own words, because debugging any of them as an assertion problem costs an hour.

---

## Design decisions

**D-15c-1 — The observability guard is opt-OUT, not opt-in.** Every page the suite opens is
watched for `console.error`, `pageerror`, and any 4xx/5xx. A spec that expects a failure
**declares** it (`obs.expect403(url, 'why')`); anything undeclared fails the test. This is
what turns "the page rendered" into "the page rendered correctly", and it found a defect on
its very first run.

**D-15c-2 — Known defects are a registry, not a loosened guard.** When the guard found a real
403, widening it would have destroyed its value everywhere and deleting the assertion would
have hidden the defect. Instead `e2e/fixtures/known-defects.ts` names each one with impact and
evidence, and `known-defects.spec.ts` **pins** it: the pin goes RED when the product is fixed,
telling the fixer to delete the entry. A tolerance that outlives its defect is indistinguishable
from a muted regression, and this is the only thing that can tell them apart.

**D-15c-3 — The role matrix is an independent specification.** `nav-matrix.ts` is hand-written
from **live permission sets read from real tokens**, not derived from
`sidebar-nav-items.ts`. Deriving it would assert the app's gating equals itself — a tautology
that passes even when the gating is wrong.

**D-15c-4 — Nav visibility and route access are asserted separately.** Hiding a nav item is
decoration; whether typing the URL gets you in is a different code path. Testing only the
first would have missed E2E-D2 entirely.

**D-15c-5 — The a11y gate is zero critical/serious, not zero violations.** A gate at
zero-of-everything gets switched off within a week. Moderate/minor findings are printed and
attached as JSON but do not block.

**D-15c-6 — SuperAdmin and user-provisioning journeys drive the API and assert in the browser.**
Not a shortcut: there is no SuperAdmin tenant UI (E2E-D3) and no user-management UI. The
control-plane action goes through the real gateway; the assertion that matters — the module
disappears for that tenant's user, the new user sees a scoped app — happens in a real browser.

**D-15c-7 — Test data is isolated by construction, and seeded data is restored.** Created
tenants/users carry a per-run id and the tenant is cancelled+purged afterwards. Feature
toggles on *seeded* tenants run inside `withRestored` so a failed run cannot leave the
environment dirty for every other spec.

---

## Scope boundary

Stayed inside `frontend/`, `frontend/e2e/`, `scripts/e2e/`, `.github/workflows/` and this
phase directory. No root-level Maven build was run. Concurrent work in `services/*`,
`shared-lib` and `gateway` was not touched — the gateway defect (E2E-D4) is **reported with
its exact remedy, not fixed here**.
