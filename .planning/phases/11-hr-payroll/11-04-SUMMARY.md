# Phase 11 Plan 04 — Summary: Employee master (HR-01)

**Status:** Complete (compile-proven; encryption/RLS/event ITs written, deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline — subagent delegation blocked by platform content filter)

## Objective

Employee master with field-encrypted `cnic`/`bank_account_no`, full CRUD REST API,
EMPLOYEE_JOINED/EMPLOYEE_LEFT events, and the OPA `hr.rego` policy covering all `hr.*` actions.

## Tasks & commits

| Task | Commit | What |
|------|--------|------|
| 1 | (feat 11-04 domain) | `EmployeeEntity` (encrypted PII), `EmployeeRepository`, `EmployeeDtos`, `EmployeeService` + `employees` audit cols + `@EnableJpaAuditing` |
| 2 | (feat 11-04 API+policy) | `EmployeeController` (/api/v1/hr/employees, @PreAuthorize), `hr.rego` (9 actions), `hr_test.rego` (12 tests) |
| 3 | (test 11-04) | `EmployeeIT` — encryption round-trip, RLS isolation, outbox events |

## Key decisions

- **PII encryption** mirrors auth `UserEntity.totpSecret`: `@Convert(EncryptedStringConverter) @Column(columnDefinition="bytea")` on `cnic` + `bankAccountNo`. Responses mask to last-4; raw plaintext is never serialized or logged.
- **Tenant + branch always from `TenantContext`**, never the request body.
- **Events** via shared `EventPublisher.publish("hr.topic", "hr.employee.joined"|"left", "EMPLOYEE_JOINED"|"EMPLOYEE_LEFT", branchId, payload)` → transactional outbox.
- **`hr.rego` fail-closed** (`default allow := false`); each of 9 actions requires its `hr.*` permission + `common.same_tenant_and_branch`.
- **[11-04-A] Extended `TenantAuditableEntity`** (per plan) — required adding `created_by`/`updated_by`/`deleted_at` to the `employees` table (010) and `@EnableJpaAuditing` on `HrServiceApplication` (first auditable entity in hr-service; matches the finance/pos pattern). Safe: `hr_db` never migrated anywhere yet.
- Confirmed **RLS GUC is auto-wired**: shared-lib `TenantDataSourceAutoConfiguration` registers `TenantAwareDataSourcePostProcessor`, so hr-service sets `app.current_tenant_id` at JDBC checkout with no per-service wiring — the app works under the NOSUPERUSER prod role.

## Verification

- `mvn -q -pl services/hr-service -am compile` / `test-compile` — BUILD SUCCESS (all 3 tasks).
- `hr.rego`: 9 allow rules; `hr_test.rego`: 12 tests (cross-tenant, cross-branch, missing-permission, unknown-action fail-closed).
- **DEFERRED to Docker CI** (no daemon in sandbox):
  - `EmployeeIT` (`mvn -q -pl services/hr-service -am verify`) — encryption ciphertext-at-rest + decrypt round-trip, cross-tenant RLS via NOSUPERUSER role, EMPLOYEE_JOINED/LEFT outbox emission.
  - `opa test policies/` — `hr_test.rego` (no `opa` binary/Docker in sandbox).
  - Runtime `ddl-auto=validate` of `EmployeeEntity` (incl. enum `employment_type`, bytea converters, audit columns).

## Follow-ups

- Run `EmployeeIT` + `opa test` in CI before treating HR-01 as fully verified.
- 11-06 (payroll) and 11-11 (punch ingest via `findByTenantIdAndDeviceUserRef`) build on this entity.
