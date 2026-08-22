import { z } from "zod";

// RAW API field names (camelCase, per the auth-service contract D3). This module
// is the ONLY place that knows the wire shape — repositories `.parse()` here and
// adapters convert to domain models. NEVER use `.safeParse` (it swallows drift).

/**
 * POST /api/v1/auth/login success body.
 *
 * `tenantId` / `branchId` are nullable as of 16a-01: the same endpoint now issues control-plane
 * tokens for platform (SuperAdmin) users, who belong to no tenant. `tokenType` is the discriminator
 * and is REQUIRED — auth-service's `LoginResponse` always populates it (`"access"` for tenant
 * logins, `"platform"` for control-plane ones), so accepting its absence would only let a genuine
 * contract regression through this parse silently.
 */
export const apiLoginSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number(),
  userId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  branchId: z.string().uuid().nullable(),
  tokenType: z.string(),
});

/** POST /api/v1/auth/refresh and /switch-branch success body. */
export const apiTokenSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number(),
});

/**
 * `POST /api/v1/auth/2fa/bootstrap` success body (GA-008).
 *
 * One field, and it is the whole point: `TotpSetupResponse` is `record TotpSetupResponse(String
 * otpauthUri)`. The SECRET is never returned on its own — it exists only inside this URI's
 * `?secret=` parameter, which is what an authenticator app consumes.
 */
export const apiTotpSetupSchema = z.object({
  otpauthUri: z.string(),
});

/**
 * The recovery codes handed back when a second factor is ACTIVATED, and never again.
 *
 * The server keeps only SHA-256 digests, so this response is the single moment the plaintext
 * exists anywhere. `.min(1)` rather than a bare array because an empty list here would be a silent
 * contract break: the UI would render a reassuring "save these codes" panel containing nothing, and
 * the user would file away an empty page believing they were covered.
 */
export const apiRecoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()).min(1),
});

/** `GET /api/v1/auth/2fa/status` — never carries the codes themselves, only how many are left. */
export const apiTwoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  recoveryCodesRemaining: z.number(),
});

/** Feature-flags endpoint (D4 — shape mocked in Phase 4; confirm live contract). */
export const apiFeatureFlagsSchema = z.object({
  features: z.array(z.string()),
});

export type ApiLogin = z.infer<typeof apiLoginSchema>;
export type ApiToken = z.infer<typeof apiTokenSchema>;
export type ApiTotpSetup = z.infer<typeof apiTotpSetupSchema>;
export type ApiFeatureFlags = z.infer<typeof apiFeatureFlagsSchema>;
