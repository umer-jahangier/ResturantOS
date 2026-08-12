package io.restaurantos.user.service;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.client.AuthInternalClient;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.dto.UserAdminDtos;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Tenant-Admin user surface (USER-01, USER-02, USER-03; blocker B3).
 *
 * <p>Every write DELEGATES to auth-service — it is the SYSTEM OF RECORD for {@code users} and
 * {@code user_branch_roles}, and this service writes neither table. {@code user_db} does not even
 * contain them, which {@code UserAdminDelegationIT} asserts so the ownership decision cannot be
 * quietly reversed by adding an entity.
 *
 * <h2>Where the tenant comes from, and where it does not</h2>
 *
 * <p>{@link TenantContext#requireTenantId()}, always — populated by {@code JwtAuthenticationFilter}
 * from the {@code tenant_id} claim of a signature-verified JWT, and by nothing else. <b>No method
 * here reads a tenant id from a request body, a path variable or a request header.</b> The public
 * request DTOs deliberately have no tenant field at all, so a body carrying one is dropped by
 * Jackson and has no effect on scoping — asserted both in {@code UserAdminIT} and live.
 *
 * <p>There is exactly one accessor for it. A second way to learn the tenant is how one path comes
 * to be scoped differently from its neighbour, and that difference is invisible until someone reads
 * another tenant's data.
 *
 * <h2>Where the role ceiling is enforced, and why not here</h2>
 *
 * <p>It is enforced in auth-service, by {@code RoleCeiling.permits}, which is the single owner of
 * the rule and is already shared between the role picker (13-07) and the write path (13-11). The
 * rule compares the target role's permission set with the acting user's, and <b>only auth-service
 * has either</b> — {@code role_permissions} and {@code user_branch_roles} are its tables. A copy
 * here could only be a hardcoded role name, which drifts the moment a role is added and would be a
 * second, weaker statement of a security rule that already has one owner. What this service does
 * instead is forward the caller's identity so auth-service <em>can</em> evaluate it, and surface
 * the refusal with its real status (see {@code UpstreamErrorDecoder}) so a role picker can say
 * something true about it.
 */
@Service
public class UserAdminService {

    private final AuthInternalClient authInternalClient;
    private final TenantContext tenantContext;

    public UserAdminService(AuthInternalClient authInternalClient, TenantContext tenantContext) {
        this.authInternalClient = authInternalClient;
        this.tenantContext = tenantContext;
    }

    // ── The user lifecycle ───────────────────────────────────────────────────────────────────

    /** One page of the CALLER'S OWN tenant's users. */
    public ApiResponse<List<UserAdminDtos.UserSummary>> listUsers(
            int page, int size, boolean activeOnly, String search) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.listUsers(tenantId, page, size, activeOnly,
            search == null ? "" : search);
    }

    /**
     * One user of the caller's own tenant.
     *
     * <p>Another tenant's user id answers <b>404, not 403</b> — deliberately, and upstream. A 403
     * would confirm the id names a real account somewhere, which is an enumeration oracle: a tenant
     * admin could walk ids and learn the size and shape of the rest of the platform without ever
     * reading a row.
     */
    public UserAdminDtos.UserDetail getUser(UUID userId) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.getUser(userId, tenantId).data();
    }

    /**
     * Create a user in the caller's own tenant and return the one-time temporary password.
     *
     * <p>The password is generated upstream, stored only as a bcrypt hash, and appears in no event
     * payload — 13-11 asserted both. It crosses back to this authorised admin exactly once, and
     * {@code must_change_password} bounds its life at the new user's first login (13-08 made that
     * gate binding). Nothing in this class logs the response.
     */
    public UserAdminDtos.CreatedUser createUser(UserAdminDtos.CreateUserRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = requireActingUser("create a user");
        return authInternalClient.createUser(tenantId, actingUserId, request).data();
    }

    /** Patch name / locale / active on a user of the caller's own tenant. */
    public UserAdminDtos.UserDetail updateUser(UUID userId, UserAdminDtos.UpdateUserRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = requireActingUser("update a user");
        rejectPasswordField(request);
        return authInternalClient.updateUser(userId, tenantId, actingUserId,
            new AuthInternalClient.InternalUpdateUser(
                request.fullName(), request.locale(), request.active())).data();
    }

    /** Deactivate: flag off and refresh sessions revoked upstream. Never deletes. */
    public UserAdminDtos.UserDetail deactivateUser(UUID userId) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = requireActingUser("deactivate a user");
        return authInternalClient.deactivateUser(userId, tenantId, actingUserId).data();
    }

    /** Reactivate: flag on. Sessions are deliberately not restored upstream. */
    public UserAdminDtos.UserDetail reactivateUser(UUID userId) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = requireActingUser("reactivate a user");
        return authInternalClient.reactivateUser(userId, tenantId, actingUserId).data();
    }

    /**
     * Reset a user's password on the calling administrator's behalf (13-13, D-16, D-18).
     *
     * <p><b>This is the recovery path that replaces self-service forgot-password.</b> 13-09 (D-31)
     * resolved that the self-service flow ships disabled — {@code notification-service} contains a
     * {@code pom.xml} and a {@code README.md} and nothing else, so nothing consumes
     * {@code PASSWORD_RESET_REQUESTED} and no message can be delivered. Without this endpoint a
     * user who forgets their password has no route back into the product at all.
     *
     * <p>Three things travel, and only one of them comes from the request: the TENANT and the
     * ACTING ADMINISTRATOR both come from the verified JWT via {@link TenantContext}, and only the
     * reason is the caller's. An acting-administrator id in the body is not merely ignored — the
     * public DTO declares no such field, so there is nothing for Jackson to bind and no branch of
     * code that could honour one (T-13-13-G).
     *
     * <p>Upstream enforces what this service cannot: the tenant boundary (another tenant's user is
     * 404, never 403) and the role ceiling (a caller may not reset a user holding a role above
     * their own — a privilege inversion). Both need {@code user_branch_roles} and
     * {@code role_permissions}, which only auth-service holds; {@code RoleCeiling} is the single
     * owner of that rule and is deliberately not forked here, for the reason §3 of 13-12's summary
     * gives.
     *
     * <p>The returned temporary password is logged nowhere in this service and is handed to the
     * administrator to deliver out of band.
     */
    public UserAdminDtos.AdminResetResult resetPassword(UUID userId,
                                                        UserAdminDtos.AdminResetRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = requireActingUser("reset a user's password");
        return authInternalClient.resetPassword(userId, tenantId, actingUserId,
            new AuthInternalClient.InternalAdminReset("TENANT", request.reason())).data();
    }

    // ── Branch roles (pre-existing) ──────────────────────────────────────────────────────────

    /**
     * Assign a role to a user at a branch — delegates to auth-service.
     *
     * <p>Forwards the CALLER's identity (13-11). auth-service refuses a grant whose permission set
     * exceeds the acting user's own, and it recomputes that set server-side rather than trusting
     * anything sent here — so this header is an identity, not a claim of authority. The value is
     * the subject of the verified JWT, taken from {@link TenantContext}, which
     * {@code JwtAuthenticationFilter} populated; it is never read from the request.
     */
    public Map<String, Object> assignRole(UUID userId, BranchDtos.BranchRoleRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = requireActingUser("assign a role");
        return authInternalClient.assignBranchRole(userId, tenantId, actingUserId, request);
    }

    /**
     * Revoke a branch-role from a user — delegates to auth-service.
     *
     * <p>Forwards the CALLER's identity, exactly as {@link #assignRole} does. auth-service refuses
     * to revoke a role whose permission set exceeds the acting user's own — the half of the ceiling
     * that was missing until S2, and the more dangerous half: a tenant admin cannot create an OWNER
     * but could destroy every OWNER in the tenant, and nobody below the ceiling can grant the role
     * back. The header is an identity, not a claim of authority; the permission set behind it is
     * recomputed server-side.
     */
    public void revokeRole(UUID userId, UUID branchId, String roleCode) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID actingUserId = requireActingUser("revoke a role");
        authInternalClient.revokeBranchRole(userId, tenantId, actingUserId, branchId, roleCode);
    }

    // ── Station assignments (28-01) ──────────────────────────────────────────────────────────

    /**
     * Replace a user's stations at one branch — delegates to auth-service (D-28-02).
     *
     * <p>Gated upstream by the same permission that gates role assignment, because D-28-02 puts
     * both choices in one form and an administrator who could set one but not the other would be a
     * state with no operator meaning.
     */
    public List<BranchDtos.StationAssignment> replaceStations(
            UUID userId, BranchDtos.StationAssignmentRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.replaceStations(userId, tenantId, request);
    }

    /** A user's active station assignments, grouped by branch — read-through to auth-service. */
    public List<BranchDtos.StationAssignment> listStations(UUID userId) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.listStations(userId, tenantId);
    }

    // ── Menu-category assignments (Program A) ────────────────────────────────────────────────

    /**
     * Replace a user's ringable menu categories at one branch — delegates to auth-service.
     *
     * <p><b>The tenant comes from the verified JWT and is never in the path or the body.</b> That is
     * what puts the RLS GUC on auth-service's connection, and it is also the tenant boundary: a
     * caller cannot name a foreign tenant's user, because there is nowhere in this call to put one.
     * auth-service answers a user id belonging to another tenant with 404.
     *
     * <p>Gated upstream by the same permission that gates role and station assignment. The three
     * decisions live in one form; splitting the gate would permit an administrator who can bind a
     * person to a kitchen screen but not to a section of the menu, which has no operator meaning.
     */
    public List<BranchDtos.MenuCategoryAssignment> replaceMenuCategories(
            UUID userId, BranchDtos.MenuCategoryAssignmentRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.replaceMenuCategories(userId, tenantId, request);
    }

    /**
     * A user's active menu-category assignments, grouped by branch — read-through to auth-service.
     *
     * <p>An empty list means the user rings the WHOLE menu, everywhere. It does not mean they may
     * ring nothing, and no branch is ever returned carrying an empty {@code categoryIds}: absence is
     * the only encoding of unrestricted at every layer of this feature.
     */
    public List<BranchDtos.MenuCategoryAssignment> listMenuCategories(UUID userId) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.listMenuCategories(userId, tenantId);
    }

    /**
     * Fetch computed permissions for a user at a branch — read-through to auth-service.
     * Used for JWT-feeding lookups; auth-service is authoritative.
     */
    public Map<String, Object> getUserPermissions(UUID userId, UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        return authInternalClient.getUserPermissions(userId, tenantId, branchId);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    /**
     * The subject of the verified JWT, which every privilege-bearing write must name.
     *
     * <p>An authenticated request always carries a subject, so its absence is a broken filter chain
     * rather than an anonymous caller. It is refused HERE rather than forwarded as a null header:
     * auth-service would refuse it anyway with {@code 403 ACTING_USER_REQUIRED}, but that refusal
     * describes a misconfiguration of this service and is deliberately not echoed to the client
     * (see {@code UpstreamErrorDecoder}), so failing early with a message that names the real cause
     * is worth the three lines.
     */
    private UUID requireActingUser(String operation) {
        return tenantContext.getUserId().orElseThrow(() -> new IllegalStateException(
            "No authenticated user id in the request context; a request to " + operation
                + " must name the person making it (auth-service bounds it by their permissions)"));
    }

    /**
     * A password field in a profile patch is refused, never dropped.
     *
     * <p>Jackson would silently discard it and this endpoint would answer 200, leaving an
     * administrator certain they had set a password the platform has never heard of. Only the field
     * NAME reaches the message; the value was discarded at parse time and is never logged.
     */
    private static void rejectPasswordField(UserAdminDtos.UpdateUserRequest request) {
        if (request.rejectedField() != null) {
            throw new InvalidUserRequestException(
                "'%s' is not accepted here and was not applied. Passwords are never set through this "
                    + "endpoint — use the password reset flow.".formatted(request.rejectedField()));
        }
    }
}
