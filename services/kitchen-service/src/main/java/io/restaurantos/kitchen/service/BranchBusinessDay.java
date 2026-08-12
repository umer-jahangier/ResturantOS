package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.client.UserBranchClient;
import io.restaurantos.shared.time.BusinessDay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

/**
 * "Which trading day is this, on this branch's own wall clock?" — kitchen-service's half of the
 * business-day rule.
 *
 * <p>The arithmetic is <b>not</b> repeated here. It delegates to shared-lib's {@link BusinessDay},
 * the one implementation the fleet shares, using the same
 * {@code restaurantos.business-day.offset-hours} property reporting-service and pos-service read.
 * Three copies of one date formula is exactly how the trading day came to be cut three different
 * ways in this product, and the copy that was wrong looked identical to the copy that was right.
 *
 * <p>The zone comes from the branch record over {@link UserBranchClient}, cached in Redis under
 * {@code branch:tz:<id>} — deliberately the SAME key pos-service and reporting-service use, because
 * three services answering "what zone is this branch on?" differently is the defect, not the cache.
 *
 * <h3>Fail-soft on the read, fail-LOUD on not knowing</h3>
 *
 * <p>{@link #zoneOf} falls back to {@code restaurantos.business-day.default-timezone} when
 * user-service cannot be reached, which is right for a read: a cook must still be able to look at a
 * board when an unrelated service is restarting.
 *
 * <p>{@link #startOfCurrentDay} takes a {@code strict} flag for the other case. A DESTRUCTIVE
 * operation — clearing tickets off a board — must not run against a guessed boundary: for
 * {@code Asia/Karachi} a UTC guess moves the cut from 04:00 local to 09:00 local, and five hours of
 * this morning's tickets would be inside the "yesterday" it clears. So the clear path asks
 * strictly, and refuses rather than clearing on a zone nobody chose.
 */
@Component
public class BranchBusinessDay {

    private static final Logger log = LoggerFactory.getLogger(BranchBusinessDay.class);
    private static final String CACHE_KEY_PREFIX = "branch:tz:";

    private final UserBranchClient branchClient;
    private final StringRedisTemplate redisTemplate;
    private final ZoneId defaultZone;
    private final Duration cacheTtl;
    private final int offsetHours;

    public BranchBusinessDay(
            UserBranchClient branchClient,
            StringRedisTemplate redisTemplate,
            @Value("${restaurantos.business-day.default-timezone:Asia/Karachi}") String defaultTimezone,
            @Value("${restaurantos.business-day.branch-timezone-cache-ttl-hours:24}") long cacheTtlHours,
            @Value("${restaurantos.business-day.offset-hours:4}") int offsetHours) {
        this.branchClient = branchClient;
        this.redisTemplate = redisTemplate;
        this.defaultZone = ZoneId.of(defaultTimezone);
        this.cacheTtl = Duration.ofHours(cacheTtlHours);
        this.offsetHours = offsetHours;
    }

    public int offsetHours() {
        return offsetHours;
    }

    /** Raised when the branch's zone genuinely cannot be established and the caller needs it. */
    public static class BranchZoneUnknownException extends RuntimeException {
        public BranchZoneUnknownException(String message) {
            super(message);
        }
    }

    /**
     * The branch's IANA zone, or {@code null} when it could not be established.
     *
     * <p>Null rather than the default, so a caller that must not guess can tell the two apart.
     * {@link #zoneOfOrDefault} is the fail-soft face for callers that only need to render.
     */
    public ZoneId resolveZone(UUID tenantId, UUID branchId) {
        if (branchId == null) {
            return null;
        }
        String cacheKey = CACHE_KEY_PREFIX + branchId;
        try {
            String cached = redisTemplate.opsForValue().get(cacheKey);
            if (cached != null && !cached.isBlank()) {
                return ZoneId.of(cached);
            }
        } catch (Exception e) {
            log.warn("Branch timezone: Redis lookup failed for branchId={}, falling through to "
                    + "user-service: {}", branchId, e.getMessage());
        }

        String timezone = branchClient.getBranch(tenantId, branchId)
                .map(UserBranchClient.BranchIdentity::timezone)
                .orElse(null);
        if (timezone == null || timezone.isBlank()) {
            return null;
        }
        ZoneId zone;
        try {
            zone = ZoneId.of(timezone);
        } catch (Exception e) {
            log.warn("Branch {} carries timezone '{}', which is not an IANA zone id", branchId, timezone);
            return null;
        }
        try {
            redisTemplate.opsForValue().set(cacheKey, timezone, cacheTtl);
        } catch (Exception e) {
            log.warn("Branch timezone: failed to cache {} for branchId={}: {}",
                    timezone, branchId, e.getMessage());
        }
        return zone;
    }

    /** Fail-soft: the branch's zone, or the configured default. For READ paths only. */
    public ZoneId zoneOfOrDefault(UUID tenantId, UUID branchId) {
        ZoneId zone = resolveZone(tenantId, branchId);
        if (zone == null) {
            log.warn("Branch {} timezone unresolved — falling back to {}", branchId, defaultZone);
            return defaultZone;
        }
        return zone;
    }

    /** The trading day {@code at} belongs to, on {@code zone}'s wall clock. */
    public LocalDate dateOf(Instant at, ZoneId zone) {
        return BusinessDay.of(at, zone, offsetHours);
    }

    /**
     * The exact instant the CURRENT business day began at this branch.
     *
     * <p>This is the cutoff: a ticket received strictly before it belongs to a business day that has
     * closed; a ticket received at or after it is today's work.
     *
     * @param strict when true, refuse rather than fall back to the default zone — see the class
     *               javadoc for why a destructive path must not run on a guessed boundary
     */
    public Instant startOfCurrentDay(UUID tenantId, UUID branchId, boolean strict) {
        ZoneId zone = resolveZone(tenantId, branchId);
        if (zone == null) {
            if (strict) {
                throw new BranchZoneUnknownException(
                        "This branch's time zone could not be read, so the start of today's "
                                + "trading day is not known. Nothing was cleared. Set the branch "
                                + "time zone in Settings, or try again when the service answers.");
            }
            log.warn("Branch {} timezone unresolved — business-day boundary computed on {}",
                    branchId, defaultZone);
            zone = defaultZone;
        }
        return startOfDay(dateOf(Instant.now(), zone), zone);
    }

    /**
     * The instant a given business day begins in {@code zone}.
     *
     * <p>{@code date} + the offset, on the branch's wall clock. For {@code Asia/Karachi} and the
     * default 4-hour offset, business day 2026-08-12 begins at 04:00 PKT = 2026-08-11T23:00Z — which
     * is the inverse of {@link BusinessDay#of}, and the pair is asserted against each other in
     * {@code BranchBusinessDayTest} rather than left to agree by inspection.
     */
    public Instant startOfDay(LocalDate date, ZoneId zone) {
        return date.atStartOfDay(zone).plusHours(offsetHours).toInstant();
    }
}
