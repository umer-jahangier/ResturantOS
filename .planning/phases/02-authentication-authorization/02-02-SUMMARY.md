---
phase: 02-authentication-authorization
plan: 02
subsystem: auth-service + shared-lib
tags: [totp, aes-gcm, password-reset, branch-switch, step-up, testcontainers]

dependency-graph:
  requires:
    - 02-01   # login/JWT/RLS/seed users
  provides:
    - shared-lib EncryptionService + EncryptedStringConverter (opt-in EncryptionAutoConfiguration)
    - TOTP setup/verify/disable with AES-256-GCM totp_secret
    - Mandatory login step-up for privileged permissions
    - Password reset (30-min single-use token + last-5 reuse check)
    - Branch switch (reissue access JWT, keep refresh session)
  affects:
    - 02-03: JWT permissions unchanged; OPA step-up already assumes TOTP at login

tech-stack:
  added:
    - dev.samstevens.totp:totp:1.7.1
    - password_reset_tokens + password_history tables
  patterns:
    - Step-up predicate at login (see below)
    - FIELD_ENCRYPTION_KEY → restaurantos.encryption.key → EncryptionAutoConfiguration
    - Password reset token SHA-256 at rest; plaintext only in PASSWORD_RESET_REQUESTED outbox payload

key-files:
  created:
    - shared-lib/.../EncryptionService.java, EncryptedStringConverter.java, EncryptionAutoConfiguration.java
    - services/auth-service/.../TotpService.java, TwoFactorController.java, TwoFactorService.java
    - services/auth-service/.../PasswordResetService.java, PasswordResetController.java
    - services/auth-service/.../BranchSwitchService.java, BranchSwitchController.java
    - services/auth-service/.../integration/{TotpFlowIT,StepUpLoginIT,PasswordResetIT,BranchSwitchIT}.java
  modified:
    - services/auth-service/.../AuthServiceImpl.java (step-up)
    - services/auth-service/.../UserEntity.java (@Convert totp_secret)
    - shared-lib/.../JwksKeyProvider.java (pre-seeded key lookup fix for ITs)

commits:
  - feat(02-02): add shared-lib AES-256-GCM field encryption
  - feat(02-02): TOTP 2FA with encrypted secret and login step-up
  - feat(02-02): password reset tokens and last-5 reuse policy
  - test(02-02): branch switch and SC3 integration tests
  - docs(02-02): complete plan 02-02 summary

verification:
  command: "DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_RYUK_DISABLED=true mvn -pl services/auth-service verify"
  result: "11/11 ITs pass (5 existing + 4 new + StepUpLoginIT×2)"
---

# Plan 02-02 Summary — TOTP, Reset, Branch Switch

## Step-up predicate (Open Q2 resolved)

After password match and permission resolution, **before** token issuance:

```
requiresTotp = totp_enabled
            OR permissions contains "rbac.manage"
            OR permissions contains "finance.period.close"
```

If `requiresTotp` and (`totp_secret` is null OR `totpCode` missing/invalid) → **401 `TOTP_REQUIRED`** + `USER_LOGIN_FAILED` event.

Privileged users without enrolled TOTP cannot log in (must enroll out-of-band — Phase 3 provisioning or test fixture writing encrypted secret directly). **`POST /api/v1/auth/2fa/step-up` deferred** (optional stub not implemented).

## EncryptionService home (Open Q4 resolved)

- Lives in **shared-lib**: `EncryptionService`, `EncryptedStringConverter`
- Wired by **opt-in** `EncryptionAutoConfiguration` (`@ConditionalOnProperty restaurantos.encryption.key`)
- Registered in `AutoConfiguration.imports` — **SharedAutoConfiguration unchanged**
- `users.totp_secret` uses `@Convert(EncryptedStringConverter.class)` on `bytea` column

## Password reset policy (AUTH-06)

- Token TTL: **30 minutes**
- Storage: **SHA-256 hash** only (`password_reset_tokens.token_hash`)
- Single-use: `used_at` set on confirm
- Reuse: rejects match against **current hash + last 5** `password_history` rows (bcrypt-12)
- Event: `PASSWORD_RESET_REQUESTED` on `auth.topic` (email delivery = Phase 5 consumer)

## Branch switch (AUTH-05)

- `POST /api/v1/auth/switch-branch` verifies active `user_branch_roles` row
- Reissues access JWT with new `branch_id` / permissions / attributes
- Refresh cookie/session **unchanged** (no rotation)

## Test notes

- `cashier@demo.local` — non-step-up paths (TOTP flow, reset, branch switch)
- `owner@demo.local` — step-up IT (direct enrollment via `UserRepository` + plain secret → converter encrypts)
- `TotpFlowIT` restores `totp_secret` / `totp_enabled` in `@AfterEach` for shared DB isolation
- Fixed `JwksKeyProvider.getKey` pre-seeded mode (avoid `Instant.MAX.plus(TTL)` overflow on authenticated endpoints)
