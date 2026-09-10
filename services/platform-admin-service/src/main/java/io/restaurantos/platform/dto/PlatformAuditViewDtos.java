package io.restaurantos.platform.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The SuperAdmin console's view of the cross-tenant audit trail.
 *
 * <h2>Read-only, and structurally so</h2>
 *
 * <p>There is no create, update or delete shape in this file and no endpoint that consumes one.
 * That is not restraint on the controller's part — {@code audit_events} is append-only at three
 * independent layers: {@code audit_writer} holds INSERT and SELECT and no more, a PostgreSQL
 * trigger raises on UPDATE and DELETE ({@code 011-audit-immutability-trigger.xml}), and
 * audit-service exposes no mutating handler on any path. An audit log a platform administrator can
 * edit is not an audit log, and here that property belongs to the database rather than to whoever
 * writes the next controller.
 *
 * <h2>Ids, not names</h2>
 *
 * <p>{@code userId} and {@code impersonatedBy} are returned as UUIDs and are NOT resolved to
 * people. The tenant-facing audit screen resolves them through auth-service using the reader's own
 * tenant token; the platform plane has no tenant token, and resolving names would be one directory
 * call per tenant per page. {@code PlatformDtos.ImpersonationRecord} made the same call for
 * {@code targetUserId} and for the same reason: the id is what is honestly known, and a name that
 * failed to resolve must degrade to an id rather than to a placeholder that reads like a person.
 *
 * <p>The tenant, by contrast, IS resolved — to slug and brand name — because {@code platform_db}
 * holds the tenant registry itself and a cross-tenant row without an attributable tenant is
 * unreadable.
 */
public final class PlatformAuditViewDtos {

    private PlatformAuditViewDtos() {}

    /** One audit row, attributed to a tenant this console can name. */
    public record PlatformAuditEvent(
            Long id,
            UUID tenantId,
            String tenantSlug,
            String tenantBrandName,
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
    ) {}

    /** A tenant whose log could not be read on this request. Named, never silently dropped. */
    public record TenantReadFailure(UUID tenantId, String tenantSlug, String reason) {}

    /**
     * A page of the cross-tenant trail, carrying the limits of its own construction.
     *
     * @param totalCountComplete false when at least one tenant in scope failed to read. The total is
     *                           then a LOWER BOUND. A screen that prints it as a fact has told the
     *                           reader their trail is smaller than it is, which on an audit surface
     *                           is the most damaging direction to be wrong in.
     * @param tenantsInScope     how many tenants the query addressed.
     * @param tenantsRead        how many answered.
     * @param scanTruncated      true when the requested page is deeper than the per-tenant scan
     *                           budget, at which point the cross-tenant merge can no longer be
     *                           proven exact. Reported rather than served silently.
     * @param actionsPresent     the action names that actually occur in this window and scope, for a
     *                           filter control. Null when facets were not requested; empty when
     *                           there are none. A dropdown offering a value that cannot return rows
     *                           reads, on an audit screen, as "your trail has a hole in it".
     */
    public record PlatformAuditPage(
            List<PlatformAuditEvent> events,
            long totalCount,
            boolean totalCountComplete,
            int tenantsInScope,
            int tenantsRead,
            List<TenantReadFailure> tenantsFailed,
            Instant from,
            Instant to,
            String zone,
            int page,
            int size,
            List<String> actionsPresent,
            boolean scanTruncated
    ) {}

    /**
     * What this platform's audit trail does and does not cover.
     *
     * <p>This exists as an endpoint rather than as documentation because the gaps are the kind a
     * console will otherwise paper over. A "SuperAdmin activity log" tile drawn from
     * {@code audit_events} would be empty and look like a quiet week, when the truth is that
     * platform logins are not written there at all.
     *
     * @param captured   what genuinely lands in {@code audit_events}, in words.
     * @param notCaptured what does not, with the reason. Each entry is a fact about the product, not
     *                   a TODO.
     * @param retention  what the retention policy actually is, measured from the changelog rather
     *                   than promised.
     */
    public record AuditCoverage(
            Instant generatedAt,
            List<CoverageItem> captured,
            List<CoverageItem> notCaptured,
            String retention,
            String immutability
    ) {}

    public record CoverageItem(String subject, String detail) {}
}
