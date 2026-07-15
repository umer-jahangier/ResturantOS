package io.restaurantos.reporting.support;

import io.restaurantos.reporting.feign.UserInternalClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.ZoneId;
import java.util.UUID;

/**
 * Resolves a branch's IANA timezone for the business-day bucketing formula.
 *
 * <p>ETL consumers run on an AMQP thread with NO inbound HTTP request, so
 * {@code FeignClientConfig.forwardCallerJwt()} correctly no-ops and the internal Feign call to
 * user-service carries only X-Internal-Service + X-Tenant-Id. Empirically confirmed sufficient:
 * {@code GET /internal/users/branches/{branchId}} is gated ONLY by
 * {@code UserInternalServiceFilter}'s constant-time secret check — it does not require a caller
 * JWT (see {@code BranchInternalController} / {@code UserInternalServiceFilter} in
 * user-service). Recorded for 12-05, which needs the same endpoint for the FBR header
 * (NTN/STRN) and will call it from a real HTTP request context.
 *
 * <p>A branch timezone effectively never changes, so results are cached in Redis under
 * {@code branch:tz:{branchId}} for a long TTL. On ANY failure (call rejected, user-service down,
 * field absent/blank) this falls back to {@code restaurantos.business-day.default-timezone}
 * (default {@code Asia/Karachi} — PROJECT.md is Pakistan-first) and logs at WARN with the
 * branchId. An unreachable user-service must degrade the business-date bucket, never drop the
 * event.
 */
@Component
public class BranchTimeZoneResolver {

    private static final Logger log = LoggerFactory.getLogger(BranchTimeZoneResolver.class);
    private static final String CACHE_KEY_PREFIX = "branch:tz:";

    private final UserInternalClient userInternalClient;
    private final StringRedisTemplate redisTemplate;
    private final ZoneId defaultZone;
    private final Duration cacheTtl;

    public BranchTimeZoneResolver(
            UserInternalClient userInternalClient,
            StringRedisTemplate redisTemplate,
            @Value("${restaurantos.business-day.default-timezone:Asia/Karachi}") String defaultTimezone,
            @Value("${restaurantos.business-day.branch-timezone-cache-ttl-hours:24}") long cacheTtlHours) {
        this.userInternalClient = userInternalClient;
        this.redisTemplate = redisTemplate;
        this.defaultZone = ZoneId.of(defaultTimezone);
        this.cacheTtl = Duration.ofHours(cacheTtlHours);
    }

    public ZoneId resolve(UUID branchId) {
        if (branchId == null) {
            return defaultZone;
        }
        String cacheKey = CACHE_KEY_PREFIX + branchId;
        try {
            String cached = redisTemplate.opsForValue().get(cacheKey);
            if (cached != null && !cached.isBlank()) {
                return ZoneId.of(cached);
            }
        } catch (Exception e) {
            log.warn("BranchTimeZoneResolver: Redis lookup failed for branchId={}, falling through to user-service: {}",
                    branchId, e.getMessage());
        }

        try {
            UserInternalClient.BranchInternalDto branch = userInternalClient.getBranch(branchId);
            String timezone = branch != null ? branch.timezone() : null;
            if (timezone == null || timezone.isBlank()) {
                log.warn("BranchTimeZoneResolver: branchId={} has no timezone field — falling back to default {}",
                        branchId, defaultZone);
                return defaultZone;
            }
            ZoneId zone = ZoneId.of(timezone);
            cacheSafely(cacheKey, timezone);
            return zone;
        } catch (Exception e) {
            log.warn("BranchTimeZoneResolver: user-service lookup failed for branchId={}, falling back to default {}: {}",
                    branchId, defaultZone, e.getMessage());
            return defaultZone;
        }
    }

    private void cacheSafely(String cacheKey, String timezone) {
        try {
            redisTemplate.opsForValue().set(cacheKey, timezone, cacheTtl);
        } catch (Exception e) {
            log.warn("BranchTimeZoneResolver: failed to cache timezone for key={}: {}", cacheKey, e.getMessage());
        }
    }
}
