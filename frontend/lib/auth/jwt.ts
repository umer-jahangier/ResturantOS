import type { DecodedClaims } from "@/lib/models/auth.model";

// Dependency-light JWT payload decode. NO signature verification — the gateway
// already validated the token; this only reads claims (roles/permissions/attrs)
// from the in-memory access token for client-side guards (there is no /me call).

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLength);

  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // Node / SSR fallback (Buffer is available in the Next.js server runtime).
  return Buffer.from(padded, "base64").toString("utf-8");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** Decode the JWT payload into camelCase {@link DecodedClaims}. Throws on a malformed token. */
export function decodeJwt(token: string): DecodedClaims {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) {
    throw new Error("Invalid JWT: missing payload segment");
  }

  const raw = JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
  const impersonatedBy = raw.impersonated_by;

  return {
    sub: typeof raw.sub === "string" ? raw.sub : "",
    tenantId: typeof raw.tenant_id === "string" ? raw.tenant_id : "",
    branchId: typeof raw.branch_id === "string" ? raw.branch_id : "",
    roles: asStringArray(raw.roles),
    permissions: asStringArray(raw.permissions),
    attributes:
      typeof raw.attributes === "object" && raw.attributes !== null
        ? (raw.attributes as Record<string, unknown>)
        : {},
    ...(typeof impersonatedBy === "string" ? { impersonatedBy } : {}),
  };
}
