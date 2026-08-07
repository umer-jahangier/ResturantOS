---
phase: 14b
plan: "01"
subsystem: frontend-shell
tags: [truth-and-trust, error-states, query-boundary, totp-enrolment, money-display, nav-visibility]
status: complete
requires:
  - 16a-01 (email-first login — GA-008's slug problem exists *because* of it)
  - 20 (design-system tokens — every colour used here is one of theirs)
provides:
  - QueryBoundary / QueryErrorNotice — the app-wide contract that a failed query cannot render as empty
  - TotpEnrollment — first-time second-factor setup, the only path out of the new-tenant lockout
  - GET /api/v1/auth/tenants/{id} — session-derived tenant branding
  - app/not-found.tsx — a recoverable dead end
affects:
  - 22 (screen rebuilds — every list screen now has a failure contract to build on)
  - 23 (admin surfaces — inherits the enrolment flow; owes it a QR code, GA-101)
  - 17 (loyalty redeem — owns putting LOYALTY_POINTS back)
tech-stack:
  added: []
  patterns:
    - "QueryBoundary takes the query RESULT, not booleans, so `isError` cannot be forgotten"
    - "Navigation fails open; entitlement stays fail-closed (D-14b-1)"
    - "Credentials for re-authenticating flows stay in component state, never a route param"
key-files:
  created:
    - frontend/components/ui/query-boundary.tsx
    - frontend/components/auth/totp-enrollment.tsx
    - frontend/lib/hooks/auth/use-totp-enrollment.ts
    - frontend/app/not-found.tsx
    - scripts/e2e/_14b-shots.mjs
    - scripts/e2e/_14b-probe.mjs
  modified:
    - frontend/lib/hooks/auth/use-nav-visibility.ts
    - frontend/lib/hooks/use-tenant-brand.ts
    - frontend/components/auth/login-form.tsx
    - frontend/components/shared/top-bar.tsx
    - frontend/components/shared/sidebar-nav-items.ts
    - frontend/components/pos/charge-summary.tsx
    - frontend/components/dashboard/tenant-dashboard.tsx
    - services/auth-service/.../AuthController.java
    - services/auth-service/.../TotpEnrollmentRequiredException.java
decisions:
  - D-14b-1 Navigation fails OPEN while entitlement stays fail-CLOSED; they answer different questions
  - D-14b-2 LOYALTY_POINTS removed from the tender picker, kept in the type and schemas
  - D-14b-3 QueryBoundary ships as a component; the lint rule is deferred
  - D-14b-4 The TOTP-enrolment refusal carries the tenant slug, disclosed only after password proof
  - D-14b-5 GA-096 is misdiagnosed in the register — relabelled, not deleted
metrics:
  duration: one session
  completed: 2026-08-07
  screens_converted: 22
  defects_closed: 16
  browser_checks_passing: 26/26
---

# Phase 14b Plan 01: Truth and trust triage — Summary

**Sixteen defects that made a working product look broken and empty, fixed and demonstrated in a
real browser: a failed request now shows failure instead of "you have no data", a 503 no longer
deletes two thirds of the navigation, money is no longer 100× wrong, the free-food tender is gone,
and a brand-new restaurant's owner can now actually log in.**

---

## 1. What was wrong, and what it looks like now

Every row below was reproduced live before the fix and re-measured after. Screenshots are in
`shots/before/` and `shots/after/`.

| ID | The product said | The truth was | Now |
|---|---|---|---|
| **GA-001** | "No vendors yet" | the request returned **500** | "Couldn't load vendors." + **Try again** |
| **GA-002** | *(8 of 11 nav items simply absent)* | `/api/v1/feature-flags` returned **503** | all 19 nav links render; measured `with503=19 healthy=19` |
| **GA-007** | Total debit **388,600** | Rs 3,886.00 | `Rs 290.00`, matching its own line rows |
| **GA-006** | Loyalty points is a payable tender | nothing checks a points balance | not offered |
| **GA-008** | "Ask an administrator to complete enrolment" | the owner **is** the only account | enrolment, in place, → signed in |
| **GA-023** | "Rs 0.00 · 0 completed orders" | 20 closed orders, Rs 30,310.80 | **Rs 30,310.80 · 20 completed orders** |
| **GA-032** | "Lume" | the tenant is Floating Terrace | **Floating Terrace** |
| **GA-053** | *(a link to a bare Next 404)* | the screen is not built | `comingSoon`, and the 404 has a way back |
| **GA-091** | same, in the second nav list | same | both lists consistent |
| **GA-059** | "Notifications (3 unread)" + red dot | no notification reader exists | removed |
| **GA-092** | "Toggle theme" | closed the palette, changed nothing | `{"stored":null} → "light" → "dark"` |
| **GA-094** | "E to export" | the handler body was empty | claim and dead branch both gone |
| **GA-095** | "Ar Aging", "Gl" | the sidebar said "AR Aging", "General Ledger" | **AR Aging**, **General Ledger** |
| **GA-078** | "₨ 2,500.5" | Rs 2,500.50 | `Rs 2,500.50` / `Rs 2,500.00` |
| **GA-093** | *(claimed unlabelled checkbox)* | **it was already labelled** | see §4 |
| **GA-096** | *(claimed dev button)* | **a real setup action** | see §4 |

---

## 2. GA-001 — the big one

### What it actually was

Two shapes, not two typos:

```ts
// 1. error deliberately folded into empty, in one expression
if (isError || !data?.data.length) return <EmptyState/>;   // JournalEntryTable.tsx:37

// 2. isError never destructured, so failure becomes [] one line later
const { data, isLoading } = useVendors();
const vendors = data ?? [];                                // purchasing/vendors/page.tsx:12
```

Shape 2 is why `QueryBoundary` takes the **query result** rather than three booleans. A caller
cannot pass a query and forget its error the way they can forget to destructure one — the failure
mode that produced the bug is not reachable through the API.

Precedence is fixed at `error → loading → empty → children`, and error is checked first, because a
query that has failed has no trustworthy `data`, so "is it empty?" is not yet an honest question.
Inverting those two *is* shape 1.

### Scope

**22 screens converted.** The register said 11 of 15; the sweep found more, including two variants
it had not named:

- **The eternal spinner** — `inventory/coverage/page.tsx` used `if (isLoading || !coverage)`, which
  also matches the error case (a failed query has no data), so the screen said "Loading coverage…"
  forever. The same lie in a different tense.
- **Sub-panels** — `till-review.tsx`'s reconciliation detail and review history both rendered "No
  data." / "No review actions yet." on a failed read. On a cash count, "there were no orders" and
  "we could not read the orders" are opposite conclusions.

`HrErrorNotice` — which HR had built for exactly this reason before the rest of the product noticed
— became a thin alias of the shared notice, so the whole app reads as one system. `inventory/stock`
was already one of the four screens that got this right; it gained `role="alert"` and a retry.

### Measured

Twelve screens, each with its own endpoint forced to 500 in a real browser:

```
PASS  GA-001 vendors: 500 renders an error, not an empty state — alerts=2 emptyStateText=false
PASS  GA-001 journal entries … accounts … ingredients … purchase orders … vendor invoices
PASS  GA-001 expenses … house accounts … periods … menu … categories … reports
```

---

## 3. GA-002 — and why it is not an authorization change

The line was `if (isPending) return false`. **PENDING was treated as DENIED.**

It is not. Pending means *the answer is not available yet*, which is the same epistemic state as
`isError` — and the code already handled `isError` correctly by failing open. The cruel detail: a
503 with TanStack's retry policy keeps the query **pending** through its entire backoff, so the
broken branch was the one that ran and the correct branch was never reached.

**D-14b-1.** Plan 13-03's fail-closed **entitlement** decision stands and is untouched. These are
different questions:

| | Entitlement (13-03) | Navigation (14b) |
|---|---|---|
| Question | "May this request proceed?" | "Should this link be drawn?" |
| Enforced at | gateway / service `@PreAuthorize` | browser DOM |
| Cost of a wrong YES | unauthorised access | a link that 403s |
| Cost of a wrong NO | one refused request | **the product silently shrinks** |
| Posture | **fail closed** | **fail open** |

Failing open in the sidebar **grants nothing**. The sidebar is not an authorization boundary and
never was — `JwtGlobalFilter` and each service's `@PreAuthorize` are, and neither consults the DOM.
Permission and role gates are deliberately unchanged: they read the signed JWT, which is present
synchronously and cannot 503, so they have no "not known yet" state to mishandle.

---

## 4. Corrections to the register

The register was written by nine agents and asked to be corrected where wrong. Two entries are.

### GA-093 — "unlabelled 16×16 checkbox" is a **false positive**

The register reported "no `id`, no `aria-label`, no associated `<label>` … the visible words 'Show
inactive' are not programmatically connected."

Measured in the live DOM:

```json
{"ariaLabel": null, "id": null, "wrappingLabelText": "Show inactive"}
```

The input is **nested inside** its `<label>`, which is implicit labelling and is exactly as valid as
`for`/`id`. Assistive technology computes the accessible name "Show inactive" from it. The audit
almost certainly checked for `id`/`aria-label` attributes and did not consider label wrapping.

**No change made.** Adding a redundant `aria-label` would be churn, and the identical markup on
Inventory → Categories ("Show archived") would have been "fixed" the same way for the same
non-reason.

### GA-096 — "developer button ships on HR attendance" is **half right, and the half it got wrong is the destructive half**

The register asked for the "Seed default leave types" button to be **deleted**. Deleting it would
have been a regression:

- it calls `POST /api/v1/hr/leave/types/defaults` — a real endpoint, `@PreAuthorize`'d on
  `hr.attendance.manage`, idempotent by construction;
- `POST /api/v1/hr/leave/types` has **no frontend caller anywhere**, so this is the *only* way to
  create a leave type from inside the product;
- remove it and a new tenant can never request leave, because the request form's type dropdown
  stays permanently empty.

What *was* wrong is the language. "Seed" is developer vocabulary, on a bare `ghost` button, with no
explanation — which is precisely why a button inventory read it as leftover tooling. It now says:

> No leave types exist yet, so nobody can request leave. Add the standard set (annual, sick,
> casual) to get started — you can change them later.
> **[ Add standard leave types ]**

---

## 5. GA-008 — the lockout nobody had written down

### The deadlock

Provisioned a fresh tenant with `scripts/onboarding.py` and reproduced it exactly:

```
POST /api/v1/auth/login {"email":"owner@ga008-verify.local", …}
→ 401 TOTP_ENROLLMENT_REQUIRED
```

against which the UI rendered *"Ask an administrator to complete enrolment before signing in."*
**The account being refused is the OWNER — the only account on the tenant.** A brand-new restaurant
could not get into its own product, and this appears in no roadmap document, which is why it
survived.

`TwoFactorController:35-50` was built for exactly this and is already public at the gateway.
Grepping `frontend/` for `2fa` returned two comments and no code path.

### The one obstacle, and the one backend line that removes it

`/2fa/bootstrap` requires a `tenantSlug`, and after 16a-01's email-first login **the browser does
not have one** — not having to know it is the entire point of 16a. Asking the owner for a
"restaurant identifier" would have reintroduced the defect 16a removed.

So the refusal now carries the slug the server already resolved, in `details`, exactly as
`403 PASSWORD_CHANGE_REQUIRED` carries `changeToken`:

```json
{"error":{"code":"TOTP_ENROLLMENT_REQUIRED","details":[{"field":"tenantSlug","issue":"ga008-verify"}]}}
```

**Disclosure rule (D-14b-4):** thrown from `enforceTotpStepUp`, which runs only *after*
`passwordEncoder.matches` succeeds — so the slug goes solely to a caller who has already **proven**
the password. Same rule that lets `TENANT_SELECTION_REQUIRED` return a list of slugs. A caller who
has not proven it still gets the generic `401 UNAUTHENTICATED` and learns nothing.

### Why enrolment renders inside the login card

Both bootstrap calls re-authenticate by password. A separate route could only receive that password
through a URL, `sessionStorage`, or a store — each a worse home for a live credential than the React
state it is already in. (The forced-password-change flow can route away because it carries a
single-use *token* instead; there is no equivalent here.) Enrolment in place means the password
never leaves form memory, and navigating away discards it.

### Verified end to end

Through the gateway:

```
1. bootstrap                → otpauth://…?secret=24C7NCEK…
2. bootstrap/verify + code  → {"data":null}
3. login (no code)          → 401 TOTP_REQUIRED     ← was ENROLLMENT_REQUIRED
4. login (with code)        → 200 + accessToken
5. bootstrap again          → 409 TOTP_ALREADY_ENROLLED   ← cannot re-point a live factor
6. bootstrap, wrong pw      → 401 UNAUTHENTICATED
```

And through a real browser, on a tenant provisioned minutes earlier
(`shots/after/ga008-1…5`): refusal → enrolment → key on screen → code computed from that key →
`landed on http://localhost:3000/app/dashboard`.

**No QR code**, deliberately: no QR library exists in any `package.json` (GA-101), and adding a
dependency inside a triage phase is not this phase's call. The screen shows the setup key grouped in
fours with a copy button, plus the `otpauth://` link — which on a phone opens the authenticator
directly. Manual entry is every major authenticator's documented fallback, so the deadlock is
genuinely broken; the QR image is a convenience upgrade on a working flow (deferred, D5).

---

## 6. A defect found while verifying, not in the register

**The login form put the password in the URL.**

During the browser run a click landed before React hydrated. `react-hook-form`'s `handleSubmit` is
what calls `preventDefault()`; unattached, the submit fell through to the browser's native handling,
and since the form declares no `action` and no `method`, that is a **GET to the current URL**:

```
http://localhost:3000/login?email=owner%40terrace.local&password=Terrace%23Owner1
```

A password in the address bar, in browser history, and in any access log along the way. There is no
non-JS path worth preserving (the route is `"use client"` and cannot authenticate without JS), so
the submit button is now disabled until hydration — mirroring `ThemeToggle`'s `useSyncExternalStore`
mounted check rather than an effect, per the codebase's `react-hooks/set-state-in-effect` rule.

Measured: `disabledAtFirstPaint=true`, and after a full sign-in `password never reached the URL`.
It also made the browser harness deterministic, since waiting for the button to enable is the
correct wait *and* a live assertion that the guard is in place.

---

## 7. Files beyond `frontend/`, declared

The prompt asked me to stay in `frontend/` and say so if I went further. I went further twice, both
additive, both minimal:

1. **`AuthController.java`** — `GET /api/v1/auth/tenants/{slugOrId}` now accepts a tenant id as well
   as a slug (GA-032). The shell had *no* session-derived source for the tenant's name: the JWT
   carries `tenant_id` and nothing else, `LoginResponse` carries neither name nor slug, and
   `/branches/mine` returns branch names only. The alternative — a `tenant_name` JWT claim — puts a
   mutable display string inside a signed credential, where a rebrand cannot take effect until every
   token expires. **No new disclosure class:** the endpoint already returns `{slug, name}` of an
   ACTIVE tenant unauthenticated (the login page brands itself with it), and a v4 UUID is strictly
   harder to guess than `floating-terrace`.

2. **`TotpEnrollmentRequiredException` + `AuthExceptionHandler` + one line in `AuthServiceImpl`** —
   the slug in `details` (§5). Emitted defensively: a null slug yields no detail rather than a
   null-valued field, so an unforeseen call path degrades to today's behaviour instead of a 500.

Nothing else outside `frontend/` and this phase directory was modified. `frontend/e2e/` was **not**
touched — the two new drivers live in `scripts/e2e/` precisely because concurrent work may be in
there.

---

## 8. Verification

### CI gates, run from the repo root exactly as `ci.yml` does

```
pnpm --dir frontend run format:check   →  All matched files use Prettier code style!
pnpm --dir frontend run lint           →  ✖ 9 problems (0 errors, 9 warnings)   ← the expected TanStack 9
pnpm --dir frontend exec tsc --noEmit   →  clean
mvn -pl services/auth-service -am -DskipTests package  →  builds (JDK 25)
```

**`format:check` was red before this phase started, and the cause was not a product file.** There
was no `.prettierignore` anywhere in the repo, so `prettier --check .` covered `pnpm-lock.yaml` and
failed on it at HEAD — `ci.yml:97` was therefore failing for reasons unrelated to any code change.

Running `prettier --write` over the lockfile makes it green and is the wrong fix twice over: it is
**5,389 insertions / 3,157 deletions of pure quote-style churn** (`'9.0'` → `"9.0"`, about four
thousand times, with no dependency change in any of it), and pnpm rewrites the file in its own style
on the next `pnpm install`, so the gate goes red again and the churn recurs forever — on the single
most merge-conflict-prone file in the repository, while sibling agents are active.

A `frontend/.prettierignore` naming `pnpm-lock.yaml` fixes the cause in three lines. A package
manager owns the format of its own lockfile. **The committed lockfile is byte-identical to HEAD.**

### Browser assertion probe — `scripts/e2e/_14b-probe.mjs`

Screenshots show a human what changed; this shows a machine. **26/26 passing**, driven through a
real browser against the live stack, signed in as a TOTP owner:

```
PASS  login submit enables only after hydration      PASS  password never reached the URL
PASS  GA-032 sidebar names the signed-in tenant — brand="Floating Terrace"
PASS  GA-095 "AR Aging"          PASS  GA-095 "General Ledger"
PASS  GA-059 no inert bell       PASS  GA-093 checkbox HAS an accessible name
PASS  GA-094 no "E to export"    PASS  GA-092 theme: null → "light" → "dark"
PASS  GA-006 LOYALTY_POINTS not offered
PASS  GA-001 × 12 screens: 500 renders an error, not an empty state
PASS  GA-002 503 removes no nav item — with503=19 healthy=19
PASS  GA-023 closed sales — Rs 30,310.80 / 20 orders
PASS  GA-053 + GA-091 404s have a way back
```

### Existing journey suite — `scripts/e2e/browser-e2e.sh`

**57 passed, 3 failed** (baseline was 50/56). None of the three is caused by this phase; all are in
files it did not touch, and all are recorded with evidence in `deferred-items.md`:

- **D0** `--muted-foreground` fails WCAG AA contrast — a design **token**, owned by phase 20, and
  changing it is exactly what this phase's guardrails forbid. It flickers between runs because axe
  samples at different paint moments.
- **D1** POS "Polling" chip contrast — a *symptom* of GA-017 (the gateway omits `/api/v1/pos/ws/`
  from `WS_UPGRADE_PATHS`). Fix GA-017 and the element stops rendering in the healthy case.
- **D2** kitchen ticket list 404 after a bump — kitchen-service routing, untouched here.

**One journey failure was fixed** rather than deferred: `serious: aria-prohibited-attr` on
`branch-switcher.tsx`, an `aria-label` on a role-less `<div>` — which assistive technology
**discards entirely**, so the loading region announced nothing at all. One line (`role="status"`),
out of register scope, but the same class of defect as GA-059: the shell telling a screen-reader
user something untrue. It no longer appears in any run.

---

## 9. Deviations from plan

Documented in full in `deferred-items.md`. Summary:

**Auto-fixed (Rule 1 — bugs found while executing):**

1. **Login form leaked the password into the URL** on a pre-hydration submit (§6). Security fix,
   not in the register.
2. **`branch-switcher.tsx` ARIA violation** (§8). One line, adjacent to the shell files already
   being edited.

**Environment obstacle, worked around and documented (D3):** auth-service **cannot be restarted**
without a manual ownership handoff. Changeset `081-login-candidate-lookup` is `runOnChange="true"`
over a `CREATE OR REPLACE`, but `verify-security-definer-owners.sh` must hand the function to
`postgres` (`SECURITY DEFINER` has to bypass FORCE RLS on `users`; `auth_user` is `NOBYPASSRLS`) —
so the next boot re-runs the changeset as `auth_user`, which no longer owns it, and the service dies
with `must be owner of function auth_lookup_login_candidates`. The changeset's own comment predicts
the ownership trap but not this loop. Workaround used, and the real fix proposed, in `deferred-items.md`.

**Not fixed, logged:** D0, D1, D2, D4 (`onboarding.py` prints a swallowed `ON CONFLICT` error on
every run), D5 (QR code).

---

## 10. What this phase deliberately did not do

- **It did not make anything look calm.** GA-001 is fixed by *showing* failure. A silent empty state
  is the bug, so every failure gets `role="alert"`, names what failed in the reader's words, and
  offers the one action that helps.
- **It did not weaken authorization.** §3 explains why the nav change is not one.
- **It did not divide by 100 anywhere but the display layer.** Money stays BIGINT paisa in transport
  and in the domain; GA-007 and GA-078 both route through `MoneyDisplay`.
- **It did not introduce a colour or a dependency.** Design-system tokens only; no QR library.
- **It did not narrow `PaymentMethod`.** Removing `LOYALTY_POINTS` from the union would have made
  already-settled orders fail to parse — turning a UI defect into a data-display outage on
  historical orders. Only the picker changed.
- **It did not ship the lint rule.** `QueryBoundary` is the primitive; the ESLint rule that would
  make bypassing it an error needs a custom plugin able to recognise a TanStack result flowing into
  a conditional, which is a day of work and belongs with design-system tooling (D-14b-3).

## Self-Check: PASSED

All created files verified present on disk; all commits verified present in `git log`.
