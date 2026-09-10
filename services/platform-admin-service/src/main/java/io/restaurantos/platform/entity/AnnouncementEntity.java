package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A platform announcement — an IN-APP banner the SuperAdmin publishes to tenants.
 *
 * <p><b>In-app only.</b> Nothing sends this anywhere: notification-service is an empty POM module
 * with no source files, no route and no port, which is also why self-service forgot-password ships
 * disabled. A tenant sees an announcement because their UI read it, and for no other reason.
 *
 * <p>Withdrawal is {@link #revokedAt}, never a delete. An announcement that was shown and then
 * vanished takes the meaning of its acknowledgement trail with it — an acknowledgement of a message
 * nobody can read afterwards is not evidence of anything.
 */
@Entity
@Table(name = "announcements")
@Getter
@Setter
public class AnnouncementEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id = UUID.randomUUID();

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "body", nullable = false, columnDefinition = "text")
    private String body;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", nullable = false, length = 20)
    private Severity severity;

    @Enumerated(EnumType.STRING)
    @Column(name = "audience_kind", nullable = false, length = 20)
    private AudienceKind audienceKind;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    /**
     * Null is a REAL STATE — "no end date" — and not a missing value.
     *
     * <p>Exactly the distinction {@code TenantEntity.renews_at} documents: a screen that renders
     * null as an empty date cell has turned a deliberate decision into what looks like missing data.
     */
    @Column(name = "ends_at")
    private Instant endsAt;

    /** {@code platform_users.id}, taken from the verified token's {@code sub} and never from a body. */
    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoked_by")
    private UUID revokedBy;

    /** How loudly a tenant's UI should render it. Not an entitlement and not a delivery channel. */
    public enum Severity { INFO, WARNING, CRITICAL }

    /**
     * Who it is for.
     *
     * <p>{@code TIER} and {@code TENANT} name their targets in {@code announcement_audience}, so
     * "the GROWTH and ENTERPRISE tiers" is one announcement rather than two.
     */
    public enum AudienceKind { ALL_TENANTS, TIER, TENANT }

    /** Live at {@code now}: published, not revoked, and inside its window. */
    public boolean isActiveAt(Instant now) {
        if (revokedAt != null) {
            return false;
        }
        if (startsAt != null && startsAt.isAfter(now)) {
            return false;
        }
        return endsAt == null || endsAt.isAfter(now);
    }
}
