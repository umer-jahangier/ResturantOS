package io.restaurantos.platform.service;

import io.restaurantos.platform.dto.AnnouncementDtos.AcknowledgementRecord;
import io.restaurantos.platform.dto.AnnouncementDtos.AnnouncementReach;
import io.restaurantos.platform.dto.AnnouncementDtos.AnnouncementResponse;
import io.restaurantos.platform.dto.AnnouncementDtos.CreateAnnouncementRequest;
import io.restaurantos.platform.dto.AnnouncementDtos.TenantAnnouncement;
import io.restaurantos.platform.entity.AnnouncementAcknowledgementEntity;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Platform announcements: publish, target, withdraw, and record who has seen what.
 *
 * <h2>The delivery bound, stated once and carried on the wire</h2>
 *
 * <p>These are IN-APP banners. Nothing sends them — notification-service is an empty POM module
 * with no source files, no route and no port, which is the same absence that keeps self-service
 * forgot-password disabled and makes the SuperAdmin the delivery channel for a provisioned tenant's
 * temporary password. Every response carries {@code deliveryChannels = ["IN_APP"]} so a console
 * cannot imply an email that was never sent.
 *
 * <h2>Withdrawal is revocation, never deletion</h2>
 *
 * <p>There is no delete path in this service or on its repositories. An announcement that was shown
 * to tenants and then disappeared takes the meaning of its acknowledgement trail with it: an
 * acknowledgement of a message nobody can read afterwards is not evidence of anything. Revoking
 * stops it matching the active window and records when it stopped.
 *
 * <h2>What the acknowledgement count does and does not tell you</h2>
 *
 * <p>It counts people who pressed acknowledge. It does not count people who read it, and it cannot:
 * nothing records an impression. The reach response therefore reports the count and the number of
 * tenants it resolves to, and marks {@code coverageKnown} false when the denominator cannot be
 * established — an acknowledgement rate over a guessed denominator is not a rate.
 */
@Service
public class AnnouncementService {

    private static final Logger log = LoggerFactory.getLogger(AnnouncementService.class);

    /** The only channel that exists in this product. Not a configuration option. */
    private static final List<String> DELIVERY_CHANNELS = List.of("IN_APP");

    /** How many acknowledgements the reach response carries inline before it is a report. */
    private static final int RECENT_ACKNOWLEDGEMENTS = 50;

    private final AnnouncementRepository announcements;
    private final AnnouncementAudienceRepository audiences;
    private final AnnouncementAcknowledgementRepository acknowledgements;
    private final TenantAnalyticsRepository tenants;
    private final PlatformUserRepository platformUsers;

    public AnnouncementService(AnnouncementRepository announcements,
                               AnnouncementAudienceRepository audiences,
                               AnnouncementAcknowledgementRepository acknowledgements,
                               TenantAnalyticsRepository tenants,
                               PlatformUserRepository platformUsers) {
        this.announcements = announcements;
        this.audiences = audiences;
        this.acknowledgements = acknowledgements;
        this.tenants = tenants;
        this.platformUsers = platformUsers;
    }

    // ── SuperAdmin surface ────────────────────────────────────────────────────

    /**
     * Publish an announcement.
     *
     * @param createdBy the acting platform user, taken from the verified token's {@code sub} by the
     *                  controller and never from the request body — the same rule the impersonation
     *                  and password-reset paths follow, for the same reason: an accountability
     *                  record whose subject can choose what it says is not one.
     */
    @Transactional
    public AnnouncementResponse create(UUID createdBy, CreateAnnouncementRequest request) {
        Severity severity = parseEnum(Severity.class, request.severity(), "severity");
        AudienceKind kind = parseEnum(AudienceKind.class, request.audienceKind(), "audienceKind");
        List<String> targets = normaliseAudience(kind, request.audience());

        Instant startsAt = request.startsAt() != null ? request.startsAt() : Instant.now();
        if (request.endsAt() != null && !request.endsAt().isAfter(startsAt)) {
            // A window that closes before it opens can never match, so the announcement would
            // simply never appear — a typo that presents as "the feature is broken".
            throw new IllegalArgumentException("endsAt must be after startsAt");
        }

        AnnouncementEntity entity = new AnnouncementEntity();
        entity.setTitle(request.title().trim());
        entity.setBody(request.body().trim());
        entity.setSeverity(severity);
        entity.setAudienceKind(kind);
        entity.setStartsAt(startsAt);
        entity.setEndsAt(request.endsAt());
        entity.setCreatedBy(createdBy);
        entity.setCreatedAt(Instant.now());
        announcements.save(entity);

        for (String target : targets) {
            AnnouncementAudienceEntity audience = new AnnouncementAudienceEntity();
            audience.setAnnouncementId(entity.getId());
            audience.setAudienceType(kind == AudienceKind.TIER ? AudienceType.TIER : AudienceType.TENANT);
            audience.setAudienceValue(target);
            audiences.save(audience);
        }

        log.info("[announcement] published id={} severity={} audience={} targets={} by={}",
                entity.getId(), severity, kind, targets.size(), createdBy);
        return toResponse(entity, targets, 0L);
    }

    /** Every announcement, newest first, or only the ones live right now. */
    @Transactional(readOnly = true)
    public List<AnnouncementResponse> list(boolean activeOnly) {
        Instant now = Instant.now();
        List<AnnouncementEntity> rows = activeOnly
                ? announcements.findActiveAt(now)
                : announcements.findAllByOrderByCreatedAtDesc();
        Map<UUID, List<String>> targets = targetsFor(rows);

        List<AnnouncementResponse> responses = new ArrayList<>(rows.size());
        for (AnnouncementEntity row : rows) {
            responses.add(toResponse(row,
                    targets.getOrDefault(row.getId(), List.of()),
                    acknowledgements.countByAnnouncementId(row.getId())));
        }
        return List.copyOf(responses);
    }

    @Transactional(readOnly = true)
    public AnnouncementResponse get(UUID id) {
        AnnouncementEntity entity = require(id);
        return toResponse(entity, targetValues(id), acknowledgements.countByAnnouncementId(id));
    }

    /**
     * Withdraw an announcement. Idempotent: revoking an already-revoked one does not move the
     * timestamp, because the first withdrawal is the one that happened.
     */
    @Transactional
    public AnnouncementResponse revoke(UUID id, UUID revokedBy, String reason) {
        AnnouncementEntity entity = require(id);
        if (entity.getRevokedAt() == null) {
            entity.setRevokedAt(Instant.now());
            entity.setRevokedBy(revokedBy);
            announcements.save(entity);
            log.info("[announcement] revoked id={} by={} reason={}", id, revokedBy,
                    reason == null || reason.isBlank() ? "<none given>" : reason);
        }
        return toResponse(entity, targetValues(id), acknowledgements.countByAnnouncementId(id));
    }

    /**
     * How far an announcement has actually reached.
     *
     * <p>The denominator is computed from the tenant registry at read time rather than stored,
     * because an announcement targeting a TIER reaches whoever is on that tier NOW — and tenants
     * change tier. A stored denominator would silently describe the platform as it was on the day
     * of publication.
     */
    @Transactional(readOnly = true)
    public AnnouncementReach reach(UUID id) {
        AnnouncementEntity entity = require(id);
        List<String> targets = targetValues(id);

        long targeted;
        boolean coverageKnown = true;
        switch (entity.getAudienceKind()) {
            case ALL_TENANTS -> targeted = tenants.countAll();
            case TIER -> {
                List<TierType> tiers = new ArrayList<>();
                for (String value : targets) {
                    try {
                        tiers.add(TierType.valueOf(value));
                    } catch (IllegalArgumentException ex) {
                        // A stored tier name that no longer exists in the enum. The count would be
                        // wrong in an unknown direction, so it is refused rather than approximated.
                        coverageKnown = false;
                    }
                }
                targeted = tiers.isEmpty() ? 0L : tenants.countByTierIn(tiers);
            }
            case TENANT -> {
                List<UUID> ids = new ArrayList<>();
                for (String value : targets) {
                    try {
                        ids.add(UUID.fromString(value));
                    } catch (IllegalArgumentException ex) {
                        coverageKnown = false;
                    }
                }
                // Counted against the registry: a target id that names no tenant is not a target,
                // and including it would deflate every acknowledgement rate computed from this.
                targeted = ids.isEmpty() ? 0L : tenants.countByIdIn(ids);
            }
            default -> {
                targeted = 0L;
                coverageKnown = false;
            }
        }

        Map<UUID, String> slugs = tenantSlugs();
        List<AcknowledgementRecord> recent = new ArrayList<>();
        List<AnnouncementAcknowledgementEntity> rows =
                acknowledgements.findByAnnouncementIdOrderByAcknowledgedAtDesc(id);
        for (AnnouncementAcknowledgementEntity row : rows) {
            if (recent.size() >= RECENT_ACKNOWLEDGEMENTS) {
                break;
            }
            recent.add(new AcknowledgementRecord(row.getAnnouncementId(), row.getTenantId(),
                    slugs.get(row.getTenantId()), row.getUserId(), row.getAcknowledgedAt()));
        }

        long tenantsReached = acknowledgements.countByTenant(id).size();

        return new AnnouncementReach(id, rows.size(), tenantsReached, targeted, coverageKnown,
                List.copyOf(recent));
    }

    // ── tenant-facing surface (reached through /internal/platform) ─────────────

    /**
     * What one user of one tenant should currently be shown.
     *
     * <p>An unknown tenant gets an empty list rather than an error: a tenant id that resolves to
     * nothing has no announcements, which is an honest answer, and turning it into a 404 would make
     * this endpoint an existence oracle for tenant ids.
     */
    @Transactional(readOnly = true)
    public List<TenantAnnouncement> forTenant(UUID tenantId, UUID userId) {
        Optional<TierType> tier = tenants.findTierById(tenantId);
        if (tier.isEmpty()) {
            return List.of();
        }

        Instant now = Instant.now();
        List<AnnouncementEntity> active = announcements.findActiveAt(now);
        if (active.isEmpty()) {
            return List.of();
        }

        Map<UUID, List<AnnouncementAudienceEntity>> byAnnouncement = new LinkedHashMap<>();
        for (AnnouncementAudienceEntity row
                : audiences.findByAnnouncementIdIn(active.stream().map(AnnouncementEntity::getId).toList())) {
            byAnnouncement.computeIfAbsent(row.getAnnouncementId(), k -> new ArrayList<>()).add(row);
        }

        List<AnnouncementEntity> matching = new ArrayList<>();
        for (AnnouncementEntity row : active) {
            if (matches(row, byAnnouncement.getOrDefault(row.getId(), List.of()), tenantId, tier.get())) {
                matching.add(row);
            }
        }
        if (matching.isEmpty()) {
            return List.of();
        }

        Set<UUID> acknowledged = userId == null
                ? Set.of()
                : new LinkedHashSet<>(acknowledgements.findAcknowledgedIds(
                        userId, matching.stream().map(AnnouncementEntity::getId).toList()));

        List<TenantAnnouncement> result = new ArrayList<>(matching.size());
        for (AnnouncementEntity row : matching) {
            result.add(new TenantAnnouncement(
                    row.getId(), row.getTitle(), row.getBody(), row.getSeverity().name(),
                    row.getStartsAt(), row.getEndsAt(), acknowledged.contains(row.getId())));
        }
        return List.copyOf(result);
    }

    /**
     * Record that one person has seen one announcement.
     *
     * <p>Idempotent by primary key: a second acknowledgement from the same account keeps the FIRST
     * timestamp, because "when did they first see this" is the question the trail answers and a
     * re-render must not move it.
     *
     * <p>It deliberately does NOT check that the announcement targets this tenant. An
     * acknowledgement is a statement about what a person did, and refusing to record one because
     * the audience has since been narrowed would delete evidence rather than prevent an error. It
     * does check the announcement exists, because a row referencing nothing is not evidence either.
     */
    @Transactional
    public boolean acknowledge(UUID announcementId, UUID tenantId, UUID userId) {
        require(announcementId);
        var key = new AnnouncementAcknowledgementEntity.AckKey(announcementId, userId);
        if (acknowledgements.existsById(key)) {
            return false;
        }
        AnnouncementAcknowledgementEntity entity = new AnnouncementAcknowledgementEntity();
        entity.setAnnouncementId(announcementId);
        entity.setUserId(userId);
        entity.setTenantId(tenantId);
        entity.setAcknowledgedAt(Instant.now());
        acknowledgements.save(entity);
        return true;
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private boolean matches(AnnouncementEntity announcement,
                            List<AnnouncementAudienceEntity> targets,
                            UUID tenantId,
                            TierType tier) {
        return switch (announcement.getAudienceKind()) {
            case ALL_TENANTS -> true;
            case TIER -> targets.stream()
                    .filter(t -> t.getAudienceType() == AudienceType.TIER)
                    .anyMatch(t -> tier.name().equals(t.getAudienceValue()));
            case TENANT -> targets.stream()
                    .filter(t -> t.getAudienceType() == AudienceType.TENANT)
                    .anyMatch(t -> tenantId.toString().equals(t.getAudienceValue()));
        };
    }

    /**
     * Targets, validated at write time.
     *
     * <p>A TIER or TENANT announcement with no targets is REFUSED rather than accepted and treated
     * as "nobody" or "everybody". Both readings are defensible, which is precisely why the caller
     * must not be left to guess: the everybody reading is the one that cannot be taken back.
     */
    private List<String> normaliseAudience(AudienceKind kind, List<String> audience) {
        List<String> values = audience == null ? List.of()
                : audience.stream().filter(v -> v != null && !v.isBlank()).map(String::trim).toList();

        if (kind == AudienceKind.ALL_TENANTS) {
            if (!values.isEmpty()) {
                throw new IllegalArgumentException(
                        "audience must be empty when audienceKind is ALL_TENANTS");
            }
            return List.of();
        }
        if (values.isEmpty()) {
            throw new IllegalArgumentException(
                    "audience is required when audienceKind is " + kind);
        }

        List<String> normalised = new ArrayList<>();
        for (String value : values) {
            if (kind == AudienceKind.TIER) {
                normalised.add(parseEnum(TierType.class, value, "audience").name());
            } else {
                try {
                    normalised.add(UUID.fromString(value).toString());
                } catch (IllegalArgumentException ex) {
                    throw new IllegalArgumentException("audience entry is not a tenant id: " + value);
                }
            }
        }
        return List.copyOf(new LinkedHashSet<>(normalised));
    }

    private AnnouncementEntity require(UUID id) {
        return announcements.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Announcement not found: " + id));
    }

    private List<String> targetValues(UUID announcementId) {
        return audiences.findByAnnouncementId(announcementId).stream()
                .map(AnnouncementAudienceEntity::getAudienceValue)
                .toList();
    }

    private Map<UUID, List<String>> targetsFor(List<AnnouncementEntity> rows) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<String>> targets = new LinkedHashMap<>();
        for (AnnouncementAudienceEntity row
                : audiences.findByAnnouncementIdIn(rows.stream().map(AnnouncementEntity::getId).toList())) {
            targets.computeIfAbsent(row.getAnnouncementId(), k -> new ArrayList<>())
                    .add(row.getAudienceValue());
        }
        return targets;
    }

    private Map<UUID, String> tenantSlugs() {
        Map<UUID, String> slugs = new LinkedHashMap<>();
        for (Object[] row : tenants.findAllTenantIdentities()) {
            slugs.put((UUID) row[0], (String) row[1]);
        }
        return slugs;
    }

    private AnnouncementResponse toResponse(AnnouncementEntity entity,
                                            List<String> targets,
                                            long acknowledgementCount) {
        String email = platformUsers.findById(entity.getCreatedBy())
                .map(user -> user.getEmail())
                .orElse(null);
        return new AnnouncementResponse(
                entity.getId(), entity.getTitle(), entity.getBody(),
                entity.getSeverity().name(), entity.getAudienceKind().name(), targets,
                entity.getStartsAt(), entity.getEndsAt(),
                entity.isActiveAt(Instant.now()),
                entity.getCreatedBy(), email, entity.getCreatedAt(),
                entity.getRevokedAt(), entity.getRevokedBy(),
                acknowledgementCount,
                DELIVERY_CHANNELS);
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> type, String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        try {
            return Enum.valueOf(type, value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException(
                    field + " must be one of " + java.util.Arrays.toString(type.getEnumConstants())
                        + "; received \"" + value + "\"");
        }
    }
}
