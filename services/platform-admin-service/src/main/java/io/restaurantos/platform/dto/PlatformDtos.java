package io.restaurantos.platform.dto;

import io.restaurantos.platform.entity.TenantEntity;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * DTOs for platform-admin-service public and internal API surfaces.
 * Field names match Doc 4 §4.2 internal contracts exactly.
 */
public final class PlatformDtos {

    private PlatformDtos() {}

    // --- Request DTOs ---

    public record CreateTenantRequest(
        String brandName,
        String adminEmail,
        String tier
    ) {}

    public record FeatureToggleRequest(boolean enabled) {}

    public record ImpersonateRequest(
        UUID tenantId,
        UUID targetUserId,
        String reason
    ) {}

    // Internal endpoint — body field is "delta" (API), stored as "qty" (DB)
    public record UsageRecordRequest(String resource, java.math.BigDecimal delta) {}

    // --- Response DTOs ---

    public record TenantResponse(
        UUID id,
        String slug,
        String brandName,
        String status,
        String tier,
        Instant createdAt,
        Instant suspendedAt,
        Instant cancelledAt,
        Integer maxBranches,
        Integer maxUsers,
        Integer storageGb,
        Integer nlqQuota
    ) {
        public static TenantResponse from(TenantEntity e) {
            return new TenantResponse(
                e.getId(), e.getSlug(), e.getBrandName(),
                e.getStatus().name(), e.getTier().name(),
                e.getCreatedAt(), e.getSuspendedAt(), e.getCancelledAt(),
                e.getMaxBranches(), e.getMaxUsers(), e.getStorageGb(), e.getNlqQuota()
            );
        }
    }

    public record ProvisionResult(UUID tenantId, String slug, String loginUrl) {}

    public record FeaturesResponse(Map<String, Boolean> features) {}

    // Doc 4 §4.2 — includes tier so gateway can enforce quota per tier
    public record StatusResponse(String status, String tier) {}

    public record UsageRecordResponse(long newCount, long limit) {}

    public record ImpersonateResponse(String token, int expiresIn) {}
}
