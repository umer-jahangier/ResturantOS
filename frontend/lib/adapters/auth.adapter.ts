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
 *
 * <h3>Why `tokenType` is read rather than assumed (16b-01)</h3>
 *
 * This function used to hard-code `tokenType: "access"`, with a comment explaining that refresh was
 * a tenant-only path "by construction" because "a platform token has no refresh session
 * (auth-service issues none)". That reasoning was sound and its premise is now false: 16b-01 gives
 * a platform session a short-lived rotating refresh token, so `POST /api/v1/auth/refresh` can
 * legitimately return a control-plane token.
 *
 * Left as it was, a SuperAdmin who reloaded would have rehydrated into a session labelled `access`
 * with `tenantId: ""` — a platform user wearing a tenant session's clothes, which is exactly the
 * confusion `isPlatformSession` exists to prevent. The claim is on the token
 * (`JwtSigningService.signPlatformToken` sets `token_type: "platform"`), so it is read from there.
 *
 * A tenant access token carries no `token_type` claim at all, so the absent case falls back to
 * `"access"` — which is what every existing caller, including switch-branch, keeps getting.
 */
export function adaptTokenSession(api: ApiToken): Session {
  const claims = decodeJwt(api.accessToken);
  return {
    accessToken: api.accessToken,
    expiresAt: expiresAtFromNow(api.expiresInSeconds),
    userId: claims.sub,
    // Normalised to null, not passed through as "". A platform token has no `tenant_id` claim and
    // `decodeJwt` renders a missing string claim as "", but `Session.tenantId` is typed
    // `string | null` precisely so "this session has no tenant" is a fact rather than a falsy
    // value that some consumer will one day send to an API as a tenant id.
    tenantId: claims.tenantId || null,
    branchId: claims.branchId || null,
    tokenType: claims.tokenType,
  };
}

export function adaptFeatureFlags(api: ApiFeatureFlags): FeatureFlags {
  return { features: api.features };
}
