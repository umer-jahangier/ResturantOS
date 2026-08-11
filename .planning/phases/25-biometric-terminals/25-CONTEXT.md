# Phase 30 — Biometric Terminals (ZKTeco) · CONTEXT

**Blocked-on-user:** U5, a physical ZKTeco terminal — for FINAL SIGN-OFF ONLY

## Why

The user: *"The biometric attendance system using ZKTeco API should be properly working and there
should be proper options to manage or connect and auto-sync the terminals with the app."*

## What already exists — establish this FIRST

Research (`.planning/research/erp-completion/biometric-attendance.md`) rated this
**PARTIALLY_EXISTS, ~4 days** — the smallest estimate in the entire program, because hr-service
already implements the ZKTeco **ADMS / iclock push protocol**: `/iclock` is a gateway public path,
`/internal/attendance/ingest` exists, `AttendanceDeviceEntity` carries a device token and a
connection mode, `DeviceAuthResolver` authenticates devices, `resolve_device` is a
`SECURITY DEFINER` function owned by `postgres` (verified working today), and `AdmsIngestIT` exists.

**So the protocol work is largely done and the gap is management, sync and visibility.** Verify
that claim against the code before planning — this project has repeatedly had components that look
wired and are not. Say plainly what works, what is decorative, and what is missing.

## Locked decisions

**D-25-01 — Terminal management is a tenant UI surface.** Register a device, name it, assign it to
a branch, see its last-seen time, enable/disable it, rotate its token, delete it. No SQL.

**D-25-02 — Device health must be visible, and silence must be loud.**
A biometric terminal that stopped talking three days ago is a payroll problem discovered at
month-end. The UI shows last contact per device, and a device silent beyond a threshold is
surfaced as a warning — not left to be noticed. This is the same failure family as the audit log
sitting at zero rows for four days while everything looked healthy.

**D-25-03 — Employee ↔ device-user mapping is explicit and manageable.**
A terminal knows its own user ids, not your employee ids. That mapping is a real screen with an
unmapped-punch queue an admin can resolve — punches from an unknown device user must be **retained
and surfaced**, never dropped. A dropped punch is an unpaid hour.

**D-25-04 — Testable with no hardware; the terminal is sign-off only.**
An ADMS device is an HTTP client — its traffic can be reproduced exactly. Build a simulator that
posts what a real terminal posts (handshake, `cdata` attendance records, `getrequest` polling),
and use it for every test. List explicitly what genuinely needs U5: firmware quirks, `TransFlag`
encoding, the real `Content-Type` a given firmware sends, clock drift. Everything else is settled
without it. **Do not defer to hardware what a simulator can answer** — phase 26's checker caught
two questions mis-filed that way.

**D-25-05 — Duplicate and out-of-order punches are expected, not exceptional.**
Devices retransmit, clocks drift, networks drop. Ingestion is idempotent on (device, device user,
timestamp, type), and a re-sent batch must not double-count. Assert with a replayed batch.

**D-25-06 — Do not weaken the device auth path.** `/iclock` is public by necessity (a terminal
cannot hold a JWT) and is protected by a per-device token, FEATURE_HR gating and rate limiting.
`HrInternalServiceFilter` deliberately exempts the ingest path. Any change here needs the same
care as a public credential endpoint.

## Constraints

- `hr_db` is FORCE RLS; `resolve_device` is `SECURITY DEFINER` owned by `postgres` **on purpose** —
  it runs before any tenant is known. `deploy/scripts/verify-security-definer-owners.sh` must still
  pass after any change (it is set-returning; the verifier counts rows rather than testing
  `IS NOT NULL`, because a composite is NULL if any field is).
- `HrTestBase` runs `ddl-auto: validate` deliberately. Do not weaken it.
- Timestamps: a device reports local time. Store what it reported AND what the server received —
  both columns already exist. Never conflate them.

## Definition of done

1. An admin registers, names, assigns, disables and rotates the token of a terminal in the UI.
2. Simulated punches from that terminal appear as attendance, mapped to the right employee.
3. Last-contact is visible per device, and a silent device is surfaced as a warning.
4. An unmapped device user produces a resolvable queue item, never a dropped punch.
5. A replayed batch does not double-count — asserted.
6. `HARDWARE-SIGNOFF.md` lists what needs U5 and, explicitly, what does not.
