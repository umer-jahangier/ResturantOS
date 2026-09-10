"use client";

import { useQuery } from "@tanstack/react-query";

import { DEFAULT_TIME_ZONE } from "@/lib/format/locale";
import {
  PlatformAuditRepository,
  type AuditQuery,
} from "@/lib/repositories/platform-audit.repository";
import type {
  AuditCoverage,
  AuditView,
  PlatformAuditPage,
} from "@/lib/models/platform-audit.model";

/**
 * Layer-3 hooks for the platform audit surface. Reads only — there is no mutation to write.
 *
 * <h3>Why there is no `refetchInterval` on any of these</h3>
 *
 * An audit trail is read to answer a question, not watched. A poll here would re-run the
 * cross-tenant fan-out — one query per tenant, every interval — for a reader who has walked away,
 * and the rows it returned would still be the same rows. The screen offers a refresh instead.
 *
 * <h3>Why `staleTime` is short anyway</h3>
 *
 * Thirty seconds, matching `use-platform-impersonations.ts`. An operator investigating an incident
 * is acting on the trail WHILE it is being written to; a cache measured in minutes would answer
 * "did that action get recorded?" with a snapshot taken before the action happened, which is the
 * one question this screen must not get wrong.
 */
export const platformAuditKeys = {
  all: () => ["platform", "audit"] as const,
  search: (query: Omit<AuditQuery, "zone">) => ["platform", "audit", "search", query] as const,
  coverage: () => ["platform", "audit", "coverage"] as const,
};

const STALE_MS = 30_000;

export interface PlatformAuditFilters {
  view: AuditView;
  tenantId?: string;
  actorId?: string;
  action?: string[];
  resourceType?: string;
  failedOnly?: boolean;
  from?: string;
  to?: string;
  page: number;
  size?: number;
}

/**
 * One page of the cross-tenant trail.
 *
 * <p>`retry: false`. Beyond the 403 argument that applies across this plane, there is one specific
 * to this endpoint: audit-service answering with a body the platform client cannot read is a 500
 * raised deliberately — `PlatformAuditTrailService` refuses to serve an unreadable response as an
 * empty page — and retrying that produces the same 500 three times while the reader watches a
 * spinner. The error is the finding.
 *
 * <p>`placeholderData` is deliberately NOT set. Keeping the previous page's rows on screen while a
 * new filter loads is a pleasant pattern on a product catalogue and a dangerous one here: the rows
 * under a filter would be the rows from a DIFFERENT filter, and on an audit screen a reader has no
 * way to tell. The skeleton is the honest intermediate state.
 */
export function usePlatformAuditSearch(filters: PlatformAuditFilters) {
  return useQuery<PlatformAuditPage>({
    queryKey: platformAuditKeys.search(filters),
    queryFn: () => PlatformAuditRepository.search({ ...filters, zone: DEFAULT_TIME_ZONE }),
    staleTime: STALE_MS,
    retry: false,
  });
}

/**
 * What the trail covers and, explicitly, what it does not.
 *
 * <p>A long `staleTime` because this is a description of the PRODUCT, not of its data: it changes
 * when a service starts or stops publishing an event type, which is a deployment, not a minute.
 * It is fetched on every visit rather than hard-coded here because a console restating the
 * backend's caveats in its own words is a console whose caveats can go stale silently — and these
 * particular caveats are the ones that stop a reader misreading an empty grid.
 */
export function usePlatformAuditCoverage() {
  return useQuery<AuditCoverage>({
    queryKey: platformAuditKeys.coverage(),
    queryFn: () => PlatformAuditRepository.getCoverage(),
    staleTime: 600_000,
    retry: false,
  });
}
