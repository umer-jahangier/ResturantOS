package io.restaurantos.audit.dto;

import io.restaurantos.audit.entity.AuditEventEntity;

import java.time.Instant;
import java.util.UUID;

/**
 * One audit row as it crosses the wire.
 *
 * <p>A view type rather than the entity, for two reasons. The entity is a JPA class with an
 * {@code @IdClass} and a composite key, and serializing it hands a client the persistence model —
 * which then cannot change without breaking them. More importantly it makes the answer to "what does
 * an audit read disclose" a decision written down in one place rather than a consequence of which
 * fields happen to exist on a table.
 *
 * <p>{@code tenantId} is deliberately absent: the caller can only ever read their own tenant's rows
 * (see {@code AuditQueryController}), so echoing it back adds nothing and invites a client to start
 * treating it as a parameter.
 */
public record AuditEventView(
        Long id,
        Instant occurredAt,
        String action,
        String resourceType,
        String resourceId,
        UUID branchId,
        /** The account that acted. Under impersonation, the account acted AS. */
        UUID userId,
        /** The real platform administrator, when this action was taken under impersonation. */
        UUID impersonatedBy,
        String afterState,
        String metadata
) {

    public static AuditEventView of(AuditEventEntity e) {
        return new AuditEventView(
                e.getId(),
                e.getOccurredAt(),
                e.getAction(),
                e.getResourceType(),
                e.getResourceId(),
                e.getBranchId(),
                e.getUserId(),
                e.getImpersonatedBy(),
                e.getAfterState(),
                e.getMetadata());
    }
}
