// Layer-2 domain models (camelCase). These are the ONLY auth shapes the rest of
// the app (hooks, components) is allowed to see — raw API field names never leak
// past the repository/adapter boundary.

/**
 * Login request body — matches the auth-service contract (D3, widened by 16a-01).
 *
 * `tenantSlug` is OPTIONAL. Omitting it is the normal case: the server verifies the credential and
 * then resolves where it authenticated. Sending one is a hint (from a subdomain, a `?tenant=`, or
 * the tenant chooser) that skips the resolution — never a requirement.
 */
export interface LoginBody {
  email: string;
  password: string;
  /** Omit for the normal email-first login. `@platform` selects the platform console. */
  tenantSlug?: string;
  /** Present only on the TOTP step-up retry. */
  totpCode?: string;
}

/**
 * In-memory session. `accessToken` lives in memory only (never localStorage).
 *
 * `tenantId` and `branchId` are null for a PLATFORM (SuperAdmin) session — a platform user belongs
 * to no tenant, which is the entire reason the gateway has `TENANT_OPTIONAL_PATHS`. Typed as
 * nullable rather than as an empty string so a consumer that forgets the distinction fails to
 * compile instead of sending `""` as a tenant id.
 */
export interface Session {
  accessToken: string;
  expiresAt: Date;
  userId: string;
  tenantId: string | null;
  branchId: string | null;
  /** `"platform"` for a control-plane session; `"access"` for an ordinary tenant one. */
  tokenType: string;
}

/** True when this session belongs to a platform (SuperAdmin) user. */
export function isPlatformSession(session: Session): boolean {
  return session.tokenType === "platform";
}

/**
 * The reserved `tenantSlug` value meaning "the platform console".
 *
 * Mirrors `AuthServiceImpl.PLATFORM_CHOICE`. Only ever sent back after the server offered it in a
 * `TENANT_SELECTION_REQUIRED` chooser — it is not something a user types, and it is deliberately not
 * slug-shaped (a leading `@` cannot collide with `auth_tenants.slug`).
 */
export const PLATFORM_CHOICE = "@platform";

/**
 * Body of `POST /api/v1/auth/change-password/forced`.
 *
 * Carries TWO proofs — the single-use token from the refusal AND the current password — because
 * the endpoint is public at the gateway and either alone would be a weaker gate than the login it
 * stands in for. There is no field naming the account: the user id comes from the redeemed token.
 */
export interface ForcedPasswordChangeBody {
  changeToken: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * Body of `POST /api/v1/auth/2fa/bootstrap` and `/bootstrap/verify` (GA-008).
 *
 * Carries the same three credentials as a login because the endpoint RE-AUTHENTICATES on every
 * call — it is public at the gateway by necessity (the caller has no token and, until enrolment
 * finishes, cannot obtain one), so the password IS the authorization. auth-service refuses once a
 * secret exists, which is what confines this path to breaking a deadlock rather than re-pointing a
 * live second factor.
 *
 * `tenantSlug` is required by the server and is NOT something the user is asked for: after
 * 16a-01's email-first login the browser has no slug, so it comes back in the `details` of the
 * `401 TOTP_ENROLLMENT_REQUIRED` that sent the user here.
 *
 * `code` is omitted on `/bootstrap` (which issues the secret) and carries the first generated code
 * on `/bootstrap/verify` (which activates it).
 */
export interface TotpBootstrapBody {
  email: string;
  password: string;
  tenantSlug: string;
  code?: string;
}

/** `POST /api/v1/auth/2fa/bootstrap` response: the provisioning URI for an authenticator app. */
export interface TotpSetup {
  /** `otpauth://totp/<issuer>:<account>?secret=…&issuer=…` */
  otpauthUri: string;
}

/**
 * Single-use codes that get a user back in when the authenticator is gone.
 *
 * Returned exactly once, by whichever call ACTIVATES the second factor. There is no endpoint that
 * re-reads them — the server holds only digests — so a screen that receives these and does not put
 * them in front of the user has destroyed them.
 */
export interface RecoveryCodes {
  recoveryCodes: string[];
}

/** Whether 2FA is on for the signed-in user, and how many recovery codes remain unspent. */
export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

/** Tenant feature flags (D4 — shape mocked in Phase 4, live endpoint is Phase-3). */
export interface FeatureFlags {
  features: string[];
}

/** Claims decoded from the in-memory access JWT (no `/me` endpoint exists). */
export interface DecodedClaims {
  sub: string;
  tenantId: string;
  branchId: string;
  roles: string[];
  permissions: string[];
  attributes: Record<string, unknown>;
  /**
   * The `token_type` claim: `"platform"` for a control-plane token, `"access"` for a tenant one.
   *
   * A tenant access token does not carry the claim at all (`JwtSigningService.signAccessToken` never
   * sets it), so `decodeJwt` supplies `"access"` when it is absent. Needed since 16b-01, when a
   * platform session gained a refresh token and `/auth/refresh` stopped being a tenant-only path.
   */
  tokenType: string;
  /** Set only when a SuperAdmin is impersonating this user. */
  impersonatedBy?: string;
}
