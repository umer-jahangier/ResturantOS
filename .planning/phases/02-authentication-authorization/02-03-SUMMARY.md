---
phase: 02-authentication-authorization
plan: 03
subsystem: authorization-service + policies
tags: [opa, rego, jwt, internal-api, fail-closed, testcontainers]

dependency-graph:
  requires:
    - 02-01   # frozen JWT claim shape (permissions, tenant_id, branch_id, attributes)
  provides:
    - authorization-service (port 8083) POST /internal/authorize
    - shared AuthorizationService helper (Doc 9 §9.4)
    - policies/restaurantos/{common,pos,finance,vendor,rbac}.rego
    - 2s-timeout fail-closed OpaClient
  affects:
    - All later services call AuthorizationService or /internal/authorize

tech-stack:
  added:
    - services/authorization-service module
    - OPA 1.17.1 Testcontainers in ITs
  patterns:
    - JWT + X-Internal-Service on /internal/**
    - OpaInput built from validated JWT claims (never from request body user fields)
    - DefaultOpaClient serializes input with snake_case JSON for OPA

key-files:
  created:
    - services/authorization-service/**
    - shared-lib/.../AuthorizationService.java
    - policies/restaurantos/{pos,finance,vendor,rbac}.rego
    - policies/tests/*_test.rego
  modified:
    - policies/restaurantos/common.rego (same_branch helper)
    - shared-lib/.../DefaultOpaClient.java (explicit snake_case JSON)
    - shared-lib/.../OpaInput.java (@JsonNaming for OPA)
    - pom.xml (authorization-service module)

commits:
  - 066c7ea feat(02-03): add Rego v1 authz policies for pos/finance/vendor/rbac
  - ba9244a test(02-03): Rego policy tests at 100% opa coverage

opa-ci-gate: "opa test policies/ --coverage --format=json | python3 -c \"import json,sys; print(json.load(sys.stdin)['coverage'])\""

opa-client-timeout:
  connect: 2s
  read: 2s
  bean: OpaConfig @Primary OpaClient with JdkClientHttpRequestFactory + HttpClient connectTimeout

authorize-resource-contract:
  request: "{ module, action, resource: { type, id, tenantId, branchId, createdBy, status, amountPaisa } }"
  response: "{ data: { allow: boolean } }"
  headers: "Authorization: Bearer <JWT>, X-Internal-Service: <INTERNAL_SERVICE_SECRET>"

verification:
  opa_test: "100% coverage (30/30 tests)"
  authz_its: "7/7 pass (AuthorizeIT×6, OpaTimeoutFailClosedIT×1)"
  requirements: AUTHZ-01, AUTHZ-02, AUTHZ-03, AUTHZ-04
---

# Plan 02-03 Summary — Authorization Service & OPA Policies

## Objective

Stand up `authorization-service` with `/internal/authorize`, Rego policies enforcing tenant+branch isolation, and 100% `opa test` coverage.

## What Was Built

- Rego v1 policy tree with `same_tenant`, `same_branch`, `same_tenant_and_branch`, `has_permission`
- `finance.close_period` tenant-wide exception (same tenant, different branch allowed)
- authorization-service proxies to OPA with 2s fail-closed timeout
- Shared `AuthorizationService` helper for downstream modules
- ITs prove allow/deny, cross-tenant/branch denials, close_period exception, and fail-closed on unreachable OPA

## Notes for Phase 4 CI

Wire the opa-ci-gate command above into the pipeline. JaCoCo ≥ 70% on authorization-service when run with `-Pcoverage`.
