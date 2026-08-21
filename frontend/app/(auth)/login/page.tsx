import { headers } from "next/headers";

import { resolveTenantSlug } from "@/lib/auth/tenant-slug";
import { sanitizeReturnPath } from "@/lib/auth/step-up";
import { resolveTenantBrand } from "@/lib/server/resolve-tenant-brand";
import { LoginForm } from "@/components/auth/login-form";

// URL: /login (the (auth) route group adds no path segment).
// Server component: resolves the tenant slug from the subdomain / `?tenant=`
// (awaiting `searchParams` + `headers()` per Next 16) and hands it to the form.
interface LoginPageProps {
  searchParams: Promise<{ tenant?: string; reason?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const headerList = await headers();
  const host = headerList.get("host");

  // NEXT_PUBLIC_APP_HOSTS lists this deployment's OWN hostnames so they are not
  // mistaken for tenant subdomains; NEXT_PUBLIC_DEFAULT_TENANT_SLUG is the
  // fallback used when the host carries no tenant (a single-tenant demo site).
  const appHosts = (process.env.NEXT_PUBLIC_APP_HOSTS ?? "").split(",").filter(Boolean);
  const tenantSlug =
    resolveTenantSlug({ host, searchParam: params.tenant, appHosts }) ||
    process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ||
    null;
  const tenantBrandName = tenantSlug ? await resolveTenantBrand(tenantSlug) : null;

  return (
    <LoginForm
      tenantSlug={tenantSlug}
      tenantBrandName={tenantBrandName}
      reason={params.reason}
      // Sanitised here rather than at the redirect: `next` is whatever the URL said, so an
      // off-site value must never reach the router. See sanitizeReturnPath.
      returnPath={sanitizeReturnPath(params.next)}
    />
  );
}
