# Phase 11 Plan 10 — Summary: Device registry + JWT-exempt device-auth path (HR-07)

**Status:** Complete (compile-proven; DeviceAuthResolverIT written, deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline — subagent delegation blocked by platform content filter)

## Objective

The biometric device registry and the JWT-exempt, device-authenticated gateway path class +
`DeviceAuthResolver` that 11-11's ADMS/USB ingest sits behind — the highest-risk security surface,
built and isolated before any punch parsing exists.

## Tasks & commits

| Task | What |
|------|------|
| 1 | `AttendanceDeviceEntity` (device_token @Convert-encrypted), repository (+ `resolveBySerial`), `DeviceDtos`, `AttendanceDeviceService` (register/list/deactivate, constant-time verifyToken), `AttendanceDeviceController` /api/v1/hr/devices; `031-device-resolve-fn.xml` SECURITY DEFINER function |
| 2 | `DeviceAuthResolver` + `DeviceAuthException`; `HrSecurityConfig` permits the device paths |
| 3 | Gateway: `JwtGlobalFilter` PUBLIC_PATHS, `RouteFeatureMap` FEATURE_HR prefixes, `RateLimitConfig.deviceKeyResolver`, `application.yml` device routes; `DeviceAuthResolverIT` |

## How the auth boundary works

1. Device pushes to `/iclock/**` (or `/internal/attendance/ingest`) through the gateway with **no user JWT**.
2. Gateway: `JwtGlobalFilter` skips JWT for these prefixes, but `RouteFeatureMap` still maps them to `FEATURE_HR` so a device pushing to an HR-disabled tenant is rejected at the edge; a per-device `RequestRateLimiter` (keyed on the `SN` query param) caps abuse.
3. hr-service: `HrSecurityConfig` permits the paths (no Spring JWT). `DeviceAuthResolver` is the **real** boundary — it looks up the serial via the `resolve_device()` SECURITY DEFINER function (so the pre-tenant-context read isn't blocked by FORCE RLS), rejects unknown/inactive/wrong-token (`DeviceAuthException` → 401), and **only then** binds tenant/branch from the registry (never client input) and sets the tenant GUC transaction-locally for the RLS-protected `last_seen` update.

## Key decisions / pitfalls handled

- **[11-10-A] Serial resolution vs FORCE RLS** — the device path has no tenant context, so a plain `findBySerialNo` would be hidden by `attendance_devices` RLS under the prod NOSUPERUSER role. Chosen approach: a narrowly-scoped `resolve_device(serial)` SECURITY DEFINER function returning only the matching row. **DEPLOY CAVEAT** (in the changelog comment): SECURITY DEFINER bypasses RLS only if the function's owner is a superuser/BYPASSRLS role — verify the deploy migration role owns it appropriately. Works in the Testcontainers superuser harness.
- **No `X-Internal-Service`** on the device path — `StripInternalHeaderFilter` strips that header from external traffic (Pitfall 1); device auth uses the device token instead.
- **Tenant/branch from the registry only**; context bound only after all checks pass, so failures never leak context; the ingest caller (11-11) must still clear `TenantContext` in a finally (documented on `resolve`).
- **Token returned once** at registration (SecureRandom, Base64url), stored AES-256-GCM encrypted; `verifyToken` is constant-time (`MessageDigest.isEqual`).
- **`/iclock` NOT added to FeatureFlagGlobalFilter's public-prefix list** — only to JWT PUBLIC_PATHS — so FEATURE_HR still gates it.

## Verification

- `mvn -q -pl gateway,services/hr-service -am test-compile` — BUILD SUCCESS. Gateway `application.yml` valid YAML.
- `JwtGlobalFilter` contains `/iclock`; `RateLimitConfig` has `deviceKeyResolver`; `DeviceAuthResolver` has serial-resolve + `set_config` + registry-sourced context.
- **DEFERRED to Docker CI:** `DeviceAuthResolverIT` (`mvn -q -pl services/hr-service -am verify`) — valid/unknown/inactive/wrong-token + no-context-leak; plus runtime validation of the SECURITY DEFINER function's RLS-bypass under a non-superuser role (deploy-review item).

## Follow-ups

- 11-11 builds the ADMS/iClock adapter + USB bridge ingest on top of `DeviceAuthResolver` (wrap `resolve` in try/finally that clears `TenantContext`).
- Deploy review: confirm `resolve_device` ownership bypasses `attendance_devices` RLS in prod.
