package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * One person, having seen one announcement, once.
 *
 * <p>The composite key IS the idempotency. A second acknowledgement from the same account is a
 * no-op and the FIRST timestamp survives, because "when did they first see this" is the question
 * the trail exists to answer and a re-render must not move it.
 *
 * <p>{@link #tenantId} is stored rather than derived: {@code user_id} belongs to {@code auth_db},
 * which {@code platform_db} cannot reach at all — no FDW, no dblink, zero grants — so without the
 * tenant on the row, "which tenants have acknowledged this" has no answer.
 */
@Entity
@Table(name = "announcement_acknowledgements")
@IdClass(AnnouncementAcknowledgementEntity.AckKey.class)
@Getter
@Setter
public class AnnouncementAcknowledgementEntity {

    @Id
    @Column(name = "announcement_id", nullable = false, updatable = false)
    private UUID announcementId;

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "acknowledged_at", nullable = false)
    private Instant acknowledgedAt = Instant.now();

    /** {@code (announcementId, userId)}. */
    public static class AckKey implements Serializable {
        private UUID announcementId;
        private UUID userId;

        public AckKey() {}

        public AckKey(UUID announcementId, UUID userId) {
            this.announcementId = announcementId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) return true;
            if (!(other instanceof AckKey key)) return false;
            return Objects.equals(announcementId, key.announcementId)
                && Objects.equals(userId, key.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(announcementId, userId);
        }
    }
}
