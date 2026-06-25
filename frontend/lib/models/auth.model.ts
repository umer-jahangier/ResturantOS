// Layer-2 domain models (camelCase). These are the ONLY auth shapes the rest of
// the app (hooks, components) is allowed to see — raw API field names never leak
// past the repository/adapter boundary.

/** Login request body — matches the auth-service contract (D3). */
export interface LoginBody {
  email: string;
  password: string;
  tenantSlug: string;
  /** Present only on the TOTP step-up retry. */
  totpCode?: string;
}

/** In-memory session. `accessToken` lives in memory only (never localStorage). */
export interface Session {
  accessToken: string;
  expiresAt: Date;
  userId: string;
  tenantId: string;
  branchId: string;
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
