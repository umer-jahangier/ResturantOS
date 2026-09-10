"use client";

import { useQuery } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import { platformKeys } from "@/lib/hooks/use-platform-tenants";
import type { TenantUserPage } from "@/lib/models/platform.model";

/**
 * One tenant's users, read from the platform plane.
 *
 * <h3>Why this is the per-tenant endpoint and not the fleet-wide one</h3>
 *
 * There is no cross-tenant user query anywhere in this product. `auth_db.users` is FORCE row-level
 * security on `app.current_tenant_id`, platform_db holds zero grants in auth_db and has neither
 * `postgres_fdw` nor `dblink`, and the only door — `GET /internal/auth/users` — requires an
 * `X-Tenant-Id` and returns one tenant's page. `GET /api/v1/platform/users` therefore fans out one
 * HTTP call per tenant; with the tenant already known, this is a single call and cannot be
 * partially wrong for the reason a fan-out can.
 *
 * The response still carries its `scan` block, and the screen still renders it. A tenant whose
 * users could not be read at all comes back as an unreachable entry rather than as an empty list,
 * and the two must not look the same on a console where "this restaurant has no staff" is a
 * conclusion somebody would act on.
 *
 * `retry: false` for the same reason as the tenant list: a 403 here means the principal is not a
 * SuperAdmin, and retrying an authorization refusal only delays the honest answer behind a spinner.
 */
export function useTenantUsers(tenantId: string, search: string) {
  return useQuery<TenantUserPage>({
    // The search term is part of the key: it is pushed to auth-service's own query rather than
    // filtered here, because a page filtered after the fact carries a `totalCount` describing a
    // different set from its own rows.
    queryKey: [...platformKeys.tenantUsers(tenantId), search],
    queryFn: () =>
      PlatformRepository.listTenantUsers(tenantId, {
        ...(search.trim() ? { search: search.trim() } : {}),
        size: 200,
      }),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    retry: false,
  });
}
