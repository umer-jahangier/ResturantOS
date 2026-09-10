package io.restaurantos.audit.dto;

import io.restaurantos.audit.entity.AuditEventEntity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The wire contract for the platform-tier, cross-tenant audit read.
 *
 * <h2>Why this is a different shape from {@link AuditEventView}</h2>
 *
 * <p>{@code AuditEventView} deliberately omits {@code tenantId} — a tenant reading their own log
 * can only ever see one tenant, so echoing it back would invite a client to start treating it as a
 * parameter. The platform plane is the opposite case: it reads MANY tenants in one response, so a
 * row without its tenant is unattributable. Hence a separate record rather than a nullable field on
 * the tenant-facing one.
 *
 * <h2>Why the caller names the tenants</h2>
 *
 * <p>{@code audit_events} and every one of its partitions are {@code ENABLE} + {@code FORCE ROW
 * LEVEL SECURITY} on {@code app.current_tenant_id} (changeset 030), and {@code audit_writer} is
 * {@code NOSUPERUSER NOBYPASSRLS}. There is no "all tenants" query and this service is not the place
 * to invent one: a bypass role or a SECURITY DEFINER reader would be a second, weaker copy of the
 * isolation control, owned by whichever role happened to run the migration. So the platform names
 * the tenants it wants and this service reads them one at a time with the GUC set to each — every
 * row that comes back was returned by a policy-checked query, and the cross-tenant view is
 * assembled in application memory rather than by weakening the database.
 *
 * <p>audit-service holds no tenant registry, which is why the list is a parameter rather than
 * something derived here. {@code platform_db.tenants} is the registry, and it lives in the caller.
 */
public final class PlatformAuditDtos {

    private PlatformAuditDtos() {}

    /**
     * A cross-tenant audit query. Sent as a POST body because the tenant list can run to hundreds
     * of UUIDs and a query string cannot carry that; <b>it remains a read</b> — this service has no
     * update or delete surface anywhere, {@code audit_writer} holds no UPDATE/DELETE grant, and a
     * trigger raises on either. See {@code AuditImmutabilityIT}.
     *
     * @param tenantIds    the scope. Required and non-empty: an omitted scope is a refusal, never
     *                     "everything", because the one thing this endpoint must not have is a
     *                     default that reads more than the caller asked for.
     * @param actions      optional action allow-list (e.g. the two login actions). Empty = no
     *                     action filter.
     * @param resourceType optional.
     * @param userId       optional actor filter. Matches {@code user_id} OR {@code impersonated_by}
     *                     — an operator asking "what did this administrator do" means both the
     *                     actions taken as themselves and the actions taken while impersonating.
     * @param from         inclusive lower bound; null means {@link Instant#EPOCH}.
     * @param to           inclusive upper bound; null means now.
     * @param page         0-based.
     * @param size         page size, capped by the service.
     * @param includeFacets when true, also return the distinct action names present in the window
     *                     across the named tenants, so a filter dropdown offers only choices that
     *                     can return rows.
     */
    public record PlatformAuditSearchRequest(
            List<UUID> tenantIds,
            List<String> actions,
            String resourceType,
            UUID userId,
            Instant from,
            Instant to,
            Integer page,
            Integer size,
            Boolean includeFacets
    ) {}

    /**
     * One audit row, attributed to its tenant.
     *
     * <p>No {@code userName} and no {@code impersonatedByName}. The tenant-facing view resolves
     * those from auth-service per tenant; doing it here would be one directory call per tenant per
     * page, and the platform console has no tenant token to resolve names with anyway. The same
     * decision {@code PlatformDtos.ImpersonationRecord} already made for {@code targetUserId}: the
     * id is what is honestly known, and an unresolved name must degrade to an id rather than to a
     * placeholder that reads like a person.
     */
    public record PlatformAuditEventView(
            Long id,
            UUID tenantId,
            Instant occurredAt,
            String action,
            String resourceType,
            String resourceId,
            UUID branchId,
            UUID userId,
            UUID impersonatedBy,
            String ipAddress,
            String userAgent,
            String metadata
    ) {
        public static PlatformAuditEventView of(AuditEventEntity e) {
            return new PlatformAuditEventView(
                    e.getId(), e.getTenantId(), e.getOccurredAt(), e.getAction(),
                    e.getResourceType(), e.getResourceId(), e.getBranchId(), e.getUserId(),
                    e.getImpersonatedBy(), e.getIpAddress(), e.getUserAgent(), e.getMetadata());
        }
    }

    /** One tenant this read could not complete, and why. Never silently dropped from the total. */
    public record TenantReadFailure(UUID tenantId, String reason) {}

    /**
     * The merged result, with the honesty of the merge stated in the body rather than assumed.
     *
     * @param events            the requested page, newest first, merged across every tenant that
     *                          answered.
     * @param totalCount        the exact number of matching rows across the tenants that answered.
     * @param totalCountComplete false when at least one named tenant failed to read — the total is
     *                          then a lower bound and a screen must say so rather than print it as
     *                          a fact. This is the {@code UsageMeter.unreadable} posture: a figure
     *                          that could not be fully obtained is not the same as a figure.
     * @param tenantsRead       the tenants that actually answered.
     * @param tenantsFailed     the tenants that did not, with the reason.
     * @param actionsPresent    facets, or null when they were not requested. Null means "not asked
     *                          for"; an empty list means "asked for, and there are none".
     * @param scanTruncated     true when the requested page lies deeper than the per-tenant scan
     *                          budget, in which case the merge across tenants can no longer be
     *                          proven exact and the caller is told so instead of being handed a
     *                          plausible page.
     */
    public record PlatformAuditSearchResponse(
            List<PlatformAuditEventView> events,
            long totalCount,
            boolean totalCountComplete,
            List<UUID> tenantsRead,
            List<TenantReadFailure> tenantsFailed,
            Instant from,
            Instant to,
            int page,
            int size,
            List<String> actionsPresent,
            boolean scanTruncated
    ) {}
}
