package io.restaurantos.pos.support;

import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.ZoneId;
import java.util.UUID;

/**
 * The IANA zone a branch's trading day is cut on — pos-service's half of the business-day rule.
 *
 * <p><b>Why this exists.</b> shared-lib used to ship a UTC {@code BusinessDay.of(Instant)} overload
 * documented "for services that do not hold branch timezone data (pos-service)", and
 * {@code grep -rn 'ZoneId|timezone' services/pos-service/src/main} really did return nothing. That
 * premise was false, not merely inconvenient: pos-service has called
 * {@code GET /internal/users/branches/{id}} since plan 26-07 to print the branch's name and NTN on
 * every receipt, and the branch row it reads back has carried {@code timezone} the whole time. The
 * service was one unread field away from the answer and shipped a UTC approximation instead — which
 * for {@code Asia/Karachi} moved the 04:00 trading-day boundary to 09:00 local and filed every
 * breakfast service to the previous day in the general ledger.
 *
 * <p>This mirrors reporting-service's {@code BranchTimeZoneResolver} deliberately, down to the
 * cache key and the property names, because the two services must answer this question identically
 * or the ledger and ClickHouse drift apart again.
 *
 * <p><b>Fail-soft, and loudly.</b> A branch lookup that fails must not stop a cashier taking money;
 * an order that cannot be closed is worse than one dated on a fallback zone. So any failure logs at
 * WARN with the branch id and falls back to {@code restaurantos.business-day.default-timezone}
 * (default {@code Asia/Karachi} — PROJECT.md is Pakistan-first). The Redis cache is what keeps that
 * fallback rare: a branch timezone effectively never changes, so the first close of the day pays for
 * the HTTP call and every later one reads a string from Redis, and a user-service that goes down
 * mid-service keeps answering with the branch's OWN zone rather than the global default.
 */
@Component
public class BranchTimeZoneResolver {

    private static final Logger log = LoggerFactory.getLogger(BranchTimeZoneResolver.class);
    private static final String CACHE_KEY_PREFIX = "branch:tz:";

    private final UserBranchClient userBranchClient;
    private final StringRedisTemplate redisTemplate;
    private final TenantContext tenantContext;
    private final ZoneId defaultZone;
    private final Duration cacheTtl;

    public BranchTimeZoneResolver(
            UserBranchClient userBranchClient,
            StringRedisTemplate redisTemplate,
            TenantContext tenantContext,
            @Value("${restaurantos.business-day.default-timezone:Asia/Karachi}") String defaultTimezone,
            @Value("${restaurantos.business-day.branch-timezone-cache-ttl-hours:24}") long cacheTtlHours) {
        this.userBranchClient = userBranchClient;
        this.redisTemplate = redisTemplate;
        this.tenantContext = tenantContext;
        this.defaultZone = ZoneId.of(defaultTimezone);
        this.cacheTtl = Duration.ofHours(cacheTtlHours);
    }

    /** The configured fallback, for callers that have no branch at all to ask about. */
    public ZoneId defaultZone() {
        return defaultZone;
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
            log.warn("BranchTimeZoneResolver: Redis lookup failed for branchId={}, falling through "
                    + "to user-service: {}", branchId, e.getMessage());
        }

        UUID tenantId;
        try {
            tenantId = tenantContext.requireTenantId();
        } catch (Exception e) {
            // The internal branch endpoint sets the RLS GUC from this header; without it the
            // lookup matches zero rows and REPORTS SUCCESS, which would hand back the default zone
            // while looking like a real answer. Refusing to make the call is the honest branch.
            log.warn("BranchTimeZoneResolver: no tenant on this thread, cannot look up branchId={} "
                    + "— falling back to default {}", branchId, defaultZone);
            return defaultZone;
        }

        try {
            UserBranchClient.BranchDetail branch = userBranchClient.getBranch(branchId, tenantId);
            String timezone = branch != null ? branch.timezone() : null;
            if (timezone == null || timezone.isBlank()) {
                log.warn("BranchTimeZoneResolver: branchId={} has no timezone field — falling back "
                        + "to default {}", branchId, defaultZone);
                return defaultZone;
            }
            ZoneId zone = ZoneId.of(timezone);
            cacheSafely(cacheKey, timezone);
            return zone;
        } catch (Exception e) {
            log.warn("BranchTimeZoneResolver: user-service lookup failed for branchId={}, falling "
                    + "back to default {}: {}", branchId, defaultZone, e.getMessage());
            return defaultZone;
        }
    }

    private void cacheSafely(String cacheKey, String timezone) {
        try {
            redisTemplate.opsForValue().set(cacheKey, timezone, cacheTtl);
        } catch (Exception e) {
            log.warn("BranchTimeZoneResolver: failed to cache timezone for key={}: {}",
                    cacheKey, e.getMessage());
        }
    }
}
