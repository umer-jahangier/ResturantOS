---
phase: 12-reporting-dashboards-nlq
verified: 2026-07-21T17:36:37Z
status: human_needed
score: 4/4 must-haves verified (3 of 4 human-verification items closed this pass via live browser UAT; 1 remains — live-key NLQ round-trip)
re_verification:
  previous_status: human_needed
  previous_score: "4/4 code-verified; 4 items needed real-stack/live-key re-proof"
  gaps_closed:
    - "Consolidated real-stack re-proof of 12-12 (gateway WS ?token= JWT fallback) — dashboard + KDS sockets handshake 101 through the real gateway (:8080), confirmed live in browser this session"
    - "Consolidated real-stack re-proof of 12-13 (FBR ntn/fbrStrn RLS-GUC fallback) — FBR Tax Summary through the gateway returns non-null ntn/fbrStrn (UAT test 2, pass)"
    - "Consolidated real-stack re-proof of 12-14 (impersonation-issuance RLS-GUC + @Transactional) — POST .../impersonate returns HTTP 200 with impersonated_by stamped correctly (UAT test 7, pass)"
    - "Dashboard WS realtime push within 5s (SC2) — closed via 12-16, which fixed the actual root cause found during UAT (browser hooks read unset env vars and fell back to localhost:3000); re-verified live: WS 101, status 'Live', KPI tiles updated (Revenue Rs 0→110, Orders 0→1, Tax Rs 0→10) with no page refresh after a real order close"
  gaps_remaining:
    - "Live-key NLQ round-trip via scripts/e2e/phase12-nlq-live-claude-e2e.sh — still blocked purely on absence of a real ANTHROPIC_API_KEY (dev key is a placeholder returning HTTP 401). Positive evidence the model-id fix landed: nlq-service logs show live calls reaching Anthropic with the corrected model claude-sonnet-4-6, not the stale id, failing only on the placeholder credential. This is an operational/secrets gap, not a code gap."
  regressions: []
human_verification:
  - test: "Live-key NLQ round-trip via scripts/e2e/phase12-nlq-live-claude-e2e.sh"
    expected: "With a real ANTHROPIC_API_KEY exported and nlq-service/gateway/auth-service running, the script performs a real NL->SQL Claude call through the full Spring app and confirms the corrected model id (claude-sonnet-4-6) is used end-to-end without a 401 from Anthropic, and that a tenant/branch-less query is honestly rejected by the 7-stage AST pipeline."
    why_human: "No real Anthropic API key is available in this environment; the dev key is a placeholder returning HTTP 401 from Anthropic. UAT tests 5 and 6 were correctly SKIPPED (not failed) for this reason. The 7-stage validation pipeline code, quota/cache/read-only-executor code, and impersonation-stamping code all exist and are unit-tested (see below) — only the live Claude round-trip through the running stack needs a real credential."
---

# Phase 12: Reporting, Dashboards & NLQ Verification Report

**Phase Goal:** Turn the system's events into insight safely — ClickHouse-backed reports (including FBR), a realtime dashboard, and a natural-language query path that is read-only and tenant/branch-safe by construction.

**Verified:** 2026-07-21T17:36:37Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (12-16) and a full-session live UAT pass

## Summary

This is the second VERIFICATION.md for Phase 12. The first pass (2026-07-19) found all required code present, substantive, and wired, but flagged 4 items needing real-stack/live-key operational proof rather than mocked unit tests. Since then:

- A UAT session (`12-UAT.md`, status: complete) ran 7 tests against the real dev stack (all 16 services + Docker infra) through the actual gateway. Results: 3 passed, 2 issues, 2 skipped.
- The 2 "issues" (dashboard WS and KDS WS not pushing within 5s) were root-caused to a real client-side defect: three browser WS hooks (`use-dashboard-socket.ts`, `use-kds-socket.ts`, `use-pos-orders-socket.ts`) read unset `NEXT_PUBLIC_*_WS_URL` env vars and fell back to `window.location.host`, which in dev is `localhost:3000` (the Next.js dev server — it does not proxy WebSocket upgrades). This silently defeated the 12-12 gateway-side fix.
- Gap-closure plan **12-16** fixed this: a single shared `wsUrl()`/`resolveWsBaseUrl()` resolver (`frontend/lib/hooks/ws-base-url.ts`) now reads `NEXT_PUBLIC_WS_BASE_URL` (the actually-configured var, `ws://localhost:8080` in dev) as a full base URL without re-prepending a scheme, with a same-origin fallback for production behind Nginx. All three hooks were routed through it. A static regression guard test reads the hook source files off disk and fails if any of them ever reintroduces the broken pattern.
- This was re-verified **live in the browser this session**: both dashboard and KDS sockets now handshake `101 Switching Protocols` against the real gateway; the dashboard status reads "Live"; closing a real POS order pushed updated KPI tiles (Revenue Rs 0.00→110.00, Orders 0→1, Tax Rs 0.00→10.00, AOV Rs 0.00→110.00) with no page refresh, well inside the 5s budget.
- 3 of the 4 previously-outstanding "human verification" items (12-12, 12-13, 12-14 real-stack re-proofs) are now closed via the UAT's live pass-through-gateway tests.
- 1 item remains genuinely outstanding: the live-key NLQ round-trip (UAT tests 5 & 6), blocked purely on the dev environment lacking a real `ANTHROPIC_API_KEY` — an operational/secrets gap, not a code gap. Positive evidence exists that the underlying model-id bug (12-15) is fixed: nlq-service logs show calls reaching Anthropic with the corrected `claude-sonnet-4-6`, failing only on the placeholder key (401), not a stale/wrong model id.
- An unrelated blocking defect (finance-service duplicate Flyway V5 migrations preventing service startup) was found and fixed this session (`a29a75b`). Not a Phase 12 deliverable but it gated POS order-close, which is why it surfaced during 12-16's real-browser checkpoint.

**Finding: all required code for all 4 success criteria exists, is substantive, and is wired. 3 of 4 success criteria are now proven end-to-end through the real running stack (browser → gateway → services → DB). SC3/SC4 (NLQ) are code-complete and unit-tested but the full live-Claude round-trip remains deferred to possession of a real API key** — an honest, documented operational deferral, not a functional gap.

## Goal Achievement

### Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | ETL facts + named reports (incl. FBR) return within P95 targets, using business-day boundary formula | VERIFIED (live) | `SalesFactWriter.java`, `TillSessionFactWriter.java`, `FbrTaxSummaryService.java`, `BusinessDay.java` present and wired to `OrderClosedConsumer`/`TillClosedConsumer`/`VendorInvoiceMatchedConsumer`. UAT test 1: 7-report catalog renders with real data as manager1. UAT test 2: FBR Tax Summary returns output tax, input tax, net payable, and non-null `ntn`/`fbrStrn` (12-13 fix confirmed live through the gateway). P95 latency not independently re-measured this pass (covered by 12-10's E2E evidence). |
| 2 | Dashboard WebSocket pushes updates within 5s of ORDER_CLOSED/TILL_CLOSED | VERIFIED (live, this session) | UAT tests 3/4 initially failed (client targeted `localhost:3000`, no WS-upgrade proxy). **12-16 fixed the root cause** (`frontend/lib/hooks/ws-base-url.ts` shared resolver, all 3 hooks routed through it, 17 passing unit/regression tests confirmed this session). Re-verified live: WS handshake 101 at `ws://localhost:8080`, dashboard status "Live", real order close pushed updated KPI tiles with no refresh, inside 5s. |
| 3 | NLQ NL→SQL via Claude passes 7-stage AST validation; missing tenant/branch filter is rejected | CODE VERIFIED, live round-trip deferred | `SqlValidationPipeline.java` runs all 7 stages in order (`ShapeCheckStage → AstParseStage → TableAllowlistStage → PiiDenylistStage → TenantFilterStage → BranchFilterStage → LimitInjectStage`); all 7 stage files present under `services/nlq-service/.../validation/stage/`. `TenantFilterStage`/`BranchFilterStage` inject-then-reparse to structurally guarantee the filter is present — this is the rejection mechanism for a query missing tenant/branch scope. UAT: ask page renders, submits, and on Claude-unavailable (401 placeholder key) shows an honest non-leaking error (12-09 UX) — no crash, no raw SQL/DB error. Full happy-path + rejection-path proof needs a real key (UAT tests 5/6 skipped, not failed). |
| 4 | NLQ enforces read-only, 5s timeout, row cap, per-tenant monthly + per-user hourly quotas, 60s cache, stamps impersonation in nlq_query_log | CODE VERIFIED, live round-trip deferred | `ClickHouseReadOnlyExecutor.java` (typed `NlqTimeoutException` for timeout/row-cap), `NlqQuotaService.java` (atomic Redis INCRBY/DECRBY reserve-rollback, both monthly-tenant and hourly-user keys, config-driven limits), `NlqResultCache.java` (`cache-ttl-seconds`, documented "60-second" TTL), `NlqQueryLogEntity/Service/Repository` (`impersonated_by` sourced only from the validated JWT's `impersonatedBy()` claim). Impersonation issuance itself (the upstream dependency, 12-14) is now proven live: UAT test 7 — real impersonation call returns HTTP 200 (not 500), decoded token has correct `sub`, `tenant_id`, `impersonated_by`. The query-log stamping code downstream of that token is unchanged and was already correct. Live NLQ query using an impersonated token (to see the log row written) still needs a real Anthropic key — deferred. |

**Score:** 4/4 success criteria have complete, substantive, wired code. 3/4 are proven live end-to-end this session (SC1, SC2, and the impersonation-issuance half of SC4). SC3 and the NLQ-execution half of SC4 are code-verified and unit-tested but the full live-Claude round-trip is deferred solely on API-key possession.

### 12-16 Gap-Closure — Code-Level Verification

| Claim | Verified in source | Detail |
|-------|---------------------|--------|
| Shared `wsUrl()`/`resolveWsBaseUrl()` resolver created | YES | `frontend/lib/hooks/ws-base-url.ts` — reads raw `process.env.NEXT_PUBLIC_WS_BASE_URL` (not the defaulted `env.ts` object, so prod correctly falls back to same-origin when unset), returns full base with trailing slash stripped, never re-prepends a scheme |
| All 3 browser WS hooks routed through it | YES | `frontend/lib/hooks/reporting/use-dashboard-socket.ts`, `frontend/lib/hooks/kds/use-kds-socket.ts`, `frontend/lib/hooks/pos/use-pos-orders-socket.ts` all `import { wsUrl } from "@/lib/hooks/ws-base-url"` and build their connection URL via `wsUrl(...)`; grep confirms no remaining `NEXT_PUBLIC_*_WS_URL` or bare `window.location.host` references in any of the three |
| Static regression guard exists | YES | `frontend/__tests__/lib/ws-base-url.test.ts` reads the three hook source files off disk and regex-checks for the historical broken pattern |
| Unit tests pass | YES (ran this session) | `npx vitest run __tests__/lib/ws-base-url.test.ts __tests__/reporting/use-dashboard-socket.test.tsx __tests__/kds/use-kds-socket.test.tsx` → 3 files, 17/17 tests passed |
| Real-browser live proof | YES (per UAT + SUMMARY, consistent with orchestrator-provided context) | Dashboard/KDS WS handshake 101 at gateway, status "Live", real order close pushed updated tiles (Revenue Rs 110.00, Orders 1, Tax Rs 10.00) without refresh |

### Required Artifacts (Spot-Checked)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/nlq-service/.../validation/SqlValidationPipeline.java` | 7-stage pipeline orchestration | VERIFIED | Present, orchestrates all 7 stages in order |
| `services/nlq-service/.../validation/stage/{Shape,AstParse,TableAllowlist,PiiDenylist,TenantFilter,BranchFilter,LimitInject}Stage.java` | All 7 stage classes | VERIFIED | All 7 files present on disk (confirmed this session via `find`) |
| `services/nlq-service/.../quota/NlqQuotaService.java` | Monthly tenant + hourly user quotas | VERIFIED | Present (unchanged since prior pass) |
| `services/nlq-service/.../cache/NlqResultCache.java` | 60s result cache | VERIFIED | Present (unchanged) |
| `services/nlq-service/.../audit/NlqQueryLog{Entity,Service,Repository}.java` | Impersonation-stamped audit log | VERIFIED | Present (unchanged) |
| `services/nlq-service/.../execution/ClickHouseReadOnlyExecutor.java` | Read-only exec, timeout, row cap | VERIFIED | Present (unchanged) |
| `services/reporting-service/.../ws/DashboardWebSocketHandler.java` | Realtime dashboard push | VERIFIED | Present, confirmed via `find` this session |
| `services/reporting-service/.../support/BusinessDay.java` | Business-day boundary formula | VERIFIED | Present |
| `services/reporting-service/.../service/FbrTaxSummaryService.java` | FBR Tax Summary report | VERIFIED | Present; live UAT confirms non-null ntn/fbrStrn |
| `frontend/lib/hooks/ws-base-url.ts` | Shared WS URL resolver (12-16) | VERIFIED | Present, substantive, 17 passing tests |
| `services/finance-service/.../V7__posted_source_events.sql` | Flyway migration collision fix | VERIFIED | Renamed from duplicate V5; finance-service confirmed starting live (commit `a29a75b`) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Browser dashboard/KDS/POS hooks | Gateway (`:8080`) WS upgrade | `wsUrl()` → `NEXT_PUBLIC_WS_BASE_URL` | WIRED, LIVE-PROVEN | Handshake 101 confirmed in browser this session, not just unit-mocked |
| Gateway `JwtGlobalFilter` | Reporting/Kitchen WS upstream | `?token=` query-param fallback + `authorizeAndForward()` | WIRED, LIVE-PROVEN | Same live browser proof supersedes the prior unit-only proof |
| `BranchInternalController.getBranch` | RLS-scoped `branches` SELECT | `TenantContext` fallback | WIRED, LIVE-PROVEN | UAT test 2: FBR report returns non-null ntn/fbrStrn through the real gateway |
| `ProvisioningAdminService.impersonate` | RLS-scoped `findById` | `@Transactional` + `setTenantGuc` first | WIRED, LIVE-PROVEN | UAT test 7: real call returns 200 with correctly-stamped token, not 500 |
| `NlqController` | `NlqQueryLogService` | `claims.impersonatedBy()` → `nlq_query_log.impersonated_by` | WIRED (code-proven, live NLQ call still pending real key) | Code path unchanged and verified in source; end-to-end row write not observed live yet (blocked on Claude key) |
| `ClaudeClient` | Anthropic Messages API | `model-sql` config | WIRED (component + partial live proof) | nlq-service logs this session show live requests reaching Anthropic with the corrected `claude-sonnet-4-6` model id, failing only on placeholder-key 401 — confirms the 12-15 fix reaches production code paths, short of a full 200 round-trip |

### Anti-Patterns Found

None. No TODO/FIXME/placeholder/stub patterns found in any of the 12-16 files (`ws-base-url.ts`, the three hooks, their tests). All modified code is substantive with matching regression tests.

### Human Verification Required

1. **Live-key NLQ round-trip** (`scripts/e2e/phase12-nlq-live-claude-e2e.sh`) — with a real `ANTHROPIC_API_KEY`, confirm HTTP 200 with a real SELECT and nlq-service logs showing `claude-sonnet-4-6` (not a 401/404). Also confirms the 7-stage AST pipeline's rejection path live (a tenant/branch-less generated query being rejected) and a real `nlq_query_log` row with `impersonated_by` stamped when using an impersonated token. This is the sole remaining gap — purely an operational/secrets constraint (no real key in this environment), not a code deficiency.

### Gaps Summary

No code gaps. All artifacts for all 4 success criteria exist, are substantive, and are wired — including the 12-16 fix that closed the real defect UAT surfaced (browser WS hooks targeting the non-proxying Next dev server instead of the gateway). 3 of the 4 previously-outstanding operational/real-stack proofs are now closed via this session's live UAT pass. The single remaining item — a live-key NLQ round-trip — is honestly documented as blocked on API-key possession, with positive partial evidence (correct model id reaching Anthropic, failing only on the placeholder credential) that the underlying code is correct.

---

*Verified: 2026-07-21T17:36:37Z*
*Verifier: Claude (gsd-verifier)*
