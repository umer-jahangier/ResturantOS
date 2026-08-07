# Phase 14b — Truth and trust triage · Context

**Created** 2026-08-07 · branch `phase-13-access-repair`
**Source** `.planning/research/gap-audit/DEFECT-REGISTER.md` §4.2 (Tier 0) + §5.1
**Track** C · parallel with Phase 14 · no dependencies

---

## 1. Why this phase exists

The user's verdict on the product is "literally crap". The 9-agent live-browser audit found the
verdict **directionally correct and specifically wrong about the cause**: the engine works. POS
order → payment → close → GL is verified live. `ORDER_CLOSED` → depletion → COGS is the healthiest
chain in the system. Six inventory screens and seven finance screens load real data; a journal entry
was driven from draft to POSTED `JE-2027-000026` during the audit.

The *impression* of a broken, empty product comes from a small number of defects that make working
features look absent or wrong. This phase fixes those and nothing else.

The distinguishing property of every item here: **each one is something the user personally saw**,
each is frontend-shaped, and none is gated on the design system (phase 20, already landed) or on any
other phase. Phases 20 and 22 are 14 and 16 days. The complaint is now.

## 2. The governing principle

> **A failure must look like a failure.**

Every defect in this phase is a variant of the product asserting something false:

| The app says | The truth |
|---|---|
| "No vendors yet" | the request returned 500 |
| *(8 nav items simply absent)* | `/api/v1/feature-flags` returned 503 |
| "388,600" | Rs 3,886.00 |
| *(Loyalty points is a payable tender)* | nothing checks a points balance; the food is free |
| "Ask an administrator to complete enrolment" | the owner **is** the only account |
| "Lume" in the sidebar | the signed-in tenant is Floating Terrace |
| "Rs 0.00 · 0 completed orders" | 25 CLOSED orders totalling Rs 37,050.40 |
| "E to export" | the handler body is empty |

The remedy is never to make the screen look calm. **GA-001 is fixed by SHOWING failure, not by
hiding it.** A silent empty state is precisely the bug.

## 3. Scope — the Tier 0 list

| ID | Defect | Register days |
|---|---|---:|
| **GA-001** | A failed request renders the EMPTY state on 11 of 15 list screens | 3 |
| **GA-008** | A new tenant's owner cannot log in — TOTP enrolment has no UI | 3 |
| **GA-002** | One 503 on `/api/v1/feature-flags` deletes 8 of 11 nav items | 0.5 |
| **GA-007** | Journal-entry detail renders raw paisa — every total 100× too large | 0.5 |
| **GA-023** | Dashboard "Closed sales" is structurally always Rs 0.00 | 0.5 |
| **GA-032** | Sidebar shows a different tenant's brand on every screen | 0.5 |
| **GA-078** | HR money uses `₨` and ragged decimals, not `MoneyDisplay` | 0.5 |
| **GA-006** | `LOYALTY_POINTS` is a selectable tender with no balance check | 0.1 |
| **GA-053** | `/platform/tenants` — the product's only live 404 | 0.1 |
| **GA-091** | `/app/reporting` 404s from the unguarded nav list | 0.25 |
| **GA-059** | Notification bell hardcodes "3 unread" with a permanent red dot | 0.2 |
| **GA-092** | "Toggle theme" command-palette item is a no-op | 0.1 |
| **GA-093** | Unlabelled 16×16 checkbox on Menu Items | 0.1 |
| **GA-094** | "E to export" advertised; handler body empty | 0.2 |
| **GA-095** | Breadcrumb mis-cases acronyms: "Ar Aging", "Gl" | 0.2 |
| **GA-096** | Developer "Seed default leave types" button ships on HR attendance | 0.25 |

**Out of scope, deliberately:** GA-003 (user-management UI, 5d, phase 23), GA-005 (table CRUD, 4d,
phase 17), GA-013 (`pos_db` FORCE RLS, 3d, pulled into phase 14), GA-014/015 (images), GA-027 (wrong
TOTP code is silent — Tier 1, phase 23). Each is a real defect; none is a Tier 0 one-liner.

## 4. Decisions taken in this phase

### D-14b-1 — Nav fails OPEN; entitlement fails CLOSED. They are different questions.

Plan 13-03 decided that **entitlement checks fail closed**: if the system cannot prove a tenant is
entitled to a feature, the API refuses. That decision stands and is not weakened here.

GA-002 is not an entitlement decision. It is a **rendering** decision, and the two differ because
they answer different questions:

| | Entitlement (13-03) | Navigation (14b) |
|---|---|---|
| Question | "May this request proceed?" | "Should this link be drawn?" |
| Enforced at | gateway / service | browser DOM |
| Cost of a wrong YES | unauthorised access | a link that 403s |
| Cost of a wrong NO | request refused, user retries | **the product silently shrinks** |
| Posture | **fail closed** | **fail open** |

A visible menu item that leads to a 403 is a bad afternoon. A product that deletes 8 of its 11
navigation items with no banner, no toast and no explanation is indistinguishable from a product
that was never built — which is exactly what the audit observed and exactly what the user reported.

Crucially, **failing open in the sidebar grants nothing.** The sidebar is not an authorization
boundary and never was: `JwtGlobalFilter` and each service's `@PreAuthorize` are, and neither
consults the DOM. Drawing a link the API will refuse cannot escalate a privilege; it can only cost a
round trip. Hiding a link the API would have *allowed* costs the feature.

The existing code already agrees for the *error* case — `hasFeature` takes `failOpenOnError`,
defaulted to `true`. The defect is one line earlier: `if (isPending) return false`, which treats
**in-flight** as **denied**. A 503 keeps the query pending through its retries, so the nav collapses
before `isError` is ever true. The fix is to make PENDING behave like ERROR: render optimistically.

Permission gates (`hasPermission`) and role gates (`hasRole`) are unchanged. Those read the signed
JWT, which is present synchronously and cannot 503.

### D-14b-2 — `LOYALTY_POINTS` is removed from the tender list, not implemented.

The register prices redemption at 4 days and removal at 0.1. `PaymentServiceImpl` has no CRM
dependency at all — its only Feign client is `FinanceArClient` — so nothing anywhere validates a
points balance, while `AutoPostingRecipeEngine:598` cheerfully books the tender to
`LOYALTY_LIABILITY`. The result is free food that also puts a liability on the general ledger with
no corresponding points movement.

**Shipping a tender that cannot be paid for is worse than not offering it.** Removal is reversible
in one line the day `LoyaltyService.redeem` exists (phase 17).

The removal is confined to the tender **picker**. `PaymentMethod` keeps `LOYALTY_POINTS` as a
domain value and every read path keeps rendering it, so the settled orders that already carry it
still display correctly — removing the value from the union type would have been the destructive
version of this fix.

### D-14b-3 — `QueryBoundary` is a component, not a lint rule.

The register and `ROADMAP-14-PLUS.md:695` both propose "a `QueryBoundary` primitive with a lint
rule". This phase ships the primitive. The lint rule is deferred: it needs a custom ESLint plugin to
recognise a TanStack result flowing into a conditional, which is a day of work on its own and
belongs with the design-system tooling.

The primitive takes the query result itself rather than three booleans, so a caller cannot
accidentally destructure `data` and forget `isError` — the shape that caused
`purchasing/vendors/page.tsx:12`.

### D-14b-4 — GA-008 needs one backend field, and it is disclosed only after password proof.

`POST /api/v1/auth/2fa/bootstrap` exists precisely to break this deadlock, and it is already public
at the gateway (`JwtGlobalFilter:60`). But `TotpBootstrapRequest` requires `tenantSlug`, and after
16a-01's email-first login **the browser does not have one** — that is the entire point of 16a. A UI
that asked the owner for a "restaurant identifier" would reintroduce the defect 16a removed.

So the `401 TOTP_ENROLLMENT_REQUIRED` refusal now carries the resolved slug in `details`, exactly as
`403 PASSWORD_CHANGE_REQUIRED` carries `changeToken`. The disclosure rule is the established one: it
is returned **only to a caller who has already proven the password** (the refusal is thrown after
`passwordEncoder.matches` succeeds), which is the same rule that lets `TENANT_SELECTION_REQUIRED`
return a list of slugs. It reveals nothing an authenticated user cannot already read from their own
session.

This is the only backend change in the phase, and it is additive — `ApiError.details` is an existing
optional field and no existing client reads it on this code.

## 5. Guardrails accepted for this phase

- **Do not mask an error to make a screen look calm.** Every failure gets `role="alert"` and a
  retry.
- **Money stays BIGINT paisa** in transport and in the domain. Only the display layer converts, and
  it converts through `MoneyDisplay` — never an inline `/ 100`.
- **No authorization is weakened** to make a screen render. D-14b-1 explains why the nav change is
  not an authorization change.
- **Design-system tokens only** (`text-destructive`, `border-destructive/30`, `bg-destructive/15`).
  No new colours.
- **Every fix is demonstrated in a real browser.** Every defect in this register was invisible to
  the unit suite; four of them were invisible to a 50/56-green Playwright suite too.

## 6. Definition of done

From the register §5.1, plus this phase's own additions:

1. A forced 500 on any list screen renders an error with a Retry and **never** an empty state.
2. A 503 on `/api/v1/feature-flags` does not remove a nav item.
3. No money value on any screen is 100× wrong.
4. The sidebar shows the signed-in tenant's name.
5. The product contains zero live 404s and zero no-op controls.
6. A brand-new tenant's owner can complete TOTP enrolment and sign in, unaided, in the browser.
7. `pnpm --dir frontend run format:check`, `run lint`, `exec tsc --noEmit` all pass.
