package io.restaurantos.platform.service;

import io.restaurantos.platform.dto.AnnouncementDtos.AnnouncementResponse;
import io.restaurantos.platform.dto.AnnouncementDtos.CreateAnnouncementRequest;
import io.restaurantos.platform.dto.AnnouncementDtos.TenantAnnouncement;
import io.restaurantos.platform.entity.AnnouncementAudienceEntity;
import io.restaurantos.platform.entity.AnnouncementAudienceEntity.AudienceType;
import io.restaurantos.platform.entity.AnnouncementEntity;
import io.restaurantos.platform.entity.AnnouncementEntity.AudienceKind;
import io.restaurantos.platform.entity.AnnouncementEntity.Severity;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.repository.AnnouncementAcknowledgementRepository;
import io.restaurantos.platform.repository.AnnouncementAudienceRepository;
import io.restaurantos.platform.repository.AnnouncementRepository;
import io.restaurantos.platform.repository.PlatformUserRepository;
import io.restaurantos.platform.repository.TenantAnalyticsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Announcements: targeting, the delivery bound, and the two properties of the acknowledgement trail
 * that make it evidence rather than decoration.
 */
class AnnouncementServiceTest {

    private AnnouncementRepository announcements;
    private AnnouncementAudienceRepository audiences;
    private AnnouncementAcknowledgementRepository acknowledgements;
    private TenantAnalyticsRepository tenants;
    private PlatformUserRepository platformUsers;
    private AnnouncementService service;

    private final UUID operator = UUID.randomUUID();
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        announcements = mock(AnnouncementRepository.class);
        audiences = mock(AnnouncementAudienceRepository.class);
        acknowledgements = mock(AnnouncementAcknowledgementRepository.class);
        tenants = mock(TenantAnalyticsRepository.class);
        platformUsers = mock(PlatformUserRepository.class);
        when(platformUsers.findById(any())).thenReturn(Optional.empty());
        service = new AnnouncementService(
                announcements, audiences, acknowledgements, tenants, platformUsers);
    }

    @Test
    @DisplayName("a published announcement declares IN_APP as its only delivery channel")
    void deliveryIsInAppAndSaysSo() {
        AnnouncementResponse created = service.create(operator, new CreateAnnouncementRequest(
                "Scheduled maintenance", "We will be upgrading on Sunday.",
                "WARNING", "ALL_TENANTS", null, null, null));

        assertThat(created.deliveryChannels())
                .as("""
                    Nothing in this product can send an email, an SMS or a WhatsApp message: \
                    notification-service is an empty POM module with no source, no route and no \
                    port. A console listing an announcement without saying how it travels invites \
                    an operator to assume it was emailed to every tenant.""")
                .containsExactly("IN_APP");
        assertThat(created.active()).isTrue();
        assertThat(created.endsAt())
                .as("null is a real state — 'until further notice' — and not a missing value")
                .isNull();
    }

    @Test
    @DisplayName("a targeted announcement with no targets is refused, not treated as everybody")
    void targetedAnnouncementWithoutTargetsIsRefused() {
        assertThatThrownBy(() -> service.create(operator, new CreateAnnouncementRequest(
                "Tier notice", "body", "INFO", "TIER", List.of(), null, null)))
                .as("""
                    An empty audience reads either as 'nobody' or as 'everybody', which is exactly \
                    why the caller must not be left to guess. The everybody reading is the one \
                    that cannot be taken back.""")
                .isInstanceOf(IllegalArgumentException.class);

        verify(announcements, never()).save(any());
    }

    @Test
    @DisplayName("targets on an ALL_TENANTS announcement are refused rather than silently dropped")
    void allTenantsWithTargetsIsRefused() {
        assertThatThrownBy(() -> service.create(operator, new CreateAnnouncementRequest(
                "Everyone", "body", "INFO", "ALL_TENANTS", List.of("GROWTH"), null, null)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a window that closes before it opens is refused at write time")
    void invalidWindowIsRefused() {
        Instant start = Instant.parse("2026-07-01T00:00:00Z");
        assertThatThrownBy(() -> service.create(operator, new CreateAnnouncementRequest(
                "Backwards", "body", "INFO", "ALL_TENANTS", null, start, start.minusSeconds(60))))
                .as("it could never match, so it would present as 'the announcement never appeared'")
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a tier-targeted announcement reaches only tenants on that tier")
    void tierTargetingMatchesTheTenantsTier() {
        AnnouncementEntity growthOnly = announcement(AudienceKind.TIER, Severity.INFO);
        AnnouncementEntity everyone = announcement(AudienceKind.ALL_TENANTS, Severity.CRITICAL);

        when(tenants.findTierById(tenantId)).thenReturn(Optional.of(TierType.STARTER));
        when(announcements.findActiveAt(any())).thenReturn(List.of(growthOnly, everyone));
        when(audiences.findByAnnouncementIdIn(any())).thenReturn(List.of(
                audience(growthOnly.getId(), AudienceType.TIER, "GROWTH")));
        when(acknowledgements.findAcknowledgedIds(any(), any())).thenReturn(List.of());

        List<TenantAnnouncement> visible = service.forTenant(tenantId, userId);

        assertThat(visible)
                .as("a STARTER tenant must not be shown a GROWTH-only notice")
                .hasSize(1);
        assertThat(visible.get(0).id()).isEqualTo(everyone.getId());
    }

    @Test
    @DisplayName("the acknowledged flag is per USER, not per tenant")
    void acknowledgementIsPerUser() {
        AnnouncementEntity everyone = announcement(AudienceKind.ALL_TENANTS, Severity.INFO);

        when(tenants.findTierById(tenantId)).thenReturn(Optional.of(TierType.GROWTH));
        when(announcements.findActiveAt(any())).thenReturn(List.of(everyone));
        when(audiences.findByAnnouncementIdIn(any())).thenReturn(List.of());
        when(acknowledgements.findAcknowledgedIds(userId, List.of(everyone.getId())))
                .thenReturn(List.of(everyone.getId()));

        assertThat(service.forTenant(tenantId, userId).get(0).acknowledged()).isTrue();

        when(acknowledgements.findAcknowledgedIds(any(), any())).thenReturn(List.of());
        assertThat(service.forTenant(tenantId, UUID.randomUUID()).get(0).acknowledged())
                .as("""
                    A banner one colleague dismissed is not a banner the next person has seen. \
                    Per-tenant dismissal would hide a critical notice from everyone after the \
                    first reader.""")
                .isFalse();
    }

    @Test
    @DisplayName("an unknown tenant gets an empty list, not a 404 that leaks tenant existence")
    void unknownTenantGetsAnEmptyList() {
        when(tenants.findTierById(any())).thenReturn(Optional.empty());

        assertThat(service.forTenant(UUID.randomUUID(), userId)).isEmpty();
    }

    @Test
    @DisplayName("a repeat acknowledgement is a no-op that keeps the first timestamp")
    void acknowledgementIsIdempotent() {
        AnnouncementEntity announcement = announcement(AudienceKind.ALL_TENANTS, Severity.INFO);
        when(announcements.findById(announcement.getId())).thenReturn(Optional.of(announcement));
        when(acknowledgements.existsById(any())).thenReturn(true);

        boolean recorded = service.acknowledge(announcement.getId(), tenantId, userId);

        assertThat(recorded).isFalse();
        verify(acknowledgements, never()).save(any());
    }

    @Test
    @DisplayName("withdrawal is a revocation and never a delete")
    void revokeDoesNotDelete() {
        AnnouncementEntity announcement = announcement(AudienceKind.ALL_TENANTS, Severity.INFO);
        when(announcements.findById(announcement.getId())).thenReturn(Optional.of(announcement));
        when(audiences.findByAnnouncementId(announcement.getId())).thenReturn(List.of());
        when(acknowledgements.countByAnnouncementId(announcement.getId())).thenReturn(3L);

        AnnouncementResponse revoked = service.revoke(announcement.getId(), operator, "sent in error");

        assertThat(revoked.revokedAt()).isNotNull();
        assertThat(revoked.active()).isFalse();
        assertThat(revoked.acknowledgements())
                .as("""
                    The trail survives the withdrawal. An acknowledgement of a message nobody can \
                    read afterwards is not evidence of anything, which is why there is no delete \
                    path here at all.""")
                .isEqualTo(3L);
        verify(announcements, never()).delete(any());
        verify(announcements, never()).deleteById(any());

        Instant first = revoked.revokedAt();
        AnnouncementResponse again = service.revoke(announcement.getId(), operator, "again");
        assertThat(again.revokedAt())
                .as("the first withdrawal is the one that happened")
                .isEqualTo(first);
    }

    // ── fixtures ──────────────────────────────────────────────────────────────

    private AnnouncementEntity announcement(AudienceKind kind, Severity severity) {
        AnnouncementEntity entity = new AnnouncementEntity();
        entity.setTitle("t");
        entity.setBody("b");
        entity.setSeverity(severity);
        entity.setAudienceKind(kind);
        entity.setStartsAt(Instant.now().minusSeconds(60));
        entity.setCreatedBy(operator);
        return entity;
    }

    private static AnnouncementAudienceEntity audience(UUID announcementId,
                                                       AudienceType type,
                                                       String value) {
        AnnouncementAudienceEntity entity = new AnnouncementAudienceEntity();
        entity.setAnnouncementId(announcementId);
        entity.setAudienceType(type);
        entity.setAudienceValue(value);
        return entity;
    }
}
