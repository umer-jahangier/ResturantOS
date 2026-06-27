---
phase: 6
plan: "06-02-GAP-REMEDIATION"
title: "Phase 6 Finance — Gap Remediation Handoff"
status: open
source: "Gap analysis vs 06-02-INDEPENDENT-PLAN.md (2026-06-27)"
depends_on: [06-01-SUMMARY, 06-02-SUMMARY]
reference: 06-02-INDEPENDENT-PLAN.md
---

# Phase 6 Finance — Handoff Summary for Next Chat

Use this document to continue Phase 6 remediation in a fresh session.

---

## Context

**Phase:** 6 — Finance Core (General Ledger & Periods)  
**Status:** `06-01` and `06-02` are implemented; summaries exist at:

- `.planning/phases/06-finance-core-general-ledger-periods/06-01-SUMMARY.md`
- `.planning/phases/06-finance-core-general-ledger-periods/06-02-SUMMARY.md`

**Reference plan (superset):** `.planning/phases/06-finance-core-general-ledger-periods/06-02-INDEPENDENT-PLAN.md`

**Goal:** The ledger is not "done" until contracts, events, auth, and provisioning are correct end-to-end — not only COA + JE + periods + frontend.

---

## What's Already Built (don't redo)

- `finance-service` on port 8086 (Flyway, 5 tables, RLS, 3 DB triggers)
- 55-account Pakistan COA seeding (idempotent)
- JE lifecycle: DRAFT → POST → REVERSE; deferred balance trigger; immutability triggers
- 423 `PERIOD_LOCKED`, 422 `JE_UNBALANCED`, 409 for already-posted
- 12 Jul–Jun periods; TOTP-gated close; Feign pre-check stubs (return 0)
- `POST /internal/tenants/{tenantId}/provision`
- `GET /internal/periods/current?tenantId=`
- 7 frontend pages under `/app/finance/*` (DS §7.4)

---

## What's Missing (do this next)

### P0 — Blockers for Phases 7–11

1. **Internal auto-post API**
   - Implement spec contract: `POST /internal/finance/journal-entries`
   - Idempotent on `source_type` + `source_id`
   - Honor LOCKED period → 423
   - Protect with internal auth (see #3)

2. **Domain events (transactional outbox)**
   - On JE post: `JOURNAL_POSTED` (`finance.journal.posted`)
   - On period close: `PERIOD_CLOSED` (`finance.period.closed`)
   - Publish-on-commit via `DomainEventPublisher`; payload matches event registry

3. **Internal auth on `/internal/**`**
   - Add `InternalServiceFilter` with constant-time compare of `X-Internal-Service`
   - Remove `permitAll()` on internal routes
   - Align outbound Feign header: `X-Internal-Secret` → `X-Internal-Service`

4. **OPA finance policy**
   - Create/extend `policies/restaurantos/finance.rego`
   - Route mutations through `AuthorizationService.authorize("finance", action, resource)` (tenant + branch, fail-closed)
   - `policies/tests/finance_test.rego` → 100% coverage

### P1 — Integration / spec alignment

5. **Canonical permission names** (Appendix B.3)
   - Replace: `finance.accounts.*` → `finance.coa.view` / `finance.coa.manage`
   - Replace: `finance.journal.read/write` → `finance.journal.view` / `finance.journal.post` / `finance.journal.reverse`
   - Replace: `finance.periods.close` → `finance.period.close`
   - Update frontend permission strings to match

6. **Period status vocabulary**
   - DB CHECK: add `CLOSED` to `accounting_periods.status` (`OPEN|LOCKED|CLOSED`)
   - Extend `PeriodStatus` enum; reserve `CLOSED` for Phase 9

7. **Internal period status API**
   - Implement: `GET /internal/finance/periods/status?branchId=&date=`
   - Keep existing `GET /internal/periods/current` if needed; don't conflate the two

8. **Provisioning contract reconciliation**
   - Platform-admin calls `POST /internal/finance/tenants/{id}/seed-coa`
   - Finance exposes `POST /internal/tenants/{id}/provision`
   - Pick one contract; update platform Feign client + WireMock IT
   - Seed COA + 12 periods in one call; prove saga IT (55 accounts + 12 periods)

9. **Standard API envelope**
   - Wrap finance controller responses in `ApiResponse<T>` / `ApiResponse.paginated(...)`
   - Ensure all finance error codes map through shared/global handler

### P2 — Hardening / tech debt

10. **Schema/grants**
    - Explicit `GRANT ... TO finance_user` on all finance tables
    - Confirm `finance_user` is `NOSUPERUSER NOBYPASSRLS`
    - Consider `FORCE ROW LEVEL SECURITY` on tenant tables

11. **Internal tenant context**
    - `TenantFilterInterceptor` only covers `/api/v1/**`
    - Internal paths (provision, internal JE post) must set `TenantContext` + `app.current_tenant_id` GUC or RLS breaks

12. **Column naming vs spec**
    - Align `is_system` / `is_active` (not `system` / `active`) if spec requires it

13. **Flyway vs Liquibase**
    - Platform standard is Liquibase; finance uses Flyway
    - Either migrate to Liquibase or document a formal exception

14. **Two-tenant RLS IT**
    - Current IT workaround (superuser bypasses RLS) is weak
    - Add IT proving tenant A cannot read tenant B's data via `finance_user` + GUC

15. **Coverage**
    - Maintain finance-service ≥ 75% line coverage
    - Add ITs: internal JE post, outbox rows on post/close, saga provisioning, OPA deny paths

---

## Suggested Execution Order (4 waves)

| Wave | Focus | Tasks |
|------|--------|-------|
| **1** | Security + schema fixes | #3, #6, #10, #11 |
| **2** | Contracts | #1, #7, #8, #9 |
| **3** | Auth + events | #4, #5, #2 |
| **4** | Tests + verification | #14, #15, UAT refresh |

Map to independent plan: Wave 3 (Tasks 3.1–3.6) + Wave 1 gaps (Tasks 1.1, 1.3).

---

## Success Criteria (checklist)

- [ ] Provisioned tenant via **real Phase-3 saga** → 55 accounts + 12 periods, idempotent
- [ ] `POST /internal/finance/journal-entries` works, idempotent, 423 on LOCKED period
- [ ] `GET /internal/finance/periods/status?branchId=&date=` implemented
- [ ] `/internal/**` requires `X-Internal-Service`; not `permitAll()`
- [ ] `JOURNAL_POSTED` + `PERIOD_CLOSED` in outbox on commit
- [ ] OPA finance 100%; canonical permission names everywhere
- [ ] All responses use `ApiResponse` envelope
- [ ] Two-tenant RLS isolation proven (not superuser-only)
- [ ] `mvn verify` green; coverage ≥ 75%

---

## Key Files to Touch

**Backend:**

- `services/finance-service/src/main/java/io/restaurantos/finance/config/FinanceSecurityConfig.java`
- `services/finance-service/src/main/java/io/restaurantos/finance/web/*` (new internal JE controller)
- `services/finance-service/src/main/resources/db/migration/` (CLOSED status, GRANTs)
- `policies/restaurantos/finance.rego`
- `policies/tests/finance_test.rego`
- Platform-admin Feign client for provisioning (find via grep `seed-coa` / `provision`)

**Frontend:**

- Permission strings aligned to Appendix B.3
- Zod schemas if API envelope changes

**Specs to read:**

- `Docs/agent-specs/02` (event registry)
- `Docs/agent-specs/04` (internal API contracts)
- `Docs/agent-specs/08` (migration guide)
- Appendix B.3 (permission catalogue)

---

## Gotchas (from independent plan)

- Deferred trigger only fires at **commit** — IT must insert lines + post in **one** transaction
- Unset GUC → `current_setting('app.current_tenant_id', TRUE)` returns NULL; internal paths must set it
- 423 not in Spring `HttpStatus` → use `ResponseEntity.status(423)`
- Native SQL bypasses Hibernate tenant filter → **JPQL only**
- Provisioning URL mismatch may 404/401 silently — verify with WireMock saga IT, don't assume success

---

## Prompt for Next Chat

> Continue Phase 6 Finance remediation per `.planning/phases/06-finance-core-general-ledger-periods/06-02-INDEPENDENT-PLAN.md` and `.planning/phases/06-finance-core-general-ledger-periods/06-02-GAP-REMEDIATION.md`. Implement P0 items first: internal JE post API, outbox events (`JOURNAL_POSTED`, `PERIOD_CLOSED`), internal auth filter, and OPA `finance.rego`. Then P1: canonical permissions, `CLOSED` status, period status internal API, provisioning contract fix, and `ApiResponse` envelope. Run impact analysis before edits; add ITs for internal paths and two-tenant RLS.
