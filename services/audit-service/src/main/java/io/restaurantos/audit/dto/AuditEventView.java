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
 *
 * <h2>The names are decoration and the ids are the record</h2>
 *
 * <p>{@code userName} and {@code impersonatedByName} are resolved at read time from auth-service
 * and are null whenever the directory could not answer — a deleted account, an unreachable service.
 * They are additions to {@code userId}/{@code impersonatedBy}, never replacements: a name stored on
 * an audit row would record what someone was called on the day, and a name that failed to resolve
 * must degrade to an id rather than to "nobody".
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
        /** That account's display name, or null when it could not be resolved. Never a placeholder. */
        String userName,
        /** The real platform administrator, when this action was taken under impersonation. */
        UUID impersonatedBy,
        /** That administrator's display name, or null when it could not be resolved. */
        String impersonatedByName,
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
                null,
                e.getImpersonatedBy(),
                null,
                e.getAfterState(),
                e.getMetadata());
    }

    /** The same row with whatever the actor directory could resolve attached. */
    public AuditEventView withActorNames(String resolvedUserName, String resolvedImpersonatorName) {
        return new AuditEventView(id, occurredAt, action, resourceType, resourceId, branchId,
                userId, resolvedUserName, impersonatedBy, resolvedImpersonatorName,
                afterState, metadata);
    }
}
