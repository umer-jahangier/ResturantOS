# USB Bridge Agent — Attendance Ingest Contract (Mode B)

**Status:** Contract only. The bridge agent binary is a **separate deliverable**, NOT built in Phase 11.
This document is the wire contract hr-service exposes for it.

## Why an out-of-JVM agent

A browser cannot read a USB fingerprint/face reader (WebUSB/WebHID have no usable protocol for these
readers, and WebAuthn only verifies the logged-in user, not arbitrary employees on a shared device).
So a small **signed local agent** (Windows service / tray app) on the branch PC talks to the reader
through the vendor SDK, performs capture + 1:N matching **locally**, and relays only the resolved
punch. The browser POS subscribes to the agent over `wss://127.0.0.1:{port}` for live punches; the
agent (or the browser on its behalf) POSTs the punch to the platform.

**No raw biometrics ever leave the branch.** Matching happens in the agent; only
`{employeeRef, deviceId, punchedAt}` is sent.

## Endpoint

```
POST https://<gateway-host>/internal/attendance/ingest
Content-Type: application/json
```

The gateway treats this path as **JWT-exempt but FEATURE_HR-gated and per-device rate-limited**
(`SN`/serial-keyed). It is NOT authenticated by a user JWT and does NOT use the `X-Internal-Service`
header (the gateway's `StripInternalHeaderFilter` strips that from external traffic). Authentication
is the **device token** issued at device registration — the same scheme as the `/iclock` ADMS path.

### Request body

```json
{
  "serial":     "USB-BR-000123",           // the device serial registered in attendance_devices
  "token":      "<device token, plaintext>", // issued once at registration; stored AES-256-GCM encrypted server-side
  "employeeRef":"1001",                     // the durable device_user_ref mapped to an employee
  "punchType":  "IN",                       // IN | OUT | UNKNOWN
  "punchedAt":  "2026-06-15T09:00:00Z"      // ISO-8601 instant, the moment of the punch at the edge
}
```

### Response

```json
{ "result": "INSERTED" }   // or "DUPLICATE" (replay) or "QUARANTINED" (employeeRef not yet mapped)
```

`401` if the serial is unknown/inactive or the token is invalid (`DeviceAuthResolver`).

## Server-side processing (identical to Mode A)

`DeviceAuthResolver` verifies serial+token and derives **tenant/branch from the registry** (never from
the request). Then `PunchIngestService.ingest`:

- resolves the employee via the **durable** `employees.device_user_ref` mapping;
- inserts `ON CONFLICT (device_id, device_user_ref, device_reported_at) DO NOTHING` — **idempotent**;
- stores **both** `device_reported_at` (= `punchedAt`) and `server_received_at` (= now);
- an **unmapped** `employeeRef` is **quarantined** (parked for admin resolution), never dropped;
- publishes `ATTENDANCE_PUNCHED` **only on a genuine insert**.

## Offline buffering & replay

The agent MUST buffer punches while offline and replay them when connectivity returns. Replays are
safe: the server's idempotency key is **`device_id + employeeRef + punchedAt`** (the `ON CONFLICT`
target), so a re-sent punch produces no duplicate row and no duplicate event. The agent SHOULD retry
with backoff and treat `DUPLICATE` as success.

## Security notes

- The device token is a bearer secret — the agent stores it in the OS secret store, transmits it only
  over HTTPS to the gateway.
- Matching and any template storage stay **on the branch**. If a tenant opts into central templates
  (HR-08), they are AES-256-GCM encrypted server-side with a retention policy — that path is separate
  from this ingest contract and off by default.
