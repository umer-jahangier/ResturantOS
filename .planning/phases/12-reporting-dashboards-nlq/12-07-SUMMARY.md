---
phase: 12-reporting-dashboards-nlq
plan: 07
status: complete
completed: 2026-07-18
wave: 3
executed_by: delegated executor (code), finished + verified in the orchestrator main loop (agent stalled on a stream watchdog / Maven-permission block before it could run NlqServiceIT)
---

# 12-07 SUMMARY — NLQ execution (Claude → validate → readonly ClickHouse → quota/cache/audit)

## What was built
`POST /api/v1/nlq/query` end to end, @PreAuthorize nlq.query.run:
1. Reserve quota (per-tenant monthly + per-user hourly) BEFORE anything expensive.
2. Tenant/role/branch-scoped 60s cache lookup (hit → rollback quota, return).
3. Claude NL→SQL (`ClaudeClient`, plain java.net.http; models claude-sonnet-4-6 / claude-haiku-4-5).
4. **Reuses 12-04's `SqlValidationPipeline.validate`** — no unvalidated-SQL path exists.
5. Execute as `nlq_readonly` (server-side profile enforces 5s + 10k-row caps).
6. Best-effort narrate (skipped on empty results).
7. Cache (60s) + audit to `nlq_query_log` with impersonation stamp off the validated JWT.

## Verification — `mvn -pl services/nlq-service verify` → BUILD SUCCESS (75 tests)
Validator suites 56 (SqlInjectionAttack 29, pipeline 7, stage coverage 20), NlqQuotaServiceTest 5
(incl. the exact `nlq_quota:{tenantId}:monthly_count` gateway-key contract + fail-closed on
unreachable Redis), and **NlqServiceIT 14/14** on real ClickHouse (real nlq_readonly user applied
from V002) + Redis + Postgres: happy path, missing-branch-filter rejection, read-only enforcement,
row cap, quota→429, tenant-scoped cache (differentTenant_sameQuestion is NOT a hit), impersonation
stamping.

## Five real defects found by running NlqServiceIT (service had never been booted)
1. **pii-denylist could not bind → context failed to start.** `@Value("${...}") List<String>` can't
   resolve a YAML sequence; changed application.yml to a comma-separated scalar. Prod boot bug.
2. **nlq_db missing shared §8.9 tables.** Scanning io.restaurantos.shared auto-configures the outbox
   relay, which polls event_outbox. Added `V2__shared_infra_tables.sql`.
3+4. **ClickHouse Code 164 (READONLY) on every query.** `template.setQueryTimeout` and
   `stmt.setMaxRows` both become server-side SET of a setting the readonly user may not change.
   Removed both; the server-side profile (12-02) is authoritative and surfaces Code 159/396, already
   mapped to typed exceptions, plus the post-fetch `rows.size() > cap` check.
5. **Cache returned Integer, fresh returned Long** (ClickHouse Int64). Configured the cache
   ObjectMapper with USE_LONG_FOR_INTS so a hit is byte-identical to the fresh result.

## Honest notes
- No live Anthropic call is made in tests — `ClaudeClient` is @MockitoBean-stubbed (no key needed);
  the real HTTP seam is exercised by unit-level tests, not a live API round-trip.
- The security controls are proven against REAL containers with the REAL readonly user, not mocks.

## Commits
- `0976084` Claude client (NL→SQL + narrative) + role-scoped schema prompt
- `eb852cc` read-only executor, quotas, 60s cache, audit log
- `5d4d0d1` NlqService orchestration + controller + end-to-end IT
- `f311da9` the 5 fixes above (make it boot + execute; NlqServiceIT 14/14)
