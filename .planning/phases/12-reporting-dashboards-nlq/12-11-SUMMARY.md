---
phase: 12-reporting-dashboards-nlq
plan: 11
status: complete
completed: 2026-07-16
wave: 1
---

# 12-11 SUMMARY — auth-service permission seeding (reporting.* + nlq.query.run)

## What was built

Two Liquibase changesets seeding the four Phase-12 permissions, wired into the
master changelog so Liquibase actually runs them.

- `services/auth-service/src/main/resources/db/changelog/v1.0.0/045-reporting-permissions.xml`
  — creates `reporting.report.view`, `reporting.report.fbr`, `reporting.dashboard.view`
  and grants each explicitly to OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT (3 × 4 = 12 grants).
- `services/auth-service/src/main/resources/db/changelog/v1.0.0/046-nlq-permissions.xml`
  — creates `nlq.query.run` and grants it to the same four roles (4 grants).
- `services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml`
  — two `<include>` lines (045, 046) at lines 19-20. The master changelog does NOT
  auto-discover; without these the changesets would be dead code and every
  `@PreAuthorize`-gated Phase-12 endpoint would 403 for everyone.

CASHIER and CHEF are intentionally excluded (no analytics/tax-position access;
aligns with 12-04's empty `nlq_allowed_tables` for those roles).

## Numbering

045/046 chosen because the v1.0.0 directory already contains 031, 037, 038, 041-044.
045/046 sort cleanly after them; 032/033 would have buried the include mid-file.

## Verification

- **Grants are explicit per decision 10-09-B** — no blanket SELECT-all-permissions
  trick. 030's earlier blanket seed ran against the permissions table as it existed
  then and does not retroactively pick up rows inserted here; hence every grant is an
  explicit `role_permissions` row. Count: 16 total (12 + 4).
- **Schema parity confirmed against the existing 031-purchasing-permissions.xml**:
  `permissions` columns (`code`, `module`, `description`) and `role_permissions`
  columns (`role_code`, `permission_code`) match the working precedent exactly.
- **Includes confirmed present**: `grep -n "045-reporting-permissions\|046-nlq-permissions"`
  on the master changelog returns lines 19 and 20.

## Deferred

The live-DB runtime proof (bring up Postgres + auth-service, SELECT the permissions
and role_permissions rows, decode a freshly-minted OWNER JWT to confirm the four codes
appear in the permissions claim) was NOT executed in isolation. The original executor
died on a transient API ECONNRESET at exactly this step. Rather than boot the DB in a
flaky-network window, the runtime assertion is deferred to plan 12-10 (real-stack
end-to-end proof), which exercises exactly this path against the live stack as part of
verifying every Phase-12 endpoint is reachable by a granted persona. The file-level
deliverables (changesets + wired includes, schema-verified) are complete.

## Commits

- `feat(12-11)`: reporting + NLQ permission changesets, wired into master changelog
