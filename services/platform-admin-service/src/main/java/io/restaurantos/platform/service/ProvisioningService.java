package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuthInternalClient;
import io.restaurantos.platform.client.FinanceInternalClient;
import io.restaurantos.platform.client.UserInternalClient;
import io.restaurantos.platform.config.TierFeatureDefaults;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.entity.TenantFeatureEntity;
import io.restaurantos.platform.repository.TenantFeatureRepository;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Sequential provisioning saga for creating a new tenant (PLATFORM-01 / SC2).
 *
 * <p>Steps, in the order they run:
 * <ol>
 *   <li>Persist a PENDING_SETUP tenant record</li>
 *   <li>Seed per-tier feature flags</li>
 *   <li>Create the headquarters branch via user-service {@code /internal/users/branches}</li>
 *   <li>Register the auth-side tenant row via auth-service {@code /internal/auth/tenants}</li>
 *   <li>Provision the admin user <b>and its OWNER branch-role</b> via
 *       {@code /internal/auth/tenants/{id}/provision-admin}</li>
 *   <li>Seed the Chart of Accounts via finance-service (guarded by
 *       {@code restaurantos.provisioning.seed-coa.enabled})</li>
 *   <li>Mark ACTIVE and publish TENANT_PROVISIONED through the outbox</li>
 * </ol>
 *
 * <p><b>Why step 4 precedes step 5.</b> Registering the auth tenant is the only step that can fail
 * on a slug collision, and a collision must be discovered before a user exists: the failure is then
 * cheap and its compensation is the removal of a branch nobody has referenced. Reversing the two
 * would leave a real account belonging to a tenant nobody can resolve by slug.
 *
 * <p><b>On failure</b> the tenant is marked PROVISIONING_FAILED and every completed step's
 * compensating action is run in reverse. A compensating action that itself fails does not vanish
 * into a warning — it becomes a {@link ManualRepairRecord} naming the tenant, the kind of resource
 * and its id, logged at ERROR and carried on the thrown {@link ProvisioningException}.
 *
 * <p>Blocker B2 (audit 2026-08-06, defects D-04 through D-10) is the reason steps 4 and 5 look the
 * way they do; before plan 13-10 this saga reported success for tenants nobody could log into.
 */
@Service
public class ProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(ProvisioningService.class);

    private static final String TENANT_PROVISIONED_EVENT  = "TENANT_PROVISIONED";
    private static final String EXCHANGE                  = "platform.topic";
    private static final String ROUTING_KEY               = "platform.tenant.provisioned";

    /**
     * The role the first tenant admin is created with. Validated at auth-service against the
     * {@code roles} table since 13-06 (D-13), so a typo here is a 400 naming the code rather than a
     * permissionless account.
     */
    private static final String OWNER_ROLE_CODE = "OWNER";

    /**
     * Where a provision's one-time password lives between the original call and a replay, and for
     * how long.
     *
     * <p>It is NOT in the idempotency record. {@code DefaultIdempotencyService} is JPA-backed —
     * {@code platform_db.idempotency_keys.response_json}, a plain text column — and although the
     * row carries an {@code expires_at}, <b>nothing in this codebase ever reads it</b>: there is no
     * purge job in any service. Serialising the password into the stored result, which is what the
     * result record used to do, would therefore have written a plaintext credential into a
     * relational table and left it there indefinitely.
     *
     * <p>Redis with a hard TTL is the smallest store that satisfies both requirements: a replay
     * inside the window returns the same usable credential, and the credential really does stop
     * existing at the end of it. A replay after the window returns the tenant and the admin email
     * with a null password — correct, because the credential is one-time and the admin has been
     * forced to change it anyway (13-08).
     */
    private static final String TEMP_PASSWORD_KEY_PREFIX = "provisioning:temp-password:";
    private static final long   IDEMPOTENCY_TTL_SECONDS  = 3600L;

    private static final String KIND_TENANT_FEATURES = "tenant-features";
    private static final String KIND_BRANCH          = "branch";
    private static final String KIND_AUTH_TENANT     = "auth-tenant";
    private static final String KIND_ADMIN_USER      = "admin-user";

    private final TenantRepository tenantRepository;
    private final TenantFeatureRepository featureRepository;
    private final TierFeatureDefaults tierFeatureDefaults;
    private final AuthInternalClient authClient;
    private final UserInternalClient userClient;
    private final FinanceInternalClient financeClient;
    private final EventPublisher eventPublisher;
    private final IdempotencyService idempotencyService;
    private final TenantContext tenantContext;
    private final StringRedisTemplate redis;

    /**
     * D-09. The key is {@code restaurantos.provisioning.seed-coa.enabled} — the prefix
     * application.yml has always declared and this service actually binds. It was previously read
     * unprefixed, so the {@code @Value} bound nothing and the default of {@code true} won in every
     * deployment regardless of what the operator set. An unbound flag whose default is {@code true}
     * is indistinguishable from a bound one until somebody sets it false, which is why this went
     * unnoticed; {@code ProvisioningSagaIT} therefore asserts the BEHAVIOUR at both values rather
     * than the presence of the annotation.
     */
    @Value("${restaurantos.provisioning.seed-coa.enabled:true}")
    private boolean seedCoaEnabled;

    public ProvisioningService(
            TenantRepository tenantRepository,
            TenantFeatureRepository featureRepository,
            TierFeatureDefaults tierFeatureDefaults,
            AuthInternalClient authClient,
            UserInternalClient userClient,
            FinanceInternalClient financeClient,
            EventPublisher eventPublisher,
            IdempotencyService idempotencyService,
            TenantContext tenantContext,
            StringRedisTemplate redis) {
        this.tenantRepository = tenantRepository;
        this.featureRepository = featureRepository;
        this.tierFeatureDefaults = tierFeatureDefaults;
        this.authClient = authClient;
        this.userClient = userClient;
        this.financeClient = financeClient;
        this.eventPublisher = eventPublisher;
        this.idempotencyService = idempotencyService;
        this.tenantContext = tenantContext;
        this.redis = redis;
    }

    /**
     * Execute the provisioning saga. Idempotent — repeated calls with the same
     * idempotency key are no-ops; the stored result is returned.
     */
    @Transactional(noRollbackFor = ProvisioningException.class)
    public ProvisionResult provision(String idempotencyKey, String brandName, String adminEmail, String tier) {
        // Idempotency guard
        String hash = hash(brandName + adminEmail + tier);
        var existing = idempotencyService.getCompletedResponse(idempotencyKey);
        if (existing.isPresent()) {
            return ProvisionResult.fromJson(existing.get())
                .withTempPassword(readTempPassword(idempotencyKey));
        }
        if (!idempotencyService.checkAndLock(idempotencyKey, hash, (int) IDEMPOTENCY_TTL_SECONDS)) {
            throw new IllegalStateException("Idempotency key in-flight: " + idempotencyKey);
        }

        // Step 1: persist PENDING_SETUP tenant
        // ID is generated by @GeneratedValue(UUID) on persist() — do NOT set manually here,
        // as that would cause Spring Data to call merge() instead of persist(), leading to
        // StaleObjectStateException when Hibernate issues an UPDATE for a non-existent row.
        TenantEntity tenant = new TenantEntity();
        tenant.setSlug(slugify(brandName));
        tenant.setBrandName(brandName);
        tenant.setStatus(TenantStatus.PENDING_SETUP);
        tenant.setTier(TierType.valueOf(tier.toUpperCase()));
        applyTierLimits(tenant);
        tenantRepository.save(tenant);

        UUID tenantId = tenant.getId();
        String slug = tenant.getSlug();
        List<CompensationStep> compensation = new ArrayList<>();

        try {
            // Step 2: seed feature flags
            Map<String, Boolean> defaults = tierFeatureDefaults.defaultsFor(tier.toUpperCase());
            List<TenantFeatureEntity> features = new ArrayList<>();
            for (Map.Entry<String, Boolean> entry : defaults.entrySet()) {
                TenantFeatureEntity f = new TenantFeatureEntity();
                f.setTenantId(tenantId);
                f.setFeatureCode(entry.getKey());
                f.setEnabled(entry.getValue());
                features.add(f);
            }
            featureRepository.saveAll(features);
            compensation.add(new CompensationStep(KIND_TENANT_FEATURES, tenantId.toString(),
                () -> featureRepository.deleteAllByTenantId(tenantId)));

            // Step 3: create the headquarters branch.
            // isHq is sent explicitly: PermissionResolver no longer uses it to pick a default branch
            // (13-02 replaced that with the primary-assignment flag), but it still drives every
            // branch-scoped report and the branch switcher, so an HQ persisted as isHq=false is a
            // tenant whose head office is invisible as such (D-07). No address is sent, because
            // InternalCreateBranchRequest declares no address field and the old one was dropped.
            UUID branchId = requireBranchId(
                userClient.createBranch(new UserInternalClient.CreateBranchRequest(
                    tenantId, brandName + " HQ", true)),
                tenantId);
            compensation.add(new CompensationStep(KIND_BRANCH, branchId.toString(),
                () -> userClient.deactivateBranch(branchId, tenantId)));

            // Step 4: register the auth-side tenant row (D-04). Login resolves a tenant by slug and
            // nothing in application code wrote this row before 13-06 — without it the admin
            // created in step 5 has no tenant to log into. It runs BEFORE step 5 so a slug
            // collision fails while the only thing to undo is a branch.
            authClient.registerTenant(
                new AuthInternalClient.RegisterTenantRequest(tenantId, slug, brandName));
            compensation.add(new CompensationStep(KIND_AUTH_TENANT, tenantId.toString(),
                () -> authClient.setTenantStatus(tenantId,
                    new AuthInternalClient.TenantStatusRequest(
                        TenantStatus.PROVISIONING_FAILED.name()))));

            // Step 5: provision the admin user AND its OWNER assignment at the real branch (D-05).
            // The branch id and role code are what make the account usable: auth-service writes the
            // user and the user_branch_roles row in one transaction, and without that row
            // PermissionResolver refuses the login with "User has no active branch assignments" —
            // the single defect that made every provisioned tenant a locked-out tenant.
            var adminData = requireAdminData(
                authClient.provisionAdmin(tenantId, new AuthInternalClient.ProvisionAdminRequest(
                    adminEmail, branchId, OWNER_ROLE_CODE, null)),
                tenantId);
            String tempPassword = adminData.tempPassword();
            UUID adminUserId = adminData.userId();
            compensation.add(new CompensationStep(KIND_ADMIN_USER, adminUserId.toString(),
                () -> authClient.revokeBranchRole(adminUserId, tenantId, branchId, OWNER_ROLE_CODE)));

            // Step 6: seed Chart of Accounts (required — a failure here must abort the saga,
            // same as Steps 3-5; the guard is an emergency kill-switch, not a license to swallow a
            // failure. Exceptions propagate to the outer catch below, which marks the tenant
            // PROVISIONING_FAILED and runs compensation.)
            if (seedCoaEnabled) {
                financeClient.seedCoa(tenantId);
            }

            // Step 7: mark ACTIVE + publish outbox event
            tenant.setStatus(TenantStatus.ACTIVE);
            tenantRepository.save(tenant);

            // DomainEventPublisher requires TenantContext; set it to the new tenant for outbox insert
            tenantContext.set(tenantId, null, null, null);
            try {
                // branchId here is the event's aggregate id (event_outbox.branch_id). It is now the
                // real branch row: before this plan it was a UUID.randomUUID() that no consumer
                // could ever correlate against.
                eventPublisher.publish(EXCHANGE, ROUTING_KEY, TENANT_PROVISIONED_EVENT, branchId,
                    Map.of("tenantId", tenantId.toString(), "adminEmail", adminEmail, "tier", tier, "slug", slug));
            } finally {
                tenantContext.clear();
            }

            var result = new ProvisionResult(tenantId, slug, adminEmail, tempPassword);
            // Two stores on purpose. The durable idempotency record holds the identifiers only —
            // toJson() cannot emit the password, structurally. The password goes to Redis under a
            // TTL, so a replay inside the window returns the same usable credential and the
            // credential stops existing at the end of it. See TEMP_PASSWORD_KEY_PREFIX.
            writeTempPassword(idempotencyKey, tempPassword);
            idempotencyService.markComplete(idempotencyKey, result.toJson());
            return result;

        } catch (Exception ex) {
            log.error("[saga] Provisioning failed for tenant {}: {}", tenantId, ex.getMessage(), ex);
            tenant.setStatus(TenantStatus.PROVISIONING_FAILED);
            tenantRepository.save(tenant);
            List<ManualRepairRecord> repairs = compensate(tenantId, compensation);
            throw new ProvisioningException(
                "Provisioning saga failed for " + brandName + ": " + ex.getMessage(), ex, repairs);
        }
    }

    /**
     * Run every completed step's compensating action in reverse, and turn each failure into a named
     * repair record.
     *
     * <p>The point of the record is what the previous {@code log.warn("manual cleanup needed")}
     * stubs lacked: an operator reading it knows exactly which row in which service to touch. A
     * compensation failure is not allowed to abort the remaining compensations either — the branch
     * still has to be cleaned up even when revoking the admin's role failed.
     */
    private List<ManualRepairRecord> compensate(UUID tenantId, List<CompensationStep> compensation) {
        List<ManualRepairRecord> repairs = new ArrayList<>();
        for (int i = compensation.size() - 1; i >= 0; i--) {
            CompensationStep step = compensation.get(i);
            try {
                step.action().run();
                log.info("[saga][compensated] tenantId={} resourceKind={} resourceId={}",
                    tenantId, step.resourceKind(), step.resourceId());
            } catch (Exception ce) {
                ManualRepairRecord repair = new ManualRepairRecord(
                    tenantId, step.resourceKind(), step.resourceId(),
                    ce.getClass().getSimpleName() + ": " + ce.getMessage());
                repairs.add(repair);
                log.error("[saga][MANUAL-REPAIR-REQUIRED] tenantId={} resourceKind={} resourceId={} reason={}",
                    repair.tenantId(), repair.resourceKind(), repair.resourceId(), repair.reason(), ce);
            }
        }
        return List.copyOf(repairs);
    }

    // --- Retry: re-run a PROVISIONING_FAILED tenant ---

    /**
     * Re-run a PROVISIONING_FAILED tenant. Requires the admin email, because the saga now creates a
     * real account from it.
     *
     * <p><b>This method has no caller and no endpoint</b> — it is reachable only from a future
     * controller. It is left in place, but its previous form passed the literal string
     * {@code "(retry)"} as the admin email, which the pre-13-06 provision-admin (which validated
     * nothing beyond non-blankness) would have happily turned into an account named {@code (retry)}
     * that nobody could ever log in as. Requiring the caller to supply the address turns that into
     * a compile error rather than a silently-broken tenant.
     *
     * <p>A second, unfixed defect is recorded rather than papered over: {@link #provision} always
     * constructs a NEW {@code TenantEntity}, so this method produces a second tenant row (with a
     * {@code -1}-suffixed slug) instead of re-driving the existing one. Whoever exposes retry must
     * fix that first; it is outside plan 13-10's scope and there is nothing to regress in the
     * meantime.
     */
    @Transactional
    public ProvisionResult retry(UUID tenantId, String adminEmail) {
        TenantEntity tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));
        if (tenant.getStatus() != TenantStatus.PROVISIONING_FAILED) {
            throw new IllegalStateException("Tenant is not in PROVISIONING_FAILED state: " + tenant.getStatus());
        }
        if (adminEmail == null || adminEmail.isBlank()) {
            throw new IllegalArgumentException("An admin email is required to retry provisioning " + tenantId);
        }
        // Reset to PENDING_SETUP and retry — delete existing feature records first to avoid duplicates
        featureRepository.deleteAllByTenantId(tenantId);
        tenant.setStatus(TenantStatus.PENDING_SETUP);
        tenantRepository.save(tenant);
        // Re-execute saga with a fresh idempotency key
        return provision("retry:" + tenantId + ":" + System.currentTimeMillis(),
            tenant.getBrandName(), adminEmail, tenant.getTier().name());
    }

    // --- Helpers ---

    private void applyTierLimits(TenantEntity t) {
        switch (t.getTier()) {
            case STARTER    -> { t.setMaxBranches(1);  t.setMaxUsers(10); t.setStorageGb(5);   t.setNlqQuota(1000); }
            case GROWTH     -> { t.setMaxBranches(5);  t.setMaxUsers(50); t.setStorageGb(20);  t.setNlqQuota(5000); }
            case ENTERPRISE -> { t.setMaxBranches(50); t.setMaxUsers(500); t.setStorageGb(100); t.setNlqQuota(50000); }
            case CUSTOM     -> { t.setMaxBranches(999); t.setMaxUsers(9999); t.setStorageGb(999); t.setNlqQuota(999999); }
        }
    }

    private static final Pattern NON_ALPHANUMERIC = Pattern.compile("[^a-z0-9]+");

    private String slugify(String name) {
        String normalized = Normalizer.normalize(name.toLowerCase(Locale.ROOT), Normalizer.Form.NFD);
        String slug = NON_ALPHANUMERIC.matcher(normalized).replaceAll("-");
        slug = slug.replaceAll("^-|-$", "");
        // Ensure unique slug
        String base = slug;
        int attempt = 0;
        while (tenantRepository.existsBySlug(slug)) {
            slug = base + "-" + (++attempt);
        }
        return slug;
    }

    private void writeTempPassword(String idempotencyKey, String tempPassword) {
        redis.opsForValue().set(TEMP_PASSWORD_KEY_PREFIX + idempotencyKey, tempPassword,
            java.time.Duration.ofSeconds(IDEMPOTENCY_TTL_SECONDS));
    }

    /** Null once the TTL has elapsed — see {@link #TEMP_PASSWORD_KEY_PREFIX}. */
    private String readTempPassword(String idempotencyKey) {
        return redis.opsForValue().get(TEMP_PASSWORD_KEY_PREFIX + idempotencyKey);
    }

    /**
     * D-06. There is deliberately <b>no fallback</b> here.
     *
     * <p>The deleted one returned {@code UUID.randomUUID()} with a comment saying the saga could
     * continue because the branch had been created. It could not. That fabricated identifier became
     * the aggregate id of the TENANT_PROVISIONED event, so every consumer downstream correlated
     * against a branch that does not exist — and because the branch response's real shape is a bare
     * {@code {"branchId"}} while the parse looked for {@code {"data":{"id"}}}, the fallback was not
     * an edge case: it fired on every single provision. Failing here costs one tenant its
     * provisioning attempt; the fallback cost the event stream its integrity, silently.
     */
    private UUID requireBranchId(UserInternalClient.CreateBranchResponse response, UUID tenantId) {
        if (response == null || response.branchId() == null) {
            throw new IllegalStateException(
                "user-service returned no branch id for tenant " + tenantId
                    + " — aborting provisioning rather than substituting one");
        }
        return response.branchId();
    }

    /**
     * A provision that cannot report the credential it generated is a tenant nobody can log into,
     * so the absent case aborts rather than returning a placeholder. The old code returned the
     * literal string {@code "(see admin)"}, which the controller then discarded anyway.
     */
    private AuthInternalClient.ProvisionAdminData requireAdminData(
            AuthInternalClient.ProvisionAdminResponse response, UUID tenantId) {
        AuthInternalClient.ProvisionAdminData data = response != null ? response.data() : null;
        if (data == null || data.userId() == null
                || data.tempPassword() == null || data.tempPassword().isBlank()) {
            throw new IllegalStateException(
                "auth-service returned no usable admin credential for tenant " + tenantId
                    + " — aborting provisioning rather than reporting an unusable tenant as ready");
        }
        return data;
    }

    private String hash(String input) {
        try {
            var md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            var sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(input.hashCode());
        }
    }

    @FunctionalInterface
    interface CompensationAction {
        void run() throws Exception;
    }

    /**
     * A completed saga step paired with how to undo it, and — crucially — with enough identity to
     * name what was left behind if the undo fails.
     */
    record CompensationStep(String resourceKind, String resourceId, CompensationAction action) {}

    /**
     * What a failed compensation leaves for an operator: the tenant, the kind of resource, its id,
     * and why the automatic cleanup did not happen.
     *
     * <p>This is the whole difference between "manual cleanup needed" and a manual-repair path. It
     * is logged at ERROR under the fixed marker {@code [saga][MANUAL-REPAIR-REQUIRED]} — greppable
     * and alertable — and carried on the thrown exception so a caller (and the test suite) can
     * assert on it rather than scrape a log.
     *
     * <p>It is not persisted to a table: this plan adds no migration, and platform_db has no
     * repair-log table. That is a named limitation, not an oversight — see 13-10-SUMMARY.
     */
    public record ManualRepairRecord(UUID tenantId, String resourceKind, String resourceId, String reason) {}

    // --- Result types ---

    /**
     * The saga's result, including the one-time temporary password for the new admin.
     *
     * <p><b>{@code tempPassword} is credential material.</b> It is returned to the calling
     * SuperAdmin and must be transmitted to the tenant admin out of band; the admin is forced to
     * replace it on first login (13-08). It is never logged, never written to platform_db, and
     * never placed in an event payload.
     *
     * <p><b>{@link #toJson()} cannot emit it.</b> The component carries {@code @JsonIgnore}, so the
     * exclusion is structural rather than a rule someone has to remember: the durable idempotency
     * record in {@code platform_db.idempotency_keys} holds only the identifiers. The credential is
     * held separately in Redis under a one-hour TTL — see
     * {@link ProvisioningService#TEMP_PASSWORD_KEY_PREFIX} for why that split exists and what the
     * remaining exposure is. A replay after the TTL therefore yields a null password, which is
     * correct: a one-time credential that has aged out is not one the caller should still receive.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ProvisionResult(UUID tenantId, String slug, String adminEmail,
                                  @JsonIgnore String tempPassword) {

        public ProvisionResult withTempPassword(String replacement) {
            return new ProvisionResult(tenantId, slug, adminEmail, replacement);
        }

        private static final ObjectMapper JSON = new ObjectMapper();

        public String toJson() {
            try {
                return JSON.writeValueAsString(this);
            } catch (Exception e) {
                // Deliberately does not echo the value being serialized: it contains the password.
                throw new IllegalStateException("Failed to serialize ProvisionResult for tenant " + tenantId, e);
            }
        }

        public static ProvisionResult fromJson(String json) {
            try {
                return JSON.readValue(json, ProvisionResult.class);
            } catch (Exception e) {
                throw new IllegalStateException("Failed to read a stored ProvisionResult", e);
            }
        }

        /** Never print the password, not even by accident. */
        @Override
        public String toString() {
            return "ProvisionResult[tenantId=" + tenantId + ", slug=" + slug
                + ", adminEmail=" + adminEmail + ", tempPassword=<redacted>]";
        }
    }

    public static class ProvisioningException extends RuntimeException {

        private final transient List<ManualRepairRecord> manualRepairs;

        public ProvisioningException(String message, Throwable cause) {
            this(message, cause, List.of());
        }

        public ProvisioningException(String message, Throwable cause, List<ManualRepairRecord> manualRepairs) {
            super(message, cause);
            this.manualRepairs = manualRepairs == null ? List.of() : List.copyOf(manualRepairs);
        }

        /** Resources a compensating action failed to clean up, each named precisely. Never null. */
        public List<ManualRepairRecord> manualRepairs() {
            return manualRepairs;
        }
    }
}
