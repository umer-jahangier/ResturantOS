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
  /** Set only when a SuperAdmin is impersonating this user. */
  impersonatedBy?: string;
}
