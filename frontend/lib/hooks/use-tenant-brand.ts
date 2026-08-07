"use client";

import { useQuery } from "@tanstack/react-query";

import { useSessionStore } from "@/lib/auth/session";
import { env } from "@/lib/env";

const FALLBACK_BRAND = "RestaurantOS";

/**
 * The signed-in tenant's display brand (e.g. "Floating Terrace") for the app shell.
 *
 * <h3>GA-032 — what this used to do</h3>
 *
 * It resolved the brand from `env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG`: a **build-time** environment
 * variable, identical for every user of every tenant on the deployment. Live, signed in as
 * `owner@terrace.local`, the sidebar read **"Lume"** while the branch chip immediately beside it
 * read "Floating Terrace HQ" — the shell naming one restaurant and its own branch selector naming
 * another, on every screen. It also fired `GET /api/v1/auth/tenants/test` on every navigation,
 * because the deployed value of that variable was `'test'`.
 *
 * A multi-tenant product that displays a tenant name must read it from the SESSION. There is no
 * defensible fallback here: any static brand is, for all but one tenant, someone else's name.
 *
 * <h3>How it reads the session now</h3>
 *
 * The access token carries `tenant_id` (and nothing else that identifies the tenant), so this
 * resolves that id through the public branding endpoint — which 14b taught to accept an id as
 * well as a slug, precisely so the shell has a session-derived source. `tenantId` is null for a
 * PLATFORM (SuperAdmin) session, which belongs to no tenant; that case correctly falls through to
 * "RestaurantOS", which for the control plane is the truthful name rather than a stand-in.
 *
 * The query key is the tenant id, so switching accounts re-resolves instead of serving the
 * previous tenant's name from cache. `staleTime: Infinity` is safe because a brand cannot change
 * within a session without a rebrand and a reload.
 */
export function useTenantBrand(): string {
  const session = useSessionStore((state) => state.session);
  const tenantId = session?.tenantId ?? null;

  const { data } = useQuery({
    queryKey: ["tenant-brand", tenantId],
    enabled: Boolean(tenantId),
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(
        `${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/auth/tenants/${encodeURIComponent(tenantId!)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return FALLBACK_BRAND;
      const payload = (await res.json()) as { data?: { name?: string } };
      return payload.data?.name?.trim() || FALLBACK_BRAND;
    },
  });

  return data ?? FALLBACK_BRAND;
}
