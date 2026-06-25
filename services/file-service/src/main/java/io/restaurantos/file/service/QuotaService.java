package io.restaurantos.file.service;

import io.restaurantos.file.client.PlatformAdminClient;
import io.restaurantos.file.config.TierStorageProperties;
import io.restaurantos.file.exception.QuotaExceededException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Enforces tenant storage quota before each upload using a Redis atomic counter.
 *
 * Flow:
 * 1. Fetch tenant's tier from platform-admin — FAIL CLOSED if unreachable.
 * 2. Map tier → limit in bytes using TierStorageProperties defaults.
 * 3. Atomically increment Redis counter (INCRBY) by newFileSizeBytes.
 * 4. If new total > limit, decrement (DECRBY rollback) and throw QuotaExceededException (→ 409).
 *
 * The Redis counter is the primary gate to prevent concurrent-upload races.
 * Drift between Redis and the DB sum (FileMetadataRepository.sumSizeBytesByTenantId) may occur
 * if a service restarts mid-upload; a periodic reconciliation job can correct this by calling
 * redisTemplate.opsForValue().set(key, String.valueOf(dbSum)) — see SUMMARY for details.
 */
@Service
public class QuotaService {

    private static final Logger log = LoggerFactory.getLogger(QuotaService.class);
    private static final String QUOTA_KEY_PREFIX = "storage:bytes:";

    private final PlatformAdminClient platformAdminClient;
    private final StringRedisTemplate redisTemplate;
    private final TierStorageProperties tierStorageProperties;

    public QuotaService(PlatformAdminClient platformAdminClient,
                        StringRedisTemplate redisTemplate,
                        TierStorageProperties tierStorageProperties) {
        this.platformAdminClient = platformAdminClient;
        this.redisTemplate = redisTemplate;
        this.tierStorageProperties = tierStorageProperties;
    }

    /**
     * Checks and reserves quota for an incoming upload atomically via Redis INCRBY.
     * MUST be called before any MinIO write. If this returns normally, quota is reserved.
     * The caller MUST call {@link #releaseQuota(UUID, long)} if the subsequent upload fails.
     *
     * @throws QuotaExceededException if the upload would exceed the tenant's storage limit
     * @throws feign.FeignException   if platform-admin is unreachable (fail-closed → caller surfaces as 503)
     */
    public void checkQuota(UUID tenantId, long newFileSizeBytes) {
        long limitBytes = getStorageLimitBytes(tenantId);

        String redisKey = QUOTA_KEY_PREFIX + tenantId;
        Long newTotal = redisTemplate.opsForValue().increment(redisKey, newFileSizeBytes);
        if (newTotal == null) {
            newTotal = newFileSizeBytes;
        }

        if (newTotal > limitBytes) {
            redisTemplate.opsForValue().decrement(redisKey, newFileSizeBytes);
            long usedBefore = newTotal - newFileSizeBytes;
            log.warn("Quota exceeded for tenant {}: used={} + new={} > limit={}",
                    tenantId, usedBefore, newFileSizeBytes, limitBytes);
            throw new QuotaExceededException("STORAGE_GB", usedBefore, limitBytes);
        }
    }

    /**
     * Rolls back a previously reserved quota increment on upload failure.
     */
    public void releaseQuota(UUID tenantId, long fileSizeBytes) {
        String redisKey = QUOTA_KEY_PREFIX + tenantId;
        redisTemplate.opsForValue().decrement(redisKey, fileSizeBytes);
    }

    /**
     * Returns the storage limit in bytes for a tenant by querying platform-admin for tier.
     * Throws feign.FeignException if platform-admin is unreachable (fail-closed).
     */
    public long getStorageLimitBytes(UUID tenantId) {
        var response = platformAdminClient.getTenantStatus(tenantId);
        String tier = (response.data() != null) ? response.data().tier() : "STARTER";
        return tierStorageProperties.getLimitForTier(tier);
    }
}
