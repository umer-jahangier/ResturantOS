"use client";

import { useQuery } from "@tanstack/react-query";

import { env } from "@/lib/env";

const FALLBACK_BRAND = "RestaurantOS";

/**
 * Resolve the tenant's display brand (e.g. "Lume") for the app shell.
 *
 * The access token only carries `tenant_id`, not the brand name, so we resolve it
 * from the public branding endpoint using the configured default tenant slug. This
 * keeps the shell consistent with the branded login ("Sign in to <brand>"). Falls
 * back to "RestaurantOS" when no default slug is set or the lookup fails, so the
 * shell always renders something sensible.
 */
export function useTenantBrand(): string {
  const slug = env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG?.trim();

  const { data } = useQuery({
    queryKey: ["tenant-brand", slug],
    enabled: Boolean(slug),
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(
        `${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/auth/tenants/${encodeURIComponent(slug!)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return FALLBACK_BRAND;
      const payload = (await res.json()) as { data?: { name?: string } };
      return payload.data?.name?.trim() || FALLBACK_BRAND;
    },
  });

  return data ?? FALLBACK_BRAND;
}
