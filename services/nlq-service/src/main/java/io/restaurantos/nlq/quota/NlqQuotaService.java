package io.restaurantos.nlq.quota;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Redis atomic reserve/rollback quota counters (clones the {@code INCRBY}-then-{@code DECRBY}
 * race-safe idiom from {@code file-service}'s {@code QuotaService}).
 *
 * <p><b>THE MONTHLY KEY IS A CONTRACT.</b> {@code gateway/.../FeatureFlagGlobalFilter.java:147}
 * ALREADY reads {@code nlq_quota:{tenantId}:monthly_count} and 429s with {@code QUOTA_EXCEEDED}
 * once it crosses its own limit. This class is the WRITER of that exact key — nlq-service must
 * never pick a different key shape, or the gateway's enforcement silently becomes a permanent
 * no-op reading 0. See gateway line 147 and 49 for the verbatim key format this mirrors:
 * {@code nlq_quota:{tenantId}:monthly_count}.
 *
 * <p>The monthly key deliberately does NOT embed a {@code YYYYMM} suffix (that would NOT match
 * the gateway's key shape) — instead a TTL is set, on first increment only, to expire at the end
 * of the current UTC calendar month, so the counter resets without ever changing key shape.
 *
 * <p>Reservation happens BEFORE the (expensive) Claude call — see {@code NlqService} — so a
 * quota-exceeded request never causes an LLM spend.
 *
 * <p><b>Fails closed.</b> If Redis is unreachable, every reservation is REJECTED
 * ({@link QuotaServiceUnavailableException}, mapped to 503) — an unmetered LLM endpoint is a
 * billing incident, not a degraded feature.
 */
@Service
public class NlqQuotaService {

    private static final Logger log = LoggerFactory.getLogger(NlqQuotaService.class);
    private static final String KEY_PREFIX = "nlq_quota:";
    private static final long HOURLY_TTL_SECONDS = TimeUnit.HOURS.toSeconds(1);

    private final StringRedisTemplate redis;
    private final long monthlyLimit;
    private final long hourlyLimit;

    public NlqQuotaService(StringRedisTemplate redis,
                            @Value("${restaurantos.nlq.monthly-quota-default}") long monthlyLimit,
                            @Value("${restaurantos.nlq.user-hourly-limit}") long hourlyLimit) {
        this.redis = redis;
        this.monthlyLimit = monthlyLimit;
        this.hourlyLimit = hourlyLimit;
    }

    /** The EXACT key gateway/FeatureFlagGlobalFilter.java:147 reads. Do not change this shape. */
    public String monthlyKey(UUID tenantId) {
        return KEY_PREFIX + tenantId + ":monthly_count";
    }

    public String hourlyKey(UUID tenantId, UUID userId) {
        return KEY_PREFIX + tenantId + ":" + userId + ":hourly_count";
    }

    /**
     * Reserves ONE unit of both the monthly tenant quota and the hourly user quota, atomically
     * per-counter. On success both counters are incremented and remain incremented until either
     * the request completes (kept) or {@link #rollback(UUID, UUID)} is called (a cache hit, a
     * validator rejection, or a Claude failure should not cost the tenant a query).
     *
     * @throws QuotaExceededException         if either quota is now over its limit — the
     *                                        over-limit increment is rolled back before throwing,
     *                                        so the counter is left AT the limit, not limit+1.
     * @throws QuotaServiceUnavailableException if Redis cannot be reached — fails closed.
     */
    public void reserve(UUID tenantId, UUID userId) {
        try {
            long monthlyCount = incrementWithFirstTtl(monthlyKey(tenantId), secondsUntilEndOfUtcMonth());
            if (monthlyCount > monthlyLimit) {
                redis.opsForValue().decrement(monthlyKey(tenantId));
                throw new QuotaExceededException(QuotaExceededException.Quota.MONTHLY_TENANT, monthlyLimit);
            }

            long hourlyCount;
            try {
                hourlyCount = incrementWithFirstTtl(hourlyKey(tenantId, userId), HOURLY_TTL_SECONDS);
            } catch (RuntimeException ex) {
                redis.opsForValue().decrement(monthlyKey(tenantId));
                throw ex;
            }

            if (hourlyCount > hourlyLimit) {
                redis.opsForValue().decrement(hourlyKey(tenantId, userId));
                redis.opsForValue().decrement(monthlyKey(tenantId));
                throw new QuotaExceededException(QuotaExceededException.Quota.HOURLY_USER, hourlyLimit);
            }
        } catch (QuotaExceededException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.warn("[nlq-quota] Redis unreachable — failing closed (rejecting the request)", ex);
            throw new QuotaServiceUnavailableException("NLQ quota service unavailable", ex);
        }
    }

    /**
     * Restores a previously-successful {@link #reserve(UUID, UUID)} — called when the reserved
     * query was never actually charged for (cache hit, validator rejection, Claude failure).
     */
    public void rollback(UUID tenantId, UUID userId) {
        try {
            redis.opsForValue().decrement(monthlyKey(tenantId));
            redis.opsForValue().decrement(hourlyKey(tenantId, userId));
        } catch (RuntimeException ex) {
            log.warn("[nlq-quota] Rollback failed (Redis unreachable) — counters may over-count until TTL expiry", ex);
        }
    }

    private long incrementWithFirstTtl(String key, long ttlSeconds) {
        Long count = redis.opsForValue().increment(key);
        if (count == null) {
            count = 1L;
        }
        if (count == 1L) {
            // Only the request that just created the key sets its expiry — avoids resetting the
            // TTL on every increment (which would make the counter never actually expire).
            redis.expire(key, ttlSeconds, TimeUnit.SECONDS);
        }
        return count;
    }

    private static long secondsUntilEndOfUtcMonth() {
        ZonedDateTime now = ZonedDateTime.now(ZoneOffset.UTC);
        YearMonth currentMonth = YearMonth.from(now);
        LocalDate firstOfNextMonth = currentMonth.plusMonths(1).atDay(1);
        ZonedDateTime endOfMonth = firstOfNextMonth.atStartOfDay(ZoneOffset.UTC);
        long seconds = java.time.Duration.between(now, endOfMonth).getSeconds();
        return Math.max(seconds, 1);
    }
}
