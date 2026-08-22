package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuditPlatformClient;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.AuditCoverage;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.CoverageItem;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.PlatformAuditEvent;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.PlatformAuditPage;
import io.restaurantos.platform.dto.PlatformAuditViewDtos.TenantReadFailure;
import io.restaurantos.platform.repository.TenantAnalyticsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The cross-tenant audit and security trail, as the SuperAdmin console reads it.
 *
 * <h2>What this service is, in one sentence</h2>
 *
 * <p>It resolves a scope of tenants from {@code platform_db.tenants}, asks audit-service to read
 * each of them under its own row-level-security policy, and attributes the merged rows back to
 * tenants the console can name. It writes nothing, anywhere.
 *
 * <h2>The two halves of "platform-wide audit", and why only one of them is here</h2>
 *
 * <ul>
 *   <li><b>Tenant-side actions</b> — logins, failed logins, password changes and admin resets, user
 *       create/update/deactivate, role grants and revokes, voids, refunds, till and period closes.
 *       All of it is in {@code audit_db.audit_events}, all of it is tenant-scoped, and this service
 *       reads it. {@code AuditEventCatalog.ALWAYS_AUDIT_SOURCES} additionally guarantees that
 *       <i>every</i> event published by auth-service and platform-admin-service is audited
 *       regardless of type, so administrative actions against a tenant land there by construction
 *       rather than by anyone remembering to add them.</li>
 *   <li><b>Platform-operator actions</b> — a SuperAdmin logging in to the control plane, and
 *       operations that touch no tenant event. Those do NOT land in {@code audit_events}, and this
 *       service does not pretend otherwise. {@code audit_events.tenant_id} is NOT NULL and a
 *       platform login has no tenant; {@code platform_users} carries no {@code last_login_at} and
 *       no TOTP column. {@link #coverage()} states that rather than leaving a tile that renders
 *       empty and reads like a quiet week.</li>
 * </ul>
 *
 * <h2>Impersonation is deliberately not duplicated here</h2>
 *
 * <p>The impersonation register already exists and is already cross-tenant:
 * {@code GET /api/v1/platform/impersonations} over {@code platform_db.impersonation_log}, with
 * tenant, admin and date filters and a status derived from {@code expires_at}. Re-serving it from a
 * second endpoint would produce two answers to one question, which on an accountability surface is
 * strictly worse than one. It is named in {@link #coverage()} so a console knows where it lives.
 * The two views join on {@code audit_events.impersonated_by}, which carries the platform
 * administrator's id into every action taken under an impersonated session.
 */
@Service
public class PlatformAuditTrailService {

    private static final Logger log = LoggerFactory.getLogger(PlatformAuditTrailService.class);

    /**
     * The login actions, as {@code AuditEventCatalog.MUST_AUDIT} declares them.
     *
     * <p>Copied as constants rather than imported from the catalog because the catalog is a
     * {@code Set<String>} of every auditable action and there is no per-action constant to import.
     * {@code AuditAllowListClosureTest} in shared-lib pins those names against the actual
     * publishers, so a rename breaks that build before it can silently empty this filter.
     */
    public static final String LOGIN_SUCCEEDED = "USER_LOGIN_SUCCEEDED";
    public static final String LOGIN_FAILED = "USER_LOGIN_FAILED";

    /** Actions that change who can do what. The "permission changes" half of a security review. */
    public static final Set<String> AUTHORITY_ACTIONS = Set.of(
            "ROLE_GRANTED", "ROLE_REVOKED",
            "USER_CREATED", "USER_UPDATED", "USER_DEACTIVATED", "USER_REACTIVATED",
            "PASSWORD_CHANGED", "PASSWORD_RESET_REQUESTED", "ADMIN_PASSWORD_RESET",
            "IMPERSONATION_STARTED");

    private final AuditPlatformClient auditClient;
    private final TenantAnalyticsRepository tenantRepository;

    public PlatformAuditTrailService(AuditPlatformClient auditClient,
                                     TenantAnalyticsRepository tenantRepository) {
        this.auditClient = auditClient;
        this.tenantRepository = tenantRepository;
    }

    /**
     * One page of the cross-tenant trail.
     *
     * @param tenantId when non-null, restricts the scope to one tenant. Unknown tenant ids are
     *                 refused rather than quietly widened to everything — the failure mode of a
     *                 filter that silently stops filtering, on this screen, is showing an operator
     *                 every tenant's log when they asked for one.
     */
    public PlatformAuditPage search(UUID tenantId,
                                    List<String> actions,
                                    String resourceType,
                                    UUID actorId,
                                    Instant from,
                                    Instant to,
                                    String zone,
                                    int page,
                                    int size,
                                    boolean includeFacets) {

        Map<UUID, TenantIdentity> identities = tenantIdentities();

        List<UUID> scope;
        if (tenantId != null) {
            if (!identities.containsKey(tenantId)) {
                throw new IllegalArgumentException("Unknown tenant: " + tenantId);
            }
            scope = List.of(tenantId);
        } else {
            scope = tenantRepository.findAllTenantIds();
        }

        if (scope.isEmpty()) {
            // No tenants at all is a real state, and an empty page is the honest answer to it — but
            // it is reported with tenantsInScope=0 so a screen can say "there are no tenants"
            // rather than "this tenant has no audit history".
            return new PlatformAuditPage(List.of(), 0L, true, 0, 0, List.of(),
                    from, to, zone, page, size, includeFacets ? List.of() : null, false);
        }

        AuditPlatformClient.SearchResponse response = auditClient.search(
                new AuditPlatformClient.SearchRequest(
                        scope, actions, resourceType, actorId, from, to, page, size, includeFacets));

        AuditPlatformClient.SearchData data = response == null ? null : response.data();
        if (data == null) {
            // audit-service answered with a body this client cannot read. That is not an empty log
            // and must not be served as one — the same posture as UsageMeter.unreadable.
            throw new IllegalStateException(
                    "audit-service returned no readable body for the platform audit search");
        }

        List<PlatformAuditEvent> events = new ArrayList<>();
        for (AuditPlatformClient.AuditEvent event : nullSafe(data.events())) {
            TenantIdentity identity = identities.get(event.tenantId());
            events.add(new PlatformAuditEvent(
                    event.id(),
                    event.tenantId(),
                    identity == null ? null : identity.slug(),
                    identity == null ? null : identity.brandName(),
                    event.occurredAt(),
                    event.action(),
                    event.resourceType(),
                    event.resourceId(),
                    event.branchId(),
                    event.userId(),
                    event.impersonatedBy(),
                    event.ipAddress(),
                    event.userAgent(),
                    event.metadata()));
        }

        List<TenantReadFailure> failures = new ArrayList<>();
        for (AuditPlatformClient.TenantReadFailure failure : nullSafe(data.tenantsFailed())) {
            TenantIdentity identity = identities.get(failure.tenantId());
            failures.add(new TenantReadFailure(
                    failure.tenantId(), identity == null ? null : identity.slug(), failure.reason()));
        }
        if (!failures.isEmpty()) {
            log.warn("[platform-audit] {} of {} tenants could not be read; the total is reported as "
                    + "incomplete rather than as a fact", failures.size(), scope.size());
        }

        return new PlatformAuditPage(
                List.copyOf(events),
                data.totalCount(),
                data.totalCountComplete(),
                scope.size(),
                nullSafe(data.tenantsRead()).size(),
                List.copyOf(failures),
                data.from(),
                data.to(),
                zone,
                data.page(),
                data.size(),
                data.actionsPresent(),
                data.scanTruncated());
    }

    /**
     * Login history — the same read, with the action filter fixed to the two login actions.
     *
     * <p>A dedicated method rather than "pass the actions yourself" because the two names have to
     * match the catalog exactly and a typo produces an empty screen, not an error. On an audit
     * surface an empty screen is read as "nobody logged in", which is a materially wrong answer to
     * give a security review.
     *
     * @param failedOnly narrows to failed attempts — the shape a brute-force review actually wants.
     */
    public PlatformAuditPage loginHistory(UUID tenantId,
                                          UUID actorId,
                                          boolean failedOnly,
                                          Instant from,
                                          Instant to,
                                          String zone,
                                          int page,
                                          int size) {
        List<String> actions = failedOnly
                ? List.of(LOGIN_FAILED)
                : List.of(LOGIN_SUCCEEDED, LOGIN_FAILED);
        return search(tenantId, actions, null, actorId, from, to, zone, page, size, false);
    }

    /**
     * Permission and account changes across tenants — the "security" half of the surface.
     *
     * <p>{@code IMPERSONATION_STARTED} is in the set on purpose. It is the moment a platform
     * operator acquires a tenant identity, and reading a role grant without seeing who was wearing
     * whose account at the time is how an accountability trail becomes a list of names.
     */
    public PlatformAuditPage authorityChanges(UUID tenantId,
                                              UUID actorId,
                                              Instant from,
                                              Instant to,
                                              String zone,
                                              int page,
                                              int size) {
        return search(tenantId, List.copyOf(AUTHORITY_ACTIONS), null, actorId,
                from, to, zone, page, size, true);
    }

    /**
     * What the trail covers, stated rather than implied.
     *
     * <p>Everything below is a fact about this codebase, established from the schema and the
     * catalog, and none of it is aspirational. A console that renders this next to the grid stops
     * an operator concluding that an absent category never happened.
     */
    public AuditCoverage coverage() {
        List<CoverageItem> captured = List.of(
                new CoverageItem("Logins and failed logins",
                        "audit_events rows with action USER_LOGIN_SUCCEEDED / USER_LOGIN_FAILED, "
                            + "carrying user_id, tenant_id, branch_id, ip_address, user_agent and "
                            + "occurred_at. Attempt-level, not a summary"),
                new CoverageItem("Account and permission changes",
                        "USER_CREATED, USER_UPDATED, USER_DEACTIVATED, USER_REACTIVATED, "
                            + "ROLE_GRANTED, ROLE_REVOKED, PASSWORD_CHANGED, "
                            + "PASSWORD_RESET_REQUESTED, ADMIN_PASSWORD_RESET"),
                new CoverageItem("Administrative actions against a tenant",
                        "every event published by auth-service and platform-admin-service is "
                            + "audited regardless of type — AuditEventCatalog.ALWAYS_AUDIT_SOURCES "
                            + "— so this is guaranteed by construction, not by remembering"),
                new CoverageItem("Actions taken under impersonation",
                        "audit_events.impersonated_by carries the real platform administrator "
                            + "alongside the account the system saw, so an action is attributable to "
                            + "both. The register of the sessions themselves is a separate, already "
                            + "cross-tenant endpoint: GET /api/v1/platform/impersonations"),
                new CoverageItem("Money- and stock-relevant operator actions",
                        "ORDER_VOIDED, ORDER_REFUNDED, discount applied/removed, TILL_OPENED, "
                            + "TILL_CLOSED, TILL_REVIEWED, PERIOD_CLOSED, JOURNAL_POSTED, "
                            + "PO_APPROVED, AP_PAYMENT_PROCESSED, PAYROLL_RUN_APPROVED and PAID"));

        List<CoverageItem> notCaptured = List.of(
                new CoverageItem("SuperAdmin logins to the control plane",
                        "NOT in audit_events. audit_events.tenant_id is NOT NULL and a platform "
                            + "login has no tenant. platform_users carries no last_login_at column "
                            + "and no TOTP column, so neither a login history nor a second-factor "
                            + "state exists for platform operators anywhere in this product"),
                new CoverageItem("Tenant lifecycle transitions",
                        "suspend, reactivate, cancel and close publish no events and overwrite a "
                            + "single timestamp column each, so there is no transition history to "
                            + "audit — only the latest of each kind is recoverable from the tenant "
                            + "row"),
                new CoverageItem("Tier changes",
                        "TenantSubscriptionService.changeTier reconciles features and writes Redis "
                            + "but emits nothing, so a tier change leaves no event on this trail"),
                new CoverageItem("Reads",
                        "this is a log of actions, not of access. Nobody viewing a report, a payroll "
                            + "run or another user's record produces a row"));

        return new AuditCoverage(
                Instant.now(),
                captured,
                notCaptured,
                "audit_events is partitioned by month and AuditArchivalService DETACHes rather than "
                    + "drops, keeping up to 84 months. A detached partition keeps its own RLS "
                    + "policy, so age does not weaken isolation",
                "Append-only at three independent layers: the runtime role holds INSERT and SELECT "
                    + "only, a trigger raises on UPDATE and DELETE, and no service exposes a write "
                    + "surface. This console cannot edit the trail, and neither can the service "
                    + "that serves it");
    }

    /** {@code id -> (slug, brandName)} for every tenant, in one read of the local database. */
    private Map<UUID, TenantIdentity> tenantIdentities() {
        Map<UUID, TenantIdentity> identities = new LinkedHashMap<>();
        for (Object[] row : tenantRepository.findAllTenantIdentities()) {
            identities.put((UUID) row[0], new TenantIdentity((String) row[1], (String) row[2]));
        }
        return identities;
    }

    private record TenantIdentity(String slug, String brandName) {}

    private static <T> List<T> nullSafe(List<T> value) {
        return value == null ? List.of() : value;
    }
}
