package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * One targeted tier or tenant for an announcement.
 *
 * <p>A child table rather than an array column because the tenant-facing read filters on it on
 * every page load, and because the reverse question — "which announcements target ENTERPRISE" — is
 * then an ordinary indexed lookup rather than an unnest.
 *
 * <p>{@link #audienceValue} is text for both kinds: a tier name and a tenant UUID are different
 * types, and a nullable column per type would permit a row that names neither.
 */
@Entity
@Table(name = "announcement_audience")
@Getter
@Setter
public class AnnouncementAudienceEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id = UUID.randomUUID();

    @Column(name = "announcement_id", nullable = false)
    private UUID announcementId;

    @Enumerated(EnumType.STRING)
    @Column(name = "audience_type", nullable = false, length = 20)
    private AudienceType audienceType;

    @Column(name = "audience_value", nullable = false, length = 100)
    private String audienceValue;

    public enum AudienceType { TIER, TENANT }
}
