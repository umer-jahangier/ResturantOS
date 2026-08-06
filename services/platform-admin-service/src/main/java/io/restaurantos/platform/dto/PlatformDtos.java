package io.restaurantos.platform.dto;

import io.restaurantos.platform.entity.TenantEntity;
import jakarta.validation.constraints.NotBlank;

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

    /**
     * Platform (SuperAdmin) login credentials.
     *
     * <p><b>Neither field carries a format or strength constraint, and that is deliberate.</b>
     * {@code @StrongPassword} belongs where a password is <i>chosen</i>, never where an existing one
     * is <i>presented</i> — see its javadoc in shared-lib and the identical comments on
     * {@code LoginRequest} and {@code TotpBootstrapRequest}. Putting one here would refuse the
     * correct password of any account whose credential predates a policy tightening, before the
     * encoder is ever consulted: a total lockout served as a 400.
     *
     * <p>{@code @Email} is absent for a second reason on top of that one. A syntax rule on this
     * field produces a 400 {@code VALIDATION_FAILED} for a malformed address and a 401 for a
     * well-formed unknown one, which is a response-shape difference this endpoint is specifically
     * required not to have. {@code @NotBlank} produces the same 400 for both fields regardless of
     * whether the account exists, so it introduces no such distinction.
     */
    public record PlatformLoginRequest(
        @NotBlank String email,
        @NotBlank String password
    ) {}

    /**
     * A successful platform login.
     *
     * <p>There is deliberately no refresh token and no cookie. A platform session is the highest
     * authority in this system; it re-authenticates rather than refreshes, so no long-lived platform
     * credential exists to be stolen. {@code PlatformAuthIT} asserts the absence of {@code
     * Set-Cookie} on every response from this endpoint rather than trusting that nobody adds one.
     */
    public record PlatformLoginResponse(
        String accessToken,
        long expiresIn,
        String tokenType,
        UUID platformUserId,
        String role
    ) {}

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
