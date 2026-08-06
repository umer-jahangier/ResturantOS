package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.AuthTenantEntity;
import io.restaurantos.auth.repository.AuthTenantRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Writes the {@code auth_tenants} row that {@code AuthServiceImpl.login} resolves a tenant slug
 * against — the first half of blocker B2 (D-04).
 *
 * <p>Nothing in application code wrote this table before. Its only writer was a seed changeset, so
 * every tenant created through {@code POST /api/v1/platform/tenants} was missing the row login needs
 * and could never authenticate, no matter how correct the rest of provisioning was.
 *
 * <h2>Why this service sets no tenant GUC</h2>
 *
 * <p>Every other write path in auth-service sets {@code app.current_tenant_id} before it touches the
 * database, and omitting it has already been the cause of two silent failures in this phase
 * ({@code BranchRoleAdminService.assign}, {@code GET /internal/auth/users/&#123;id&#125;/permissions};
 * see 13-02). This service is the deliberate exception: {@code auth_tenants} is the pre-tenant
 * -context lookup — login has to resolve a slug to a tenant id BEFORE any tenant context can exist —
 * so the table is not row-level-security scoped and there is no GUC to set. Verified against the
 * live dev database, where {@code auth_user} is {@code NOSUPERUSER NOBYPASSRLS}:
 * {@code auth_tenants.relrowsecurity = false, relforcerowsecurity = false}. The premise is pinned by
 * {@code AuthTenantProvisioningIT.authTenants_isNotRowLevelSecurityScoped}, so if RLS is ever
 * enabled on this table the test fails rather than this comment quietly becoming a lie.
 */
@Service
public class AuthTenantProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(AuthTenantProvisioningService.class);

    /** The one value {@code AuthServiceImpl.login} accepts. Everything else refuses a login. */
    public static final String STATUS_ACTIVE = "ACTIVE";

    /** Matches what {@code ProvisioningService.slugify} produces, and what the column can hold. */
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9][a-z0-9-]{0,99}$");

    private final AuthTenantRepository authTenantRepository;

    public AuthTenantProvisioningService(AuthTenantRepository authTenantRepository) {
        this.authTenantRepository = authTenantRepository;
    }

    /**
     * Create or update the tenant row, keyed on the tenant id.
     *
     * <p>Genuinely idempotent, because the provisioning saga retries this step: a replay updates the
     * existing row and returns the same success rather than creating a second row or failing on the
     * unique index. The status is set to ACTIVE only on creation — a retry must not undo a
     * suspension, which is the platform's primary non-payment lever, and {@code setStatus} is the
     * only way the status changes afterwards.
     *
     * @throws StateInvalidException if the slug is malformed, or is already held by a DIFFERENT
     *                               tenant. The collision is detected explicitly rather than left to
     *                               the unique index, so 13-10's saga receives a mappable
     *                               application error instead of a driver-level integrity violation
     *                               it cannot tell apart from any other constraint failure.
     */
    @Transactional
    public RegisterResult register(UUID tenantId, String rawSlug, String name) {
        if (tenantId == null) {
            throw new StateInvalidException("A tenant id is required to register an auth tenant");
        }
        String slug = normaliseSlug(rawSlug);

        Optional<AuthTenantEntity> bySlug = authTenantRepository.findBySlug(slug);
        if (bySlug.isPresent() && !bySlug.get().getId().equals(tenantId)) {
            throw new StateInvalidException(
                "Slug '" + slug + "' is already held by tenant " + bySlug.get().getId());
        }

        Instant now = Instant.now();
        Optional<AuthTenantEntity> existing = authTenantRepository.findById(tenantId);
        AuthTenantEntity tenant = existing.orElseGet(AuthTenantEntity::new);
        boolean created = existing.isEmpty();

        if (created) {
            tenant.setId(tenantId);
            tenant.setStatus(STATUS_ACTIVE);
            // The entity declares both timestamps non-null and has no auditing callback of any kind,
            // so neither is populated for us. The column defaults only apply to SQL that omits the
            // column, which a JPA insert never does.
            tenant.setCreatedAt(now);
        }
        tenant.setSlug(slug);
        tenant.setName(name);
        tenant.setUpdatedAt(now);
        authTenantRepository.save(tenant);

        log.info("auth_tenants {} for tenant {} slug '{}' (status {})",
            created ? "created" : "updated", tenantId, slug, tenant.getStatus());
        return new RegisterResult(tenantId, slug, tenant.getName(), tenant.getStatus(), created);
    }

    /**
     * Apply a platform tenant status to the auth-side row.
     *
     * @throws ResourceNotFoundException if no row exists for the tenant — a status change for a
     *                                   tenant that was never registered is a saga ordering bug, and
     *                                   silently creating the row would hide it.
     * @throws StateInvalidException     if the status is not one the platform service can produce.
     */
    @Transactional
    public StatusResult setStatus(UUID tenantId, String platformStatus) {
        AuthTenantEntity tenant = authTenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No auth tenant registered for " + tenantId));

        String authStatus = toAuthStatus(platformStatus);
        tenant.setStatus(authStatus);
        tenant.setUpdatedAt(Instant.now());
        authTenantRepository.save(tenant);

        boolean loginAllowed = STATUS_ACTIVE.equals(authStatus);
        log.info("auth_tenants status for tenant {} set to {} (loginAllowed={})",
            tenantId, authStatus, loginAllowed);
        return new StatusResult(tenantId, tenant.getSlug(), authStatus, loginAllowed);
    }

    /**
     * The single place the platform status vocabulary is mapped onto the auth one.
     *
     * <p>platform-admin-service has six statuses ({@code TenantEntity.TenantStatus}); {@code
     * auth_tenants} has exactly two meanings, because {@code AuthServiceImpl.login} asks one
     * question of it: {@code "ACTIVE".equals(status)}. The value is carried across verbatim so an
     * operator reading {@code auth_db} can still see WHY a tenant cannot log in — but the mapping is
     * a closed set, and a status this service has never heard of is rejected rather than passed
     * through. Passing an unknown value through would be harmless today and catastrophic the day
     * someone adds a platform status whose name happens to be ACTIVE-like; rejecting it makes the
     * addition of a seventh status a compile-here, fail-loudly event instead of a silent one.
     */
    static String toAuthStatus(String platformStatus) {
        String value = platformStatus == null ? "" : platformStatus.trim().toUpperCase(Locale.ROOT);
        return switch (value) {
            case "ACTIVE" -> STATUS_ACTIVE;
            // Every one of these must be a value login refuses, and each is <= 20 chars because that
            // is what the column holds.
            case "PENDING_SETUP", "SUSPENDED", "CANCELLED", "PURGED", "PROVISIONING_FAILED" -> value;
            default -> throw new StateInvalidException(
                "Unknown tenant status: " + platformStatus
                    + " (expected one of ACTIVE, PENDING_SETUP, SUSPENDED, CANCELLED, PURGED, "
                    + "PROVISIONING_FAILED)");
        };
    }

    /**
     * Lower-cased and trimmed, because login matches the slug exactly and the platform's own
     * {@code slugify} already emits lower case — so normalising here is a no-op for real callers and
     * a guard against a hand-written one registering {@code "Acme"} and then finding that nobody can
     * log in at {@code acme}.
     */
    private static String normaliseSlug(String rawSlug) {
        String slug = rawSlug == null ? "" : rawSlug.trim().toLowerCase(Locale.ROOT);
        if (!SLUG.matcher(slug).matches()) {
            throw new StateInvalidException(
                "Invalid tenant slug '" + rawSlug + "': expected 1-100 characters of a-z, 0-9 or "
                    + "'-', starting with a letter or digit");
        }
        return slug;
    }

    public record RegisterResult(UUID tenantId, String slug, String name, String status, boolean created) {}

    public record StatusResult(UUID tenantId, String slug, String status, boolean loginAllowed) {}
}
