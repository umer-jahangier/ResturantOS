import { decodeJwt } from "@/lib/auth/jwt";
import type { ApiFeatureFlags, ApiLogin, ApiToken } from "@/lib/api-client/schemas/auth.schema";
import type { FeatureFlags, Session } from "@/lib/models/auth.model";

function expiresAtFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

/** Adapt the login response (carries the ids explicitly) into a domain {@link Session}. */
export function adaptSession(api: ApiLogin): Session {
  return {
    accessToken: api.accessToken,
    expiresAt: expiresAtFromNow(api.expiresInSeconds),
    userId: api.userId,
    // Null for a platform session, and passed through as null rather than coerced: the whole point
    // of the discriminator is that "this session has no tenant" is a fact, not a missing value.
    tenantId: api.tenantId,
    branchId: api.branchId,
    tokenType: api.tokenType,
  };
}

/**
 * Adapt a bare token response (refresh / switch-branch — only accessToken +
 * expiresInSeconds) into a {@link Session}. The ids are read from the new JWT,
 * since the bare response omits them.
 */
export function adaptTokenSession(api: ApiToken): Session {
  const claims = decodeJwt(api.accessToken);
  return {
    accessToken: api.accessToken,
    expiresAt: expiresAtFromNow(api.expiresInSeconds),
    userId: claims.sub,
    tenantId: claims.tenantId,
    branchId: claims.branchId,
    // Refresh and switch-branch are TENANT-only paths by construction: a platform token has no
    // refresh session (auth-service issues none) and no branch. Anything arriving here is therefore
    // a tenant token, and hard-coding that is more honest than reading a claim that is always absent.
    tokenType: "access",
  };
}

export function adaptFeatureFlags(api: ApiFeatureFlags): FeatureFlags {
  return { features: api.features };
}
