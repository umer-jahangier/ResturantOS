"use client";

import { useQuery } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import { platformKeys } from "@/lib/hooks/use-platform-tenants";
import type { OperatorAuditPage } from "@/lib/models/platform.model";

/**
 * What platform operators have done to one tenant.
 *
 * <h3>Why this is not the tenant's audit log, and cannot be</h3>
 *
 * `audit_db.audit_events` is per-tenant with FORCE row-level security on every partition, and a
 * platform token carries no tenant claim — so the tenant-facing audit endpoint refuses it with 401,
 * correctly. This reads `platform_admin_audit` in platform_db instead: the row written in the same
 * transaction as the action it records, by the same service that performed it.
 *
 * That makes it the trail that survives an outbox failure, and the only one that can answer "what
 * has the platform done to this restaurant" for the principal whose behaviour it exists to
 * constrain.
 *
 * <p>It is READ-ONLY and there is no mutation hook beside it. The rows are the evidence for actions
 * taken elsewhere in this console; an endpoint that edited them would defeat the point of writing
 * them.
 */
export function useTenantOperatorAudit(tenantId: string, page: number) {
  return useQuery<OperatorAuditPage>({
    queryKey: platformKeys.operatorAudit(tenantId, page),
    queryFn: () => PlatformRepository.listOperatorAudit({ tenantId, page }),
    enabled: Boolean(tenantId),
    retry: false,
  });
}

/** Filters the platform-wide operator feed accepts. Every one of them is optional. */
export interface OperatorAuditFilters {
  platformUserId?: string;
  tenantId?: string;
  targetUserId?: string;
  /** `YYYY-MM-DD`. An omitted bound reads as "everything", never as "nothing". */
  from?: string;
  to?: string;
  page: number;
}

/**
 * The same trail, across every tenant — *"where has operator X been?"*.
 *
 * <h3>Why this is a separate key namespace from `platformKeys.operatorAudit`</h3>
 *
 * That key is `(tenantId, page)` and is correct for the tenant panel, which has exactly those two
 * axes. This feed has five, and folding them into a two-part key would make two different queries
 * share one cache entry: filter by operator, then by target user, and the second read would be
 * served the first one's rows. On an accountability screen that is not a stale cache, it is a
 * misattribution.
 *
 * <h3>The filter limitation is real, and the screen states it</h3>
 *
 * `PlatformAdminAuditQueryService` applies its filters in PRIORITY order — operator, then tenant,
 * then target user — rather than combining them, matching `ImpersonationQueryService`. So "what
 * did operator X do to tenant Y" is two filters and the backend serves the first. The screen says
 * so rather than offering two controls that quietly ignore one another.
 *
 * <p>Both successes and REFUSALS come back. An operator repeatedly attempting something they are
 * refused is exactly the pattern an abuse review looks for, and a feed of successes cannot show
 * it.
 */
export function usePlatformOperatorAudit(filters: OperatorAuditFilters) {
  return useQuery<OperatorAuditPage>({
    queryKey: ["platform", "operator-audit", "search", filters] as const,
    queryFn: () => PlatformRepository.listOperatorAudit(filters),
    staleTime: 30_000,
    retry: false,
  });
}
