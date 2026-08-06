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

    /**
     * The editable half of a tenant (13-14 / D-35). Every field is optional — null means "leave the
     * stored value alone" — so a SuperAdmin can set a billing reference without resending the brand.
     *
     * <p><b>There is deliberately no {@code slug} and no {@code tier}.</b> The slug is what login
     * resolves a tenant by and what {@code auth_db.auth_tenants} mirrors; renaming it here would
     * silently lock a tenant out. The tier is not a profile field — changing it re-applies limits
     * and reconciles feature rows, so it has its own endpoint and its own safety check.
     */
    public record UpdateTenantRequest(
        String brandName,
        String billingRef,
        Instant trialEndsAt,
        Instant renewsAt
    ) {}

    /**
     * @param tier  STARTER | GROWTH | ENTERPRISE | CUSTOM
     * @param force apply the tier even when the tenant is already over the target's limits. Absent
     *              reads as false, so the safe behaviour is the one you get by not thinking about it.
     *              <p><b>Boxed on purpose.</b> As a primitive {@code boolean} this service's Jackson
     *              configuration refuses a body that omits it — every request without an explicit
     *              {@code "force"} came back 400 BAD_REQUEST, which is the opposite of "absent means
     *              false" and turns the safe default into an error.
     */
    public record ChangeTierRequest(@NotBlank String tier, Boolean force) {
        /** Absent or null is false: a downgrade is refused unless the caller explicitly insists. */
        public boolean forced() {
            return Boolean.TRUE.equals(force);
        }
    }

    /**
     * The admin address the retried saga will create the tenant's first account from. Required, and
     * required for a reason: the pre-13-10 retry passed the literal string {@code "(retry)"}.
     */
    public record RetryProvisioningRequest(@NotBlank String adminEmail) {}

    /**
     * @param actingAdminUserId the platform administrator performing the impersonation.
     *        <p><b>Read on the INTERNAL endpoint only, and required there.</b> On the public
     *        {@code /api/v1/platform/**} endpoint this field is ignored entirely: the acting id is
     *        taken from the verified platform principal in the token, because a repudiation control
     *        whose subject can name themselves is not a control. The internal endpoint has no token
     *        to read (it is gated by the shared secret) so it must be told, and it refuses to
     *        proceed if it is not — the alternative is the D-34 defect this plan fixed, which
     *        recorded the impersonated user as their own impersonator.
     */
    public record ImpersonateRequest(
        UUID tenantId,
        UUID targetUserId,
        UUID actingAdminUserId,
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

    /**
     * A tenant as the SuperAdmin sees it.
     *
     * <p>{@code billingRef}, {@code trialEndsAt} and {@code renewsAt} were added by 13-14. The first
     * two are columns that had existed since 010-001 and were never read or written by anything;
     * the third is a column 13-14 added, because the plan's "columns that exist today" turned out to
     * be two of three. A subscription that can be edited but not read back is not manageable, so the
     * read side is part of the same change.
     */
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
        Integer nlqQuota,
        String billingRef,
        Instant trialEndsAt,
        Instant renewsAt
    ) {
        public static TenantResponse from(TenantEntity e) {
            return new TenantResponse(
                e.getId(), e.getSlug(), e.getBrandName(),
                e.getStatus().name(), e.getTier().name(),
                e.getCreatedAt(), e.getSuspendedAt(), e.getCancelledAt(),
                e.getMaxBranches(), e.getMaxUsers(), e.getStorageGb(), e.getNlqQuota(),
                e.getBillingRef(), e.getTrialEndsAt(), e.getRenewsAt()
            );
        }
    }

    /** What a tier change did, as the caller receives it. Mirrors {@code TierChangeResult}. */
    public record TierChangeResponse(
        UUID tenantId,
        String previousTier,
        String tier,
        java.util.List<String> changedFeatureCodes,
        Integer maxBranches,
        Integer maxUsers,
        Integer storageGb,
        Integer nlqQuota,
        boolean forcedOverLimits
    ) {
        public static TierChangeResponse from(
                io.restaurantos.platform.service.TenantSubscriptionService.TierChangeResult r) {
            return new TierChangeResponse(
                r.tenantId(), r.previousTier(), r.tier(), r.changedFeatureCodes(),
                r.limits().maxBranches(), r.limits().maxUsers(),
                r.limits().storageGb(), r.limits().nlqQuota(), r.forcedOverLimits());
        }
    }

    /**
     * The result of provisioning a tenant, as the calling SuperAdmin receives it.
     *
     * <p><b>{@code tempPassword} is one-time credential material and this response is the only
     * place it will ever appear.</b> It is not logged, not persisted in plaintext by
     * platform-admin-service, and not carried in the TENANT_PROVISIONED event payload. The
     * SuperAdmin must transmit it to the new tenant admin <b>out of band</b>; the admin is then
     * refused a normal login until they replace it (13-08's forced change).
     *
     * <p>It can be null on one path only: an idempotent replay made after the credential's one-hour
     * retention window has elapsed. The tenant is still returned; the credential is simply gone.
     *
     * <p>Before plan 13-10 this record carried a {@code loginUrl} <i>in place of</i> the password —
     * the saga generated a credential and the controller threw it away, so nobody could ever log in
     * as a provisioned admin (audit B2 / D-08). The url is still here, but beside the password
     * rather than instead of it.
     */
    public record ProvisionResult(UUID tenantId, String slug, String adminEmail,
                                  String tempPassword, String loginUrl) {}

    public record FeaturesResponse(Map<String, Boolean> features) {}

    /**
     * Doc 4 §4.2, extended by 13-14 with {@code nlqQuota}.
     *
     * <p>The gateway used to compare the NLQ counter against a compiled-in
     * {@code NLQ_DEFAULT_MONTHLY_LIMIT = 5000} while every tenant carried its own
     * {@code tenants.nlq_quota} that nothing ever read — so an ENTERPRISE tenant paying for 50,000
     * queries was throttled at 5,000 and a STARTER tenant entitled to 1,000 was given 5,000. This
     * field is how the tenant's own number reaches the edge; it rides along with the status the
     * gateway already fetches and caches, so the quota costs no extra round trip.
     *
     * <p>Null only if the column is null, which is itself a determination the gateway must treat as
     * "undeterminable" and refuse — see {@code FeatureFlagGlobalFilter.checkQuota}.
     */
    public record StatusResponse(String status, String tier, Integer nlqQuota) {}

    public record UsageRecordResponse(long newCount, long limit) {}

    public record ImpersonateResponse(String token, int expiresIn) {}
}
