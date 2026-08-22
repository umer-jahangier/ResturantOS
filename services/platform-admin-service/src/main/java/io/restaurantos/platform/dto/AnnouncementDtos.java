package io.restaurantos.platform.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Announcements — the SuperAdmin write surface, the tenant-facing read, and the acknowledgement
 * trail.
 *
 * <p><b>In-app only.</b> Every record here describes a banner a tenant's own UI reads. Nothing in
 * this product can send an email, an SMS or a WhatsApp message: notification-service is an empty
 * POM module with no source, no route and no port. {@link AnnouncementResponse#deliveryChannels}
 * says so on the wire, because a console that lists an announcement without saying how it travels
 * invites an operator to assume it was emailed.
 */
public final class AnnouncementDtos {

    private AnnouncementDtos() {}

    /**
     * @param severity     INFO, WARNING or CRITICAL.
     * @param audienceKind ALL_TENANTS, TIER or TENANT.
     * @param audience     tier names or tenant ids, required for TIER and TENANT and refused for
     *                     ALL_TENANTS. Refused rather than ignored: a targeted announcement whose
     *                     targets were silently dropped is one that goes to everybody, which is the
     *                     failure that cannot be taken back.
     * @param startsAt     null means "now". An explicit past instant is accepted — an announcement
     *                     about something that already happened is a legitimate thing to publish.
     * @param endsAt       null means "until further notice", a real state and not a missing value.
     */
    public record CreateAnnouncementRequest(
            @NotBlank String title,
            @NotBlank String body,
            @NotNull String severity,
            @NotNull String audienceKind,
            List<String> audience,
            Instant startsAt,
            Instant endsAt
    ) {}

    /** A mandatory reason, for the same purpose it is mandatory on impersonation and password reset. */
    public record RevokeAnnouncementRequest(String reason) {}

    /**
     * One announcement as the SuperAdmin console reads it.
     *
     * @param active            evaluated at {@code generatedAt}, so a console does not re-derive it
     *                          from three fields and disagree.
     * @param acknowledgements  how many people have acknowledged it. A real count, and zero really
     *                          means zero — this is a table with a writer, unlike most meters in
     *                          this service.
     * @param deliveryChannels  always exactly {@code ["IN_APP"]}. Present so the absence of email
     *                          and SMS is a field a screen can render rather than a fact it has to
     *                          know.
     */
    public record AnnouncementResponse(
            UUID id,
            String title,
            String body,
            String severity,
            String audienceKind,
            List<String> audience,
            Instant startsAt,
            Instant endsAt,
            boolean active,
            UUID createdBy,
            String createdByEmail,
            Instant createdAt,
            Instant revokedAt,
            UUID revokedBy,
            long acknowledgements,
            List<String> deliveryChannels
    ) {}

    /**
     * One acknowledgement.
     *
     * <p>{@code userId} is NOT resolved to a name. {@code platform_db} cannot reach {@code auth_db}
     * — no FDW, no dblink, zero grants — so a name would be one cross-service call per row. The
     * same decision {@code PlatformDtos.ImpersonationRecord} makes for {@code targetUserId}: the id
     * is what is honestly known.
     */
    public record AcknowledgementRecord(
            UUID announcementId,
            UUID tenantId,
            String tenantSlug,
            UUID userId,
            Instant acknowledgedAt
    ) {}

    /**
     * The reach of one announcement.
     *
     * @param tenantsReached   how many DISTINCT tenants have at least one acknowledgement.
     * @param tenantsTargeted  how many tenants the audience actually resolves to, computed from the
     *                         tenant registry at read time.
     * @param coverageKnown    false when the target count could not be established. An
     *                         acknowledgement rate whose denominator is a guess is not a rate.
     */
    public record AnnouncementReach(
            UUID announcementId,
            long acknowledgements,
            long tenantsReached,
            long tenantsTargeted,
            boolean coverageKnown,
            List<AcknowledgementRecord> recent
    ) {}

    /**
     * The tenant-facing view: what one user of one tenant should currently be shown.
     *
     * @param acknowledged whether THIS user has acknowledged it. Per-user, not per-tenant: a banner
     *                     one colleague dismissed is not a banner the next person has seen.
     */
    public record TenantAnnouncement(
            UUID id,
            String title,
            String body,
            String severity,
            Instant startsAt,
            Instant endsAt,
            boolean acknowledged
    ) {}

    /** {@code {tenantId, userId}} — the acknowledging party, supplied by the calling service. */
    public record AcknowledgeRequest(@NotNull UUID tenantId, @NotNull UUID userId) {}
}
