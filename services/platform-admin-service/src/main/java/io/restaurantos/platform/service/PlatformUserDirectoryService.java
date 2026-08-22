package io.restaurantos.platform.service;

import feign.FeignException;
import io.restaurantos.platform.client.AuthUserDirectoryClient;
import io.restaurantos.platform.client.AuthUserDirectoryClient.StationAssignment;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserDetailData;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserPage;
import io.restaurantos.platform.client.AuthUserDirectoryClient.UserSummary;
import io.restaurantos.platform.dto.PlatformUserDtos.BranchRoleView;
import io.restaurantos.platform.dto.PlatformUserDtos.DirectoryScan;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformUserDetail;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformUserPage;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformUserRow;
import io.restaurantos.platform.dto.PlatformUserDtos.StationScopeView;
import io.restaurantos.platform.dto.PlatformUserDtos.TenantMembership;
import io.restaurantos.platform.dto.PlatformUserDtos.UnreachableTenant;
import io.restaurantos.platform.dto.PlatformUserDtos.UserActivity;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The cross-tenant user directory — "show me every user on the platform" (superadmin plan).
 *
 * <h2>The constraint that shapes everything below</h2>
 *
 * <p><b>There is no cross-tenant user query in this product, and there cannot be one without a new
 * database topology.</b> Established from source rather than assumed:
 *
 * <ul>
 *   <li>{@code users} lives in {@code auth_db}. {@code platform_db} holds ZERO grants in all 14
 *       tenant databases, and has only {@code plpgsql} installed — no {@code postgres_fdw}, no
 *       {@code dblink}. There is no SQL bridge at all (measured, {@code
 *       040-platform-db-rls-posture.xml}).</li>
 *   <li>{@code users} is FORCE ROW LEVEL SECURITY on {@code app.current_tenant_id} and
 *       {@code auth_user} is {@code NOSUPERUSER NOBYPASSRLS}, so even a shared connection would see
 *       one tenant at a time.</li>
 *   <li>The single door, {@code GET /internal/auth/users}, requires {@code X-Tenant-Id} and returns
 *       ONE tenant's page.</li>
 * </ul>
 *
 * <p>So a fleet-wide list is <b>N HTTP calls, one per tenant</b>. This class pays that cost
 * deliberately and reports it, rather than hiding it behind a response that looks like a query. Do
 * not "optimise" this into a SECURITY DEFINER function or a shared read role: that is the exact bug
 * that took auth-service down, and services here connect as a non-superuser belonging to no roles,
 * so a migration could not fix the ownership it would need anyway.
 *
 * <h2>How a page of the concatenation is served</h2>
 *
 * <p>The fleet list is the concatenation of each tenant's list, tenants in SLUG order (unique and
 * immutable — see {@code TenantRepository.findAllByOrderBySlugAsc} for why an unstable outer order
 * makes page 2 omit and repeat whole tenants). To serve page P:
 *
 * <ol>
 *   <li>resolve the candidate tenants and apply {@link #MAX_TENANT_FANOUT};</li>
 *   <li><b>probe each one</b> with {@code size=1} to learn its filtered total. This is the N in "N
 *       calls" and it is what makes {@code totalCount} a real number rather than a guess;</li>
 *   <li>walk the tenants in order, skipping whole ones whose total is below the offset, and fetch
 *       only the slices the requested window actually covers.</li>
 * </ol>
 *
 * <p>A tenant that fails its probe is recorded in {@link DirectoryScan#unreachable()}, its users are
 * omitted, and the total is <b>withheld entirely</b> — see {@link DirectoryScan}. Returning a
 * smaller number that looks complete is the D-38-16 violation the scan block exists to refuse.
 *
 * <h2>What this class deliberately does not do</h2>
 *
 * <p>It does not filter in memory. Search, status and role are all pushed to the producer's query,
 * because a page filtered after the fact carries a {@code totalCount} describing a different set
 * from its own rows, and the role predicate would otherwise be an N+1 across a service boundary
 * (the role lives in {@code user_branch_roles}, which only the detail endpoint returns).
 *
 * <p>It writes nothing. Every mutation lives in {@link PlatformUserAdminService}, where the audit
 * trail is.
 */
@Service
public class PlatformUserDirectoryService {

    private static final Logger log = LoggerFactory.getLogger(PlatformUserDirectoryService.class);

    /**
     * The largest number of tenants one directory request will fan out to.
     *
     * <p>A cap and not a rejection, because an operator asking for the fleet wants rows. What must
     * not happen silently is the scan stopping short: {@link DirectoryScan#truncated()} says it
     * did, the total is withheld, and the caller is told to narrow by tenant. Without a cap this
     * endpoint issues one HTTP call per tenant on a service that holds the control plane for every
     * restaurant on the platform, and a fleet of a thousand tenants would make a single page load a
     * thousand-call storm against auth-service.
     */
    public static final int MAX_TENANT_FANOUT = 100;

    /** Matches the producer's own cap ({@code UserLifecycleService.MAX_PAGE_SIZE}). */
    private static final int UPSTREAM_MAX_PAGE = 200;

    /** The largest page this endpoint serves. Same reasoning as the producer's cap. */
    public static final int MAX_PAGE_SIZE = 200;
    public static final int DEFAULT_PAGE_SIZE = 50;

    private final TenantRepository tenantRepository;
    private final AuthUserDirectoryClient users;

    public PlatformUserDirectoryService(TenantRepository tenantRepository,
                                        AuthUserDirectoryClient users) {
        this.tenantRepository = tenantRepository;
        this.users = users;
    }

    /**
     * One page of the cross-tenant directory.
     *
     * @param tenantId     restrict to one tenant — the cheap, single-call path, and the one a UI
     *                     should prefer. An unknown id is 404, never an empty page: on this screen
     *                     those two answers mean opposite things
     * @param tenantStatus restrict the fan-out to tenants in one lifecycle state, or null for all
     * @param status       {@code ACTIVE} | {@code INACTIVE} | {@code LOCKED} on the USER, or null.
     *                     Validated by the producer, which refuses an unknown value rather than
     *                     ignoring it
     * @param roleCode     an active branch-role code the user must hold, or null
     * @param search       matched case-insensitively against email and full name by the producer
     */
    public PlatformUserPage list(UUID tenantId, String tenantStatus, String status,
                                 String roleCode, String search, int page, int size) {
        List<TenantEntity> matched = candidateTenants(tenantId, tenantStatus);
        int pageNumber = Math.max(page, 0);
        int pageSize = clampPageSize(size);

        boolean truncated = matched.size() > MAX_TENANT_FANOUT;
        List<TenantEntity> scanned = truncated
            ? matched.subList(0, MAX_TENANT_FANOUT)
            : matched;

        // Pass 1 — one probe per tenant, to learn the filtered total. This is the honest cost of a
        // fleet-wide list and it is why MAX_TENANT_FANOUT exists.
        List<TenantEntity> reachable = new ArrayList<>();
        List<Long> totals = new ArrayList<>();
        List<UnreachableTenant> unreachable = new ArrayList<>();
        for (TenantEntity tenant : scanned) {
            try {
                UserPage probe = users.list(tenant.getId(), 0, 1, false, search, status, roleCode);
                reachable.add(tenant);
                totals.add(totalOf(probe));
            } catch (FeignException upstream) {
                // Never rethrown. One unreachable tenant must not blank the whole directory — but
                // it must not silently shrink it either, which is why the tenant is NAMED and the
                // total is withheld below.
                log.warn("[platform-admin][directory] tenant {} ({}) unreachable: status={} ",
                    tenant.getId(), tenant.getSlug(), upstream.status());
                unreachable.add(new UnreachableTenant(tenant.getId(), tenant.getSlug(),
                    "auth-service returned " + upstream.status()));
            }
        }

        // Pass 2 — walk the concatenation and fetch only the slices this window covers.
        long offset = (long) pageNumber * pageSize;
        List<PlatformUserRow> rows = new ArrayList<>();
        long consumed = 0;
        long grandTotal = 0;
        for (int i = 0; i < reachable.size(); i++) {
            long tenantTotal = totals.get(i);
            grandTotal += tenantTotal;
            if (rows.size() >= pageSize) {
                // The window is full, but keep summing so totalCount stays exact.
                continue;
            }
            long tenantStart = consumed;
            consumed += tenantTotal;
            if (offset >= consumed) {
                continue;
            }
            int skipWithinTenant = (int) Math.max(0, offset - tenantStart);
            int want = pageSize - rows.size();
            TenantEntity tenant = reachable.get(i);
            for (UserSummary user : slice(tenant.getId(), skipWithinTenant, want,
                    search, status, roleCode, unreachable, tenant)) {
                rows.add(PlatformUserRow.of(tenant, user));
            }
        }

        DirectoryScan scan;
        if (unreachable.isEmpty() && !truncated) {
            scan = DirectoryScan.complete(matched.size(), grandTotal);
        } else {
            scan = DirectoryScan.partial(matched.size(), scanned.size(), unreachable, truncated,
                whyTotalIsUnknown(unreachable, truncated, matched.size()));
        }
        return new PlatformUserPage(List.copyOf(rows), scan);
    }

    /**
     * Everything the platform can honestly say about one user.
     *
     * <p>The tenant is resolved LOCALLY first, so a well-formed but unknown tenant id is a 404 from
     * this service rather than an upstream call that quietly reads nothing — the same order
     * {@link PlatformUserAdminService} uses before a reset. A user of a different tenant is 404 from
     * the producer, never 403: answering 403 would confirm that the id names a real user somewhere.
     *
     * <p>Station scopes are a SECOND upstream call and are allowed to fail on their own. When they
     * do, {@code stationScopes} is <b>null with a note</b> and not an empty list — empty means
     * "unrestricted at every branch", so collapsing the two would tell an operator a user has full
     * station access when in fact nobody knows.
     */
    public PlatformUserDetail detail(UUID tenantId, UUID userId) {
        TenantEntity tenant = requireTenant(tenantId);
        UserDetailData detail = users.get(tenantId, userId).data();
        if (detail == null || detail.user() == null) {
            // A 200 whose body does not contain a user is a producer contract break, not a missing
            // user. Reported as such rather than mapped onto 404, which would send an operator
            // looking for a deleted account.
            throw new IllegalStateException(
                "auth-service returned no user body for " + userId + " in tenant " + tenantId);
        }
        UserSummary user = detail.user();

        List<StationScopeView> stationScopes = null;
        String stationScopeNote = null;
        try {
            List<StationAssignment> assignments = users.stations(userId, tenantId);
            stationScopes = assignments == null
                ? List.of()
                : assignments.stream().map(StationScopeView::of).toList();
        } catch (FeignException upstream) {
            log.warn("[platform-admin][directory] station scopes unreadable for user {} in tenant {}"
                + ": status={}", userId, tenantId, upstream.status());
            stationScopeNote = "Station assignments could not be read on this request "
                + "(auth-service returned " + upstream.status() + "). This is NOT the same as "
                + "'no restrictions' — a user with no station rows sees every station at their "
                + "branch, and an empty list would say exactly that.";
        }

        List<BranchRoleView> branchRoles = detail.assignments() == null
            ? List.of()
            : detail.assignments().stream().map(BranchRoleView::of).toList();

        // A user with no active branch-role assignment cannot log in at all — PermissionResolver
        // throws before a token is minted. That is the exact failure blocker B2 was, so it is
        // stated as a field rather than left for a reader to infer from an empty list.
        boolean loginable = user.active() && !branchRoles.isEmpty();
        String loginableNote = loginableNote(user.active(), branchRoles.isEmpty(), tenant);

        return new PlatformUserDetail(
            TenantMembership.of(tenant), user.id(), user.email(), user.fullName(), user.locale(),
            user.active(), user.mustChangePassword(), user.totpEnabled(), user.createdAt(),
            UserActivity.of(user.lastLoginAt()), branchRoles, stationScopes, stationScopeNote,
            loginable, loginableNote);
    }

    // ───────────────────────────────── internals ─────────────────────────────────

    /**
     * One page-sized slice of one tenant, starting at an arbitrary offset within that tenant.
     *
     * <p>The producer pages by NUMBER, not offset, so an arbitrary skip is expressed by fetching
     * whole upstream pages of {@link #UPSTREAM_MAX_PAGE} and dropping the head. That is the largest
     * page the producer will serve, so it is also the fewest calls: a skip of 199 costs one call,
     * not 199 rows fetched one at a time.
     */
    private List<UserSummary> slice(UUID tenantId, int skip, int want, String search,
                                    String status, String roleCode,
                                    List<UnreachableTenant> unreachable, TenantEntity tenant) {
        List<UserSummary> collected = new ArrayList<>();
        int upstreamPage = skip / UPSTREAM_MAX_PAGE;
        int dropFromFirstPage = skip % UPSTREAM_MAX_PAGE;
        while (collected.size() < want) {
            UserPage fetched;
            try {
                fetched = users.list(tenantId, upstreamPage, UPSTREAM_MAX_PAGE, false,
                    search, status, roleCode);
            } catch (FeignException upstream) {
                // The probe succeeded and this did not — a tenant that became unreachable mid-scan.
                // Recorded exactly like a failed probe so the total is withheld rather than being
                // reported as complete over a page that is missing rows.
                log.warn("[platform-admin][directory] tenant {} ({}) failed mid-scan: status={}",
                    tenantId, tenant.getSlug(), upstream.status());
                if (unreachable.stream().noneMatch(u -> u.tenantId().equals(tenantId))) {
                    unreachable.add(new UnreachableTenant(tenantId, tenant.getSlug(),
                        "auth-service returned " + upstream.status() + " part-way through the scan"));
                }
                return collected;
            }
            List<UserSummary> data = fetched.data() == null ? List.of() : fetched.data();
            if (data.isEmpty()) {
                return collected;
            }
            for (int i = dropFromFirstPage; i < data.size() && collected.size() < want; i++) {
                collected.add(data.get(i));
            }
            if (data.size() < UPSTREAM_MAX_PAGE) {
                return collected;
            }
            dropFromFirstPage = 0;
            upstreamPage++;
        }
        return collected;
    }

    private List<TenantEntity> candidateTenants(UUID tenantId, String tenantStatus) {
        if (tenantId != null) {
            return List.of(requireTenant(tenantId));
        }
        if (tenantStatus == null || tenantStatus.isBlank()) {
            return tenantRepository.findAllByOrderBySlugAsc();
        }
        TenantEntity.TenantStatus parsed;
        try {
            parsed = TenantEntity.TenantStatus.valueOf(tenantStatus.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException unknown) {
            // Refused rather than ignored: a caller who asked for SUSPENDED tenants and received
            // every tenant has been told the opposite of the truth and cannot tell.
            throw new IllegalArgumentException("Unknown tenant status '" + tenantStatus
                + "'. Expected one of " + List.of(TenantEntity.TenantStatus.values()));
        }
        return tenantRepository.findByStatusOrderBySlugAsc(parsed);
    }

    private TenantEntity requireTenant(UUID tenantId) {
        return tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant not found: " + tenantId));
    }

    /**
     * The producer's {@code meta.totalCount}, or a refusal.
     *
     * <p>A missing total is not treated as zero. It would make this tenant's users vanish from the
     * concatenation while the scan still reported itself complete, which is the one outcome the
     * scan block exists to prevent.
     */
    private static long totalOf(UserPage probe) {
        if (probe == null || probe.meta() == null || probe.meta().totalCount() == null) {
            throw new IllegalStateException(
                "auth-service returned a user page with no meta.totalCount; the cross-tenant "
                    + "directory pages over the concatenation of per-tenant totals and cannot "
                    + "treat an absent total as zero");
        }
        return probe.meta().totalCount();
    }

    private static String whyTotalIsUnknown(List<UnreachableTenant> unreachable, boolean truncated,
                                            int matched) {
        StringBuilder why = new StringBuilder();
        if (!unreachable.isEmpty()) {
            why.append(unreachable.size())
                .append(" tenant(s) could not be read on this request, so their users are absent "
                    + "from this page and the fleet total is unknown rather than smaller. ");
        }
        if (truncated) {
            why.append("The scan stopped after ").append(MAX_TENANT_FANOUT).append(" of ")
                .append(matched).append(" matching tenants (there is no cross-tenant user query — "
                    + "a fleet list is one call per tenant). Narrow by tenant or tenant status for "
                    + "a complete answer.");
        }
        return why.toString().trim();
    }

    private static String loginableNote(boolean active, boolean noRoles, TenantEntity tenant) {
        if (!active) {
            return "The account is deactivated: login is refused and every refresh session was "
                + "revoked when it was deactivated.";
        }
        if (noRoles) {
            return "The account holds no active branch-role assignment, so permission resolution "
                + "fails before a token is minted and it cannot be used. This is an account that "
                + "looks created and is not usable.";
        }
        if (tenant.getStatus() != TenantEntity.TenantStatus.ACTIVE) {
            return "The account itself is usable, but its tenant is " + tenant.getStatus()
                + " — whether login succeeds is decided by the tenant's status, not this account's.";
        }
        return null;
    }

    private static int clampPageSize(int requested) {
        if (requested <= 0) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(requested, MAX_PAGE_SIZE);
    }
}
