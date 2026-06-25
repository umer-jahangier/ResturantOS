import { headers } from "next/headers";

import { resolveTenantSlug } from "@/lib/auth/tenant-slug";
import { LoginForm } from "@/components/auth/login-form";

// URL: /login (the (auth) route group adds no path segment).
// Server component: resolves the tenant slug from the subdomain / `?tenant=`
// (awaiting `searchParams` + `headers()` per Next 16) and hands it to the form.
interface LoginPageProps {
  searchParams: Promise<{ tenant?: string; reason?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const headerList = await headers();
  const host = headerList.get("host");

  const tenantSlug = resolveTenantSlug({ host, searchParam: params.tenant });

  return <LoginForm tenantSlug={tenantSlug} reason={params.reason} />;
}
