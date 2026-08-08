# Phase 11 Plan 11 — Summary: Biometric attendance ingest (HR-07/HR-08)

**Status:** Complete (compile-proven; AdmsIngestIT written, deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline)

## Objective

The ADMS/iClock adapter (Mode A) and USB-bridge ingest (Mode B), both behind the device-authenticated
path from 11-10 — idempotent, offline-safe, quarantine-on-unmapped, ATTENDANCE_PUNCHED, no biometrics.

## Tasks & commits

| Task | What |
|------|------|
| 1 | `PunchIngestService` (durable-mapping resolve, ON CONFLICT insert, quarantine, resolveQuarantine), `AttendanceQuarantineEntity`+repo, `QuarantineController` |
| 2 | `AttlogLineParser`, `AdmsController` (4 /iclock endpoints, text/plain), `DeviceCommandQueueService`, `AttendanceIngestController` (Mode B) |
| 3 | `AdmsIngestIT`, `Docs/agent-specs/usb-bridge-agent-ingest-contract.md` |

## How it works (both modes converge on `PunchIngestService`)

- **Mode A** (`AdmsController`, text/plain): GET/POST `/iclock/cdata`, GET `/iclock/getrequest`,
  POST `/iclock/devicecmd`. Each calls `DeviceAuthResolver.resolve(serial, token)` FIRST (no JWT /
  X-Tenant-Id on this path), then clears `TenantContext` in a finally (no leak on pooled threads).
  ATTLOG lines parse via `AttlogLineParser`; server replies bare `OK`.
- **Mode B** (`AttendanceIngestController`): `POST /internal/attendance/ingest` JSON, authenticated by
  the **device token** (not `X-Internal-Service` — Pitfall 1). Matching is in the out-of-JVM agent;
  only `{employeeRef, deviceId, punchedAt}` is sent.
- **`PunchIngestService.ingest`**: resolves the employee via the DURABLE `employees.device_user_ref`
  mapping (not per-punch); native `INSERT … ON CONFLICT (device_id, device_user_ref, device_reported_at)
  DO NOTHING`; stores **both** timestamps; **quarantines** an unmapped ref; publishes `ATTENDANCE_PUNCHED`
  **only on a genuine insert** (rowcount 1). No raw biometrics accepted/stored.

## Key decisions (RESEARCH pitfalls handled)

- **Quarantine-loop fix:** `resolveQuarantine` persists `employees.device_user_ref = <ref>` (durable),
  re-ingests the parked punch, marks RESOLVED — so every future punch for that ref auto-resolves. Guards
  the `(tenant, device_user_ref)` uniqueness (rejects re-mapping to a different employee).
- **Defensive parse:** first 4 fields positional (PIN / `yyyy-MM-dd HH:mm:ss` Asia/Karachi / status /
  verify), extras ignored, `<4` fields skipped (never throws). status 0→IN, 1→OUT, else UNKNOWN.
- **Idempotency via ON CONFLICT**, NOT the `idempotency_keys` table (Pitfall 3, high volume).
- **ADMS token seam:** the device token is read from a `token` query param (ADMS has no standard auth
  header); real terminals configure it as their "stamp". `DeviceCommandQueueService` is an empty seam.
- **Mode B agent NOT built** — only the contract doc (RESEARCH Pattern 5).

## Verification

- `mvn -q -pl services/hr-service -am compile` / `test-compile` — BUILD SUCCESS.
- **DEFERRED to Docker CI:** `AdmsIngestIT` (`mvn -q -pl services/hr-service -am verify -Dtest=AdmsIngestIT`)
  — parse/ingest/skip-short, replay=no-dup + single event, quarantine→resolve→durable-mapping→auto-resolve,
  wrong-token reject, Mode B ingest. Also validates the native ON CONFLICT insert + the `resolve_device`
  SECURITY DEFINER path under real Postgres.

## Follow-ups

- Build the signed USB bridge agent binary per the contract doc (separate deliverable).
- Confirm the ADMS token-passing mechanism against a real ZKTeco/eSSL terminal firmware.
