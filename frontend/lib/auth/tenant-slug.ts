// Pure tenant-slug resolution for the login page. Prefers an explicit `?tenant=`
// search param, otherwise falls back to the leftmost subdomain label of the host
// (ignoring `www`, the apex domain, bare `localhost`, and raw IPs). No I/O — kept
// pure so it is trivially unit-testable (FE-04).

export interface ResolveTenantSlugInput {
  /** The `Host` header (may include a port), e.g. `acme.restaurantos.com:3000`. */
  host?: string | null;
  /** The `?tenant=` query param, if present. */
  searchParam?: string | null;
  /**
   * Hostnames belonging to the APPLICATION itself rather than to a tenant.
   *
   * Without this the leftmost-label rule misfires on any deployment shaped
   * <environment>.<company-domain> instead of <tenant>.<app-domain>. Measured
   * live: dev.restaurantos.softxlogic.com resolved to the tenant "dev" and
   * restaurantos.softxlogic.com to "restaurantos". Neither exists, so the login
   * form pre-filled a value that made every sign-in 401 while its own help text
   * called the field optional.
   */
  appHosts?: readonly string[];
}

const IGNORED_LEFTMOST_LABELS = new Set(["www", "localhost"]);

export function resolveTenantSlug({ host, searchParam, appHosts }: ResolveTenantSlugInput): string | null {
  const fromParam = searchParam?.trim();
  if (fromParam) {
    return fromParam;
  }

  if (!host) {
    return null;
  }

  // Strip any port (`host:3000` → `host`).
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname) {
    return null;
  }

  // An application hostname carries no tenant, however many labels it has.
  if (appHosts?.some((h: string) => h.trim().toLowerCase() === hostname)) {
    return null;
  }

  const labels = hostname.split(".");
  const leftmost = labels[0];
  if (!leftmost || IGNORED_LEFTMOST_LABELS.has(leftmost)) {
    return null;
  }

  // A single label (bare `localhost`) or a raw IPv4 has no tenant subdomain.
  if (labels.length < 2 || /^\d+$/.test(leftmost)) {
    return null;
  }

  // Two labels: only `tenant.localhost` carries a slug; an apex like
  // `restaurantos.com` does not.
  if (labels.length === 2) {
    return labels[1] === "localhost" ? leftmost : null;
  }

  // Three or more labels (`acme.restaurantos.com`): leftmost is the slug.
  return leftmost;
}
