# 11-03 Summary — HR RBAC Permission Seed

**Plan:** `.planning/phases/11-hr-payroll/11-03-PLAN.md`
**Status:** Complete (build/IT not run — see Verification)

## Files created

- `services/auth-service/src/main/resources/db/changelog/v1.0.0/045-hr-permissions.xml`
  New Liquibase changeset `auth-1.0.0-045-hr-permissions` (author `restaurantos-agent`, `runOnChange="false"`,
  no `context="seed"` — mirrors 038/041/044 so it always applies). Contents:
  - 9 `permissions` inserts, `module="hr"`: `hr.employee.view`, `hr.employee.manage`,
    `hr.attendance.view`, `hr.attendance.manage`, `hr.leave.view`, `hr.leave.approve`,
    `hr.payroll.run`, `hr.payroll.approve`, `hr.payroll.view` (exact set from spec §B.7 / 11-CONTEXT.md,
    no extras invented).
  - Explicit `role_permissions` inserts:
    - `MANAGER`: `hr.employee.view`, `hr.attendance.view`, `hr.attendance.manage`, `hr.leave.view`,
      `hr.leave.approve`, `hr.payroll.view` (operational subset — no run/approve).
    - `ACCOUNTANT`: `hr.employee.view`, `hr.payroll.view`, `hr.payroll.run` (executes runs; approval
      withheld).
    - `FINANCE_VIEWER`: `hr.payroll.view` only.
  - Bulk `<sql>` grants (pattern from `041-pos-permissions.xml` lines 161–181) for `OWNER` and
    `TENANT_ADMIN`: `INSERT INTO role_permissions SELECT '<ROLE>', code FROM permissions WHERE module='hr'
    AND NOT EXISTS (...)`, so both roles pick up all nine `hr.*` codes including `hr.payroll.approve`,
    which is granted to no other role.
  - `<rollback>`: deletes the nine `hr.*` rows from `role_permissions` then `permissions`.

## Files modified

- `services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml`
  Added `<include file="db/changelog/v1.0.0/045-hr-permissions.xml"/>` immediately after the
  `044-finance-period-open-permission.xml` include (last permission-seed include in file order),
  preserving existing ordering.

## Changeset id / numbering

- Changeset id: `auth-1.0.0-045-hr-permissions`
- File number: `045` — next available after `044-finance-period-open-permission.xml`, confirmed no
  `045-*.xml` existed in `v1.0.0/` prior to this change.

## Self-review (static, no DB/build)

- `grep -c 'tableName="permissions"' 045-hr-permissions.xml` → `9` (matches plan's verify step).
- `grep -n "hr.payroll.approve"` → appears only in the permission `<insert>` (line 47) and the
  `<rollback>` delete lists; it has **no** explicit `role_permissions` insert for MANAGER/ACCOUNTANT/
  FINANCE_VIEWER, so it reaches only OWNER/TENANT_ADMIN via the wildcard `module='hr'` SQL grants —
  satisfies "payroll.approve restricted to OWNER/TENANT_ADMIN".
- XML well-formedness checked with `python -m xml.dom.minidom` parse — parses cleanly, changeSet has a
  single well-formed root, valid `id`/`author` attributes.
- Confirmed all referenced role codes (`OWNER`, `TENANT_ADMIN`, `MANAGER`, `ACCOUNTANT`,
  `FINANCE_VIEWER`) exist as system roles in `030-create-roles-permissions.xml`.
- Confirmed master changelog include line added in the correct position via grep.

## Deviations from plan

None. Task 1 and Task 2 implemented exactly as specified; no permissions beyond the declared nine were
added; role grant subsets match the plan's explicit role list (MANAGER, ACCOUNTANT, FINANCE_VIEWER,
OWNER, TENANT_ADMIN bulk).

## Scope note

Only the two files declared in this plan's `files_modified` were touched. hr-service scaffolding
(11-01) and gateway/scripts wiring (11-02) are untouched — out of this plan's scope.

## Verification: build/IT deferred (RAM/Docker constraint) — not run

Per task constraints, no `mvn`/gradle/docker commands were executed (host has only 8GB RAM; running
auth-service build/IT alongside other RestaurantOS services risks JVM OOM, and no Docker is available in
this session). The plan's Task 2 verify step (`mvn -q -pl services/auth-service -am compile` and any
Liquibase-migration IT) was **not run**. Verification performed instead: XML well-formedness parse,
grep-based structural checks (permission count, payroll.approve restriction, master-changelog include),
and manual cross-check of role codes against `030-create-roles-permissions.xml`. Recommend running the
deferred `mvn compile` / migration IT in a subsequent session with adequate resources before merging to
QA.
