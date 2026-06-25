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
    tenantId: api.tenantId,
    branchId: api.branchId,
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
  };
}

export function adaptFeatureFlags(api: ApiFeatureFlags): FeatureFlags {
  return { features: api.features };
}
