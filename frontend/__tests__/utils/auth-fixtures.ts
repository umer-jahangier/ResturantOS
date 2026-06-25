import { useSessionStore } from "@/lib/auth/session";

// Test helpers for crafting a decode-able session. The access token is an
// unsigned, real-shaped JWT whose payload `decodeJwt` can read (matches the
// claim names tenant_id/branch_id/roles/permissions/attributes).

export interface FixtureClaims {
  sub?: string;
  tenantId?: string;
  branchId?: string;
  roles?: string[];
  permissions?: string[];
  attributes?: Record<string, unknown>;
}

function base64Url(input: string): string {
  const base64 = Buffer.from(input, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeAccessToken(claims: FixtureClaims = {}): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: claims.sub ?? "user-1",
      tenant_id: claims.tenantId ?? "tenant-1",
      branch_id: claims.branchId ?? "branch-1",
      roles: claims.roles ?? [],
      permissions: claims.permissions ?? [],
      attributes: claims.attributes ?? {},
    }),
  );
  return `${header}.${payload}.`;
}

/** Inject an authenticated session into the Zustand store and return its token. */
export function seedSession(claims: FixtureClaims = {}): string {
  const accessToken = makeAccessToken(claims);
  useSessionStore.setState({
    session: {
      accessToken,
      expiresAt: new Date(Date.now() + 900_000),
      userId: claims.sub ?? "user-1",
      tenantId: claims.tenantId ?? "tenant-1",
      branchId: claims.branchId ?? "branch-1",
    },
  });
  return accessToken;
}

export function clearSession(): void {
  useSessionStore.setState({ session: null });
}
