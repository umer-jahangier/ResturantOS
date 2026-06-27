---
phase: 6
plan: "06-02-INDEPENDENT"
title: "Finance Core — General Ledger & Periods (independent whole-phase re-plan)"
author: independent-replan
status: draft
scope_requirements: [FIN-01, FIN-02, FIN-04, FIN-06]
cross_cutting: [XCUT-01, XCUT-02, XCUT-03, XCUT-05, XCUT-06, AUTHZ-03, AUTHZ-04, AUTH-07, LIB-06]
depends_on: [Phase 1, Phase 3, Phase 5]
fiscal_year: "Pakistan Jul–Jun"
note: >
  This is an INDEPENDENT re-plan of Phase 6 written from first principles against the
  actual repo state and the canonical specs (RestaurantERP_SaaS_Specification.md,
  Docs/agent-specs/02 event registry, 04 internal-API contracts, 08 migration guide,
  Appendix B.3 permission catalogue). It deliberately does not reuse the structure of
  the existing 06-01/06-02 plans. It is a SUPERSET goal definition: it builds the
  ledger + periods AND closes the contract/integration/security seams that the phase
  goal ("the immutable, balanced ledger every downstream consumer depends on") actually
  requires to be TRUE end-to-end.
---

# Phase 6 — Finance Core: General Ledger & Periods (Independent Plan)

## Phase Goal (goal-backward anchor)

Establish the immutable, balanced double-entry ledger and accounting periods that **every
auto-posting consumer (Phases 7–11) depends on — before any consumer exists**. The goal is
only achieved if a freshly provisioned tenant has a seeded COA + 12 periods, manual JEs are
balance-and-immutability enforced at the DB, periods can be locked behind TOTP + internal
pre-checks, locked-period posting is refused with 423, and **the contracts/events/authorization
downstream phases will bind to are published and correct**.

## Success Criteria (what must be TRUE)

1. Provisioning a tenant (the real Phase-3 saga, not a manual call) seeds the Pakistan COA
   (~55 accounts, `is_system`/`system_tag` set) + 12 Jul–Jun periods; idempotent on re-run;
   COA + periods are queryable through the tenant API.
2. A manual JE that does not balance is rejected by the **deferred** DB trigger; a POSTED JE
   cannot be UPDATEd/DELETEd (immutability trigger); corrections are reversal-only and the
   reversal links back to the original.
3. 12 periods/FY are seeded; closing a period sets it `LOCKED` only after TOTP verification
   and internal-API pre-checks pass (no cross-service SQL); the period state machine supports
   the spec's `OPEN|LOCKED|CLOSED` vocabulary.
4. Any attempt to post into a `LOCKED` period returns **423 `PERIOD_LOCKED`** — through both
   the public JE post path and the internal auto-post path.
5. Every finance mutation is authorized through **OPA** (tenant + branch isolation, fail-closed),
   using the canonical permission names; `opa test` for the `finance` package is 100%.
6. Posting a JE publishes `JOURNAL_POSTED` and closing a period publishes `PERIOD_CLOSED` via
   the transactional outbox (exactly-once, on commit); payload matches the event registry.
7. The internal API contract downstream phases bind to (`POST /internal/finance/journal-entries`,
   `GET /internal/finance/periods/status`) is implemented, internal-auth protected, and
   documented (OpenAPI).
8. finance-service ≥ 75% line coverage; OPA finance 100%; two-tenant RLS isolation proven.

---

## Wave 1 — Foundation: schema, role grants, tenant isolation correctness

### Task 1.1 — Resolve migration tool + schema/grant correctness
- **Decision to lock:** the project standard (agent-spec 08 + every other service) is **Liquibase**;
  finance currently uses Flyway. Either (a) migrate finance to Liquibase changelog convention
  (`db/changelog/v1.0.0/finance-1.0.0-NNN-*.xml`) to match the platform, or (b) record an explicit,
  reviewed exception. Pick (a) unless there is a documented blocker. *Rationale: schema-sync CI gate
  and operational consistency.*
- Align column names to the **spec**: `is_system`, `is_active` (not `system`/`active`).
- Add `accounting_periods.status` CHECK to include `CLOSED` (`OPEN|LOCKED|CLOSED`) per spec, even if
  only `OPEN→LOCKED` is exercised in Phase 6 (CLOSED reserved for Phase 9 P&L roll-forward).
- **GRANTs:** every finance table (`chart_of_accounts`, `accounting_periods`, `journal_entries`,
  `journal_lines`, `je_sequences`) must `GRANT SELECT,INSERT,UPDATE,DELETE … TO finance_user`
  inside the changeset that creates it (mirror user-service's RLS changesets). Confirm `finance_user`
  is `NOSUPERUSER NOBYPASSRLS`.
- Each tenant-scoped table: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation`
  policy `USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`.

### Task 1.2 — DB triggers (the hard invariant core)
- **Deferred constraint trigger** `trg_je_balance` (`AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`) → `SUM(debit_paisa)=SUM(credit_paisa)` per `je_id`,
  raise `JE_UNBALANCED` at commit.
- **Immutability triggers** `trg_je_immutable` (BEFORE UPDATE/DELETE on `journal_entries`) and
  `trg_je_line_immutable` (lines): block any change once `status='POSTED'`, with a single explicit
  exception for the `reversed_by_je` back-link update.
- CHECK constraints on lines: non-negative, single-sided (`NOT (debit>0 AND credit>0)`).
- Indexes: `(tenant_id, period_id)`, `(tenant_id, entry_date)`, `(je_id)`, `(tenant_id, account_code)`,
  `(tenant_id, fiscal_year)`.

### Task 1.3 — Tenant context on every code path (incl. internal)
- `TenantFilterInterceptor` is registered for `/api/v1/**` only. **Internal endpoints that touch
  tenant data** (provision, internal JE post) must explicitly establish `TenantContext` and set the
  `app.current_tenant_id` GUC for the connection, or RLS will silently return empty / block writes.
  Add an internal-path tenant-context strategy (resolve tenant from path/body, set GUC) and test it.

**Wave-1 verification:** Flyway/Liquibase runs clean on Postgres 18; a two-tenant IT proves
tenant A cannot read tenant B's accounts/JEs; unbalanced insert fails at commit; POSTED JE update fails.

---

## Wave 2 — Domain engine: COA, JE lifecycle, periods (depends on Wave 1)

### Task 2.1 — COA seeding (FIN-01)
- `PakistanRestaurantCoaTemplate` (~55 accounts, 1xxx–7xxx) with `is_system=true` and `system_tag`
  for auto-posting resolution (`CASH`, `BANK`, `AR`, `AP`, `INVENTORY`, `GR_IR`, `INPUT_TAX`,
  `OUTPUT_TAX`, `REVENUE`, `COGS`, `WAGES_PAYABLE`, `SALARY_EXPENSE`, …).
- `CoaService.seedForTenant` idempotent (`ON CONFLICT (tenant_id, code) DO NOTHING`); system accounts
  cannot be deleted/deactivated; tenants may add custom child accounts only.

### Task 2.2 — Period seeding + state machine (FIN-04)
- Seed 12 periods for a fiscal year with correct Jul(period 1)–Jun(period 12) month/year mapping;
  idempotent on `(tenant_id, fiscal_year, period_no)`.
- `AccountingPeriodService`: list/get, `findCurrentOpenPeriod(tenantId, date)`, resolve period for a JE
  by `entry_date`.

### Task 2.3 — JE engine (FIN-02)
- Entities `JournalEntry` (status `DRAFT|POSTED`, `branch_id`, `period_id`, `source_type/source_id`,
  reversal links) + `JournalLine`; money is `BIGINT` paisa via `MoneyUtils` (XCUT-03).
- `JournalEntryService`: `createDraft`, `post` (period-open check → `PeriodLockedException` if LOCKED;
  balance enforced by deferred trigger → map `DataIntegrityViolationException` to **422 `JE_UNBALANCED`**),
  `reverse` (negated lines, `is_reversal`, link both ways).
- Concurrency-safe human-readable `entry_no` via `je_sequences` row `SELECT … FOR UPDATE` in the post txn.

### Task 2.4 — GL read model
- `GlService.balances(periodId)` and `entriesForAccount(accountCode, periodId)` aggregating **only
  POSTED** lines; trial balance must net to zero. JPQL only — **never native SQL** (preserves the
  Hibernate tenant filter; native queries would bypass RLS-at-app-layer).

**Wave-2 verification:** unit tests for seeder counts, period month mapping, reversal arithmetic;
ITs for balanced post happy-path, reversal, idempotent seeding.

---

## Wave 3 — Contracts, authorization, events, provisioning integration (depends on Wave 2)

### Task 3.1 — OPA-mediated authorization (AUTHZ-03/04) — *not just `@PreAuthorize`*
- Route every finance mutation through `AuthorizationService.authorize("finance", action, resource)`
  (shared-lib `OpaClient`), building `OpaInput.Resource` with `tenantId`/`branchId`/`amountPaisa` so the
  policy enforces **tenant AND branch** isolation and fail-closed denial.
- Use the **canonical permission names** from spec Appendix B.3: `finance.coa.view`/`finance.coa.manage`,
  `finance.journal.view`/`finance.journal.post`/`finance.journal.reverse`, `finance.period.close`,
  (`finance.period.reopen` reserved). Reconcile the controllers currently using `accounts.read/write`,
  `journal.read/write`, `gl.read` to the canonical set (and update frontend permission strings to match).
- Extend `policies/restaurantos/finance.rego` with `view`/`manage`/`post`/`reverse`/GL-read actions +
  same_tenant/same_branch helpers; `policies/tests/finance_test.rego` to **100%** coverage.

### Task 3.2 — Standard response envelope + error catalogue (XCUT-06)
- Wrap all finance controller responses in `ApiResponse<T>` / `ApiResponse.paginated(...)`; ensure
  `PeriodLockedException`→423 `PERIOD_LOCKED`, `JeUnbalancedException`→422 `JE_UNBALANCED`,
  `JeAlreadyPostedException`→409, `ResourceNotFoundException`→404 are all mapped (lean on shared
  `GlobalExceptionHandler`, add finance-specific codes to the catalogue).

### Task 3.3 — Domain events via outbox (XCUT-05, exchange `finance.topic`)
- On JE post: publish `JOURNAL_POSTED` (`finance.journal.posted`) with `{jeId, entryNo, sourceType,
  sourceId, totalDebitPaisa, totalCreditPaisa}` through `DomainEventPublisher.publish(...)` inside the
  post transaction (publish-on-commit).
- On period close: publish `PERIOD_CLOSED` (`finance.period.closed`) `{periodId, fiscalYear, periodNo, closedBy}`.
- Envelope matches `EventEnvelope` shape + schemaVersion; consumers (Phase 5 audit/notifications)
  can already subscribe. Idempotent producer (outbox dedupe).

### Task 3.4 — Internal API contract (forward-compat for Phases 7–11) + internal-auth
- Implement the **spec-published** internal endpoints (agent-spec 04):
  - `POST /internal/finance/journal-entries` — synchronous auto-post for downstream consumers
    (idempotent on `source_type`+`source_id`; honors LOCKED-period → 423).
  - `GET /internal/finance/periods/status?branchId=&date=` — period status for POS/HR/Purchasing.
  - keep `GET /internal/finance/periods/current` + provisioning (below).
- **Internal-auth filter:** add a finance `InternalServiceFilter` doing constant-time compare of the
  shared `X-Internal-Service` header (finance currently `permitAll()`s `/internal/**` — security gap),
  and fix the outbound Feign header from `X-Internal-Secret` → **`X-Internal-Service`** to match the
  gateway strip + every receiver.

### Task 3.5 — Provisioning integration actually wired (closes FIN-01 end-to-end)
- **Resolve the URL/contract mismatch**: platform-admin calls `POST /internal/finance/tenants/{id}/seed-coa`;
  finance exposes `POST /internal/tenants/{id}/provision`. Pick ONE contract, implement it on finance,
  and update the platform Feign client + WireMock IT stub to match. Seed COA **and** periods in one call.
- Default-enable `provisioning.seed-coa` for the integrated env (currently `false`), or add a clearly
  documented env toggle, and add a saga IT proving a provisioned tenant ends with 55 accounts + 12 periods.

### Task 3.6 — Period close: TOTP gate + internal pre-checks (FIN-04 / AUTH-07)
- `POST /api/v1/finance/periods/{id}/close` requires TOTP: verify the gateway-set `X-TOTP-Verified`
  (JWT TOTP claim) → else 403 `TOTP_REQUIRED`; also OPA `finance.period.close`.
- `PeriodCloseService.runPreChecks()` calls Feign **stubs** (POS open-orders, Inventory pending-GRN,
  Purchasing unmatched-invoices) returning all-clear in Phase 6, with circuit-breaker fallbacks and a
  `// TODO Phase 7/8/10` marker; any non-zero → `PeriodClosePreCheckFailedException` with details. A
  test-only `bypass_pre_checks` system flag.

**Wave-3 verification:** controller tests for 423/422/403/OPA-deny; outbox IT shows event row on post/close;
saga IT (WireMock) proves end-to-end seeding; `opa test` 100%.

---

## Wave 4 — Frontend §7.4 + acceptance (depends on Wave 3)

### Task 4.1 — Finance pages/components (DS §7.4 rules)
- Pages under `app/(tenant)/app/finance/`: accounts (+`[code]` GL drill-down), journal-entries
  (+`new`, +`[id]`), periods, gl. All money `font-mono tabular-nums`; Dr/Cr right-aligned fixed width;
  `PeriodStatusChip` OPEN(emerald)/LOCKED(amber)/CLOSED(slate); keyboard nav (Tab/Enter/E); bulk export.
- Four-layer abstraction: every response **Zod-parsed** (`finance.schema.ts`) → adapter → model;
  components never import `api-client`/`repositories` (ESLint boundary); `MoneyDisplay` for all amounts.
- `PeriodCloseModal` collects TOTP and calls close; `JournalEntryForm` shows live running Dr/Cr balance
  and disables post until balanced.

### Task 4.2 — Tests + coverage gate
- ITs: deferred-trigger reject, immutability reject, reversal, idempotent seeding, period seed (12),
  post-to-LOCKED→423, close pre-check pass/fail, TOTP-required, two-tenant RLS, internal JE post path.
- finance-service ≥ **75%** line coverage; frontend finance contract tests via MSW.
- UAT walkthrough refreshed.

---

## must_haves (goal-backward verification checklist)

- [ ] Provisioned tenant (via real saga) → 55 accounts + 12 periods, idempotent (FIN-01).
- [ ] Unbalanced JE rejected by **deferred** trigger; POSTED JE immutable; reversal-only (FIN-02).
- [ ] 12 Jul–Jun periods; close → LOCKED only after TOTP + internal pre-checks; no cross-service SQL (FIN-04).
- [ ] Post to LOCKED period → 423 `PERIOD_LOCKED` on **both** public and internal paths (FIN-06).
- [ ] All finance mutations authorized via OPA, tenant+branch, fail-closed; canonical permission names;
      `opa test` finance 100% (AUTHZ-03/04).
- [ ] `JOURNAL_POSTED` + `PERIOD_CLOSED` published via outbox, registry-shaped, publish-on-commit (XCUT-05).
- [ ] Internal contract `POST /internal/finance/journal-entries` + `GET /internal/finance/periods/status`
      implemented, internal-auth protected, OpenAPI-documented (downstream-ready).
- [ ] Money is BIGINT paisa via MoneyUtils everywhere; responses use `ApiResponse`/`ApiError` (XCUT-03/06).
- [ ] finance-service ≥ 75% coverage; two-tenant RLS isolation proven.

## Key risks / gotchas

- Deferred trigger invisible to per-statement JPA — IT must insert lines + post in **one** transaction.
- `current_setting('app.current_tenant_id', TRUE)` returns NULL (not error) when GUC unset — internal
  paths must set it explicitly or RLS blocks/empties.
- 423 not in Spring `HttpStatus` enum → `ResponseEntity.status(423)`.
- `reversed_by_je` back-link is the **only** permitted UPDATE on a POSTED JE — trigger must whitelist it.
- Native SQL bypasses the Hibernate tenant filter → JPQL only in finance repos.
- Provisioning Feign URL/header mismatch will 404/401 silently (non-fatal catch) — verify with an IT,
  not by assuming success.
