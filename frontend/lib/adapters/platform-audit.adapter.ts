import type {
  ApiAuditCoverage,
  ApiPlatformAuditEvent,
  ApiPlatformAuditPage,
} from "@/lib/api-client/schemas/platform-audit.schema";
import type {
  AuditCoverage,
  PlatformAuditEvent,
  PlatformAuditPage,
} from "@/lib/models/platform-audit.model";

// Layer-2b adapters for the cross-tenant audit trail.
//
// The provenance fields — tenantsInScope, tenantsRead, tenantsFailed, totalCountComplete,
// scanTruncated — are carried through UNCHANGED and are never folded into a summary boolean here.
// They are the evidence `auditVerdict()` reasons over, and a layer that pre-digests them into
// "ok / not ok" destroys the distinction the whole screen is built on.

function adaptEvent(api: ApiPlatformAuditEvent): PlatformAuditEvent {
  return {
    id: api.id,
    tenantId: api.tenantId,
    tenantSlug: api.tenantSlug,
    tenantBrandName: api.tenantBrandName,
    occurredAt: new Date(api.occurredAt),
    action: api.action,
    resourceType: api.resourceType,
    resourceId: api.resourceId,
    branchId: api.branchId,
    userId: api.userId,
    impersonatedBy: api.impersonatedBy,
    ipAddress: api.ipAddress,
    userAgent: api.userAgent,
    metadata: api.metadata,
  };
}

export function adaptPlatformAuditPage(api: ApiPlatformAuditPage): PlatformAuditPage {
  return {
    events: api.events.map(adaptEvent),
    totalCount: api.totalCount,
    totalCountComplete: api.totalCountComplete,
    tenantsInScope: api.tenantsInScope,
    tenantsRead: api.tenantsRead,
    tenantsFailed: api.tenantsFailed,
    from: new Date(api.from),
    to: new Date(api.to),
    zone: api.zone,
    page: api.page,
    size: api.size,
    // Null and empty are NOT merged. Null is "facets were not requested"; empty is "this window
    // and scope contain no actions at all" — which, on this screen, is itself a finding.
    actionsPresent: api.actionsPresent,
    scanTruncated: api.scanTruncated,
  };
}

export function adaptAuditCoverage(api: ApiAuditCoverage): AuditCoverage {
  return {
    generatedAt: new Date(api.generatedAt),
    captured: api.captured,
    notCaptured: api.notCaptured,
    retention: api.retention,
    immutability: api.immutability,
  };
}
