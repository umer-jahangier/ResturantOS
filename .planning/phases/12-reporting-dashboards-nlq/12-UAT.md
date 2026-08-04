---
status: complete
phase: 12-reporting-dashboards-nlq
source: [12-05-SUMMARY.md, 12-06-SUMMARY.md, 12-07-SUMMARY.md, 12-08-SUMMARY.md, 12-09-SUMMARY.md, 12-12-SUMMARY.md, 12-13-SUMMARY.md, 12-14-SUMMARY.md, 12-15-SUMMARY.md]
started: 2026-07-20T00:00:00Z
updated: 2026-07-21T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Reports page renders named reports
expected: Reports section lists named reports (Sales Summary etc.) and they load real data without error.
result: pass
note: "Blocked initially — reporting/nlq/pos/kitchen services were never wired into start-dev.sh; also finance_demo (FINANCE_VIEWER) lacks reporting.report.view. Fixed dev-stack wiring + re-tested as manager1; 7-report catalog renders."

### 2. FBR Tax Summary — numbers + non-null NTN/STRN (GAP B / 12-13)
expected: The FBR Tax Summary report returns output tax, input tax, and net payable (output − input), AND the tenant's NTN and Sales-Tax Registration No (fbrStrn) show as real values, not null/blank.
result: pass

### 3. Realtime dashboard pushes within 5s through the gateway (GAP A / 12-12)
expected: With the dashboard open in the browser (connecting through the real gateway with a ?token= JWT), closing a POS order updates the KPI tiles within ~5 seconds without a page refresh — the WebSocket handshake succeeds (no permanent 401/blocked socket).
result: issue
reported: "Dashboard tiles render with real data but the WS status is stuck on 'Reconnecting…'; the browser WebSocket targets ws://localhost:3000 (the Next dev server, which cannot proxy WS upgrades) and closes before connecting, so no realtime push arrives. The gateway itself is fine (direct curl handshake returns 101 Switching Protocols)."
severity: major
root_cause: "use-dashboard-socket.ts:56 reads process.env.NEXT_PUBLIC_REPORTING_WS_URL (never set anywhere) and falls back to window.location.host (localhost:3000). The configured/centralized var is NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8080 (frontend/lib/env.ts, .env.local, start-dev.sh, deploy/.env). Same class bug in use-kds-socket.ts:66 (NEXT_PUBLIC_KITCHEN_WS_URL) and use-pos-orders-socket.ts:51 (NEXT_PUBLIC_POS_WS_URL). Also a format mismatch: the hooks build `${protocol}//${host}/...` expecting a HOST, but NEXT_PUBLIC_WS_BASE_URL is a full ws:// URL — the fix must consume env.NEXT_PUBLIC_WS_BASE_URL as the base without re-prepending a protocol. GAP A (12-12) fixed the gateway side; this is the un-fixed client side."

### 4. KDS board reachable through the gateway WebSocket (GAP A / 12-12)
expected: The Kitchen Display board, loaded through the real gateway, establishes its WebSocket (?token= JWT) and shows live ticket updates — it is no longer permanently blocked at the gateway.
result: issue
reported: "KDS board renders (REST stations/tickets load after gateway warmup) but its WebSocket to ws://localhost:3000/api/v1/kitchen/kds/{branch}/{station} closes before connecting — same failure as the dashboard. No live ticket push."
severity: major
root_cause: "Same class as Test 3: use-kds-socket.ts:66 reads unset NEXT_PUBLIC_KITCHEN_WS_URL and falls back to window.location.host (localhost:3000, no WS-upgrade proxy in Next dev). Fix is the shared one — route through env.NEXT_PUBLIC_WS_BASE_URL (ws://localhost:8080). See Test 3 gap."

### 5. NLQ ask page — answers valid, rejects unsafe (12-07 / 12-09)
expected: On the NLQ ask page, a plain-English question (e.g. "What was total revenue today?") returns a SQL-backed answer; an unsafe/tenant-less query is honestly rejected with a clear reason (not a silent failure or a raw DB error).
result: skipped
reason: "NL→SQL happy path AND the 7-stage AST rejection both require a live ANTHROPIC_API_KEY — Claude must generate SQL before validation runs, and the dev key is a placeholder that returns HTTP 401 (CLAUDE_UNAVAILABLE), identical to Test 6 / GAP D (12-15). What IS verified in-browser: the ask page renders (input, sample chips, Ask button), submits, and on the Claude-unavailable failure shows an honest, non-leaking message ('That question couldn't be answered … safely') with no crash and no raw DB/SQL error — the 12-09 honest-rejection UX. Full NLQ verification is the documented real-key deferral."

### 6. NLQ live Claude round-trip uses the correct model (GAP D / 12-15)
expected: With a REAL ANTHROPIC_API_KEY exported, running scripts/e2e/phase12-nlq-live-claude-e2e.sh gives HTTP 200 with a real SELECT, and nlq-service logs show the call to model claude-sonnet-4-6 (NOT a 401, NOT the stale claude-sonnet-4-20250514). Without a real key, the script SKIPs honestly — that is the expected deferral, mark this skipped if no key.
result: skipped
reason: "No real ANTHROPIC_API_KEY in this environment — the documented honest deferral. Positive evidence the fix landed: nlq-service logs show live calls to model 'claude-sonnet-4-6' (application.yml model-sql default) returning HTTP 401 — i.e. the request reaches Anthropic with the CORRECTED model ID, not the stale claude-sonnet-4-20250514, and not a 404 model-not-found. Only the credential is missing."

### 7. Impersonation issuance returns a token, no 500 (GAP C / 12-14)
expected: A SuperAdmin impersonating a tenant user (POST /internal/auth/users/{id}/impersonate on the running stack) returns a JWT stamped impersonated_by — it no longer 500s on the missing tenant RLS context.
result: pass
note: "Live call POST /internal/auth/users/c0000011.../impersonate (X-Internal-Service secret) → HTTP 200, not 500. Decoded token: sub=c0000011 (impersonated user), tenant_id=a0000001, impersonated_by=00000000-...-aa (exact value passed), exp ~30min. Tenant RLS context is set before findById as intended."

## Summary

total: 7
passed: 3
issues: 2
pending: 0
skipped: 2

## Gaps

- truth: "Realtime dashboard receives a WS push within 5s of ORDER_CLOSED/TILL_CLOSED, in the browser, through the gateway"
  status: failed
  reason: "User reported: WS stuck 'Reconnecting…'; browser socket targets ws://localhost:3000 (Next dev, no WS-upgrade proxy) and closes before connecting. Gateway direct handshake returns 101 (fine)."
  severity: major
  test: 3
  root_cause: "WS client hooks read wrong/unset env var names and fall back to window.location.host. use-dashboard-socket.ts:56 uses NEXT_PUBLIC_REPORTING_WS_URL (unset); the real var is NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8080 (frontend/lib/env.ts). Same defect: use-kds-socket.ts:66 (NEXT_PUBLIC_KITCHEN_WS_URL), use-pos-orders-socket.ts:51 (NEXT_PUBLIC_POS_WS_URL). Format mismatch too: hooks prepend protocol to a HOST, but the configured var is a full ws:// URL."
  artifacts:
    - path: "frontend/lib/hooks/reporting/use-dashboard-socket.ts"
      issue: "line 56 reads unset NEXT_PUBLIC_REPORTING_WS_URL; should build from env.NEXT_PUBLIC_WS_BASE_URL (full ws:// base, no re-prepended protocol)"
    - path: "frontend/lib/hooks/kds/use-kds-socket.ts"
      issue: "line 66 reads unset NEXT_PUBLIC_KITCHEN_WS_URL (same class — affects Test 4)"
    - path: "frontend/lib/hooks/pos/use-pos-orders-socket.ts"
      issue: "line 51 reads unset NEXT_PUBLIC_POS_WS_URL (same class — POS live order updates)"
  missing:
    - "Route all three WS hooks through env.NEXT_PUBLIC_WS_BASE_URL (ws://localhost:8080 in dev), consuming it as the full base URL without re-adding ws:/wss:; keep window.location.host fallback for same-origin prod behind Nginx"
  debug_session: ""
