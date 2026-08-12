package io.restaurantos.nlq.settings;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * Append-only record of who changed a tenant's AI credential, and when.
 *
 * <p>{@code nlq_query_log} answers "what did this tenant ask"; nothing answered "who swapped the
 * API key last Tuesday", which is the question actually asked after a billing surprise or a
 * suspected compromise.
 *
 * <p><b>CARRIES NO KEY MATERIAL — not the key, not the fingerprint, not even the last 4.</b> An
 * audit table is the classic place a credential ends up: long-lived, widely readable, and nobody
 * re-reads its columns after the review that added them. The action and the actor are the whole
 * point; anything key-shaped in here is a defect, not extra context.
 */
@Entity
@Table(name = "nlq_ai_settings_events")
public class AiSettingsEventEntity {

    public enum Action {
        /** First key stored for this tenant. */
        KEY_SET,
        /** An existing key replaced with a different one. */
        KEY_ROTATED,
        /** Key removed; the tenant reverted to the platform key. */
        KEY_CLEARED,
        /** The provider refused the stored key at query time (system-generated, no actor). */
        KEY_REJECTED
    }

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id = UUID.randomUUID();

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    /** Null for system-generated events such as {@link Action#KEY_REJECTED}. */
    @Column(name = "actor_user_id")
    private UUID actorUserId;

    @Enumerated(EnumType.STRING)
    @Column(name = "action", nullable = false, length = 24)
    private Action action;

    @Column(name = "at", nullable = false)
    private Instant at = Instant.now();

    protected AiSettingsEventEntity() {
        // JPA
    }

    public AiSettingsEventEntity(UUID tenantId, UUID actorUserId, Action action, Instant at) {
        this.tenantId = tenantId;
        this.actorUserId = actorUserId;
        this.action = action;
        this.at = at;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getActorUserId() {
        return actorUserId;
    }

    public Action getAction() {
        return action;
    }

    public Instant getAt() {
        return at;
    }
}
