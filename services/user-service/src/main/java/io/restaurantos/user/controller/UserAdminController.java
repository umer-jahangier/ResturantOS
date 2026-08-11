package io.restaurantos.user.controller;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.dto.UserAdminDtos;
import io.restaurantos.user.service.UserAdminService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The public tenant-admin user surface (blocker B3, D-11) plus per-branch role assignment.
 *
 * <pre>
 *   GET    /api/v1/users                       one page of THIS tenant's users
 *   GET    /api/v1/users/{userId}              one user + their active assignments
 *   POST   /api/v1/users                       201 + a one-time temporary password
 *   PATCH  /api/v1/users/{userId}              name / locale / active
 *   POST   /api/v1/users/{userId}/deactivate   flag off + sessions revoked
 *   POST   /api/v1/users/{userId}/reactivate   flag on
 *   GET    /api/v1/users/{userId}/permissions  computed permissions (JWT-issuance concern)
 *   POST   /api/v1/users/{userId}/branch-roles assign a role at a branch
 *   DELETE /api/v1/users/{userId}/branch-roles revoke one
 *   PUT    /api/v1/users/{userId}/stations     set which stations they work at a branch
 *   GET    /api/v1/users/{userId}/stations     read them back
 * </pre>
 *
 * <p>All writes DELEGATE to auth-service (system of record for {@code users} and
 * {@code user_branch_roles}). user-service writes neither table.
 *
 * <p><b>The tenant is never in the URL and never in a body.</b> It comes from the verified JWT, via
 * {@code TenantContext}; see {@link UserAdminService}. A path that took a tenant id would be a path
 * whose authorization had to be re-argued at every call site.
 *
 * <h2>Gating</h2>
 *
 * <p>Every method here used to require {@code rbac.manage} alone, which no TENANT_ADMIN holds
 * (changeset 030 grants that role every permission <em>except</em> that one), so only OWNER could
 * administer anything and "multiple admins per tenant" did not work. Phase 13 splits the authority:
 * {@code rbac.role.manage} for granting and revoking roles, {@code rbac.user.manage} for reading
 * and administering the user record. {@code rbac.manage} is kept as an accepted alternative on both
 * so OWNER's existing authority is unchanged.
 *
 * <p>The role writes take the <em>role</em> code and everything else takes the <em>user</em> code
 * deliberately. Splitting the codes and then gating role assignment on the user-administration code
 * would defeat the split: anyone able to edit a user would be able to grant themselves OWNER. Both
 * codes are currently held by exactly the same two roles, so this changes nothing today — it is
 * what makes a narrower custom role possible later without re-auditing these endpoints.
 *
 * <p>What the gate does <b>not</b> decide is which roles the caller may grant. That ceiling lives
 * in auth-service, where the permission sets it compares actually are.
 */
@RestController
@RequestMapping("/api/v1/users")
public class UserAdminController {

    /** May administer the user record: read, create, edit, deactivate. */
    private static final String USER_ADMIN = "hasAnyAuthority('rbac.manage', 'rbac.user.manage')";
    /** May grant and revoke roles. Strictly the more dangerous of the two — see the class comment. */
    private static final String ROLE_ADMIN = "hasAnyAuthority('rbac.manage', 'rbac.role.manage')";

    private final UserAdminService userAdminService;

    public UserAdminController(UserAdminService userAdminService) {
        this.userAdminService = userAdminService;
    }

    // ── The user lifecycle ───────────────────────────────────────────────────────────────────

    /**
     * One page of this tenant's users.
     *
     * <p>Pagination is not optional and the page size is capped upstream at 200; a caller asking
     * for more gets the cap rather than an error, and {@code meta.totalCount} tells them how many
     * there are. The sort is fixed at {@code (email, id)} upstream and is deliberately not a
     * parameter — an unstable sort makes page 2 omit and repeat rows.
     */
    @PreAuthorize(USER_ADMIN)
    @GetMapping
    public ResponseEntity<ApiResponse<List<UserAdminDtos.UserSummary>>> listUsers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "0") int size,
            @RequestParam(defaultValue = "false") boolean activeOnly,
            @RequestParam(required = false) String search) {
        return ResponseEntity.ok(userAdminService.listUsers(page, size, activeOnly, search));
    }

    /**
     * One user of this tenant, with the assignments that decide what they can do.
     *
     * <p>Another tenant's user id is <b>404</b> — see {@link UserAdminService#getUser}.
     */
    @PreAuthorize(USER_ADMIN)
    @GetMapping("/{userId}")
    public ResponseEntity<ApiResponse<UserAdminDtos.UserDetail>> getUser(@PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(userAdminService.getUser(userId)));
    }

    /**
     * Create a user in this tenant. 201, because a resource was created.
     *
     * <p>The response carries the temporary password, which exists nowhere else — the admin must
     * deliver it out of band and must not log it. {@code mustChangePassword} is set, and 13-08's
     * forced-change gate makes that binding at first login.
     */
    @PreAuthorize(USER_ADMIN)
    @PostMapping
    public ResponseEntity<ApiResponse<UserAdminDtos.CreatedUser>> createUser(
            @Valid @RequestBody UserAdminDtos.CreateUserRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ApiResponse.ok(userAdminService.createUser(request)));
    }

    /**
     * Patch a user's profile. PATCH rather than PUT: every field is optional and a null field is
     * left alone, so a client rendering three fields will not blank a fourth.
     */
    @PreAuthorize(USER_ADMIN)
    @PatchMapping("/{userId}")
    public ResponseEntity<ApiResponse<UserAdminDtos.UserDetail>> updateUser(
            @PathVariable UUID userId,
            @Valid @RequestBody UserAdminDtos.UpdateUserRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(userAdminService.updateUser(userId, request)));
    }

    /**
     * Deactivate a user: the flag goes off and their refresh sessions are revoked upstream. The row
     * and its assignments survive, so audit, order and journal references stay resolvable and
     * reactivation restores the role they held.
     *
     * <p>POST to a sub-resource rather than DELETE, because nothing is deleted and a DELETE that
     * does not delete is a trap for the next person to read the route table.
     */
    @PreAuthorize(USER_ADMIN)
    @PostMapping("/{userId}/deactivate")
    public ResponseEntity<ApiResponse<UserAdminDtos.UserDetail>> deactivateUser(@PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(userAdminService.deactivateUser(userId)));
    }

    /** Reactivate a user. Sessions are deliberately not restored — one login re-establishes who holds the account. */
    @PreAuthorize(USER_ADMIN)
    @PostMapping("/{userId}/reactivate")
    public ResponseEntity<ApiResponse<UserAdminDtos.UserDetail>> reactivateUser(@PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(userAdminService.reactivateUser(userId)));
    }

    /**
     * Reset a user's password and return the one-time temporary one (13-13, D-16, D-18).
     *
     * <p><b>This endpoint is the platform's only working password-recovery path.</b> 13-09 (D-31)
     * resolved that self-service forgot-password ships disabled because no delivery consumer
     * exists, so a user who forgets their password reaches their administrator, not an inbox. The
     * response carries the temporary password, which must be delivered out of band and must not be
     * logged.
     *
     * <p>The reset clears the target's login lockout and revokes their sessions, and sets the
     * forced-change flag so the credential the administrator has just read out cannot become
     * permanent. Upstream refuses a target in another tenant with 404 and a target holding a role
     * above the caller's own with 403 {@code ROLE_CEILING_EXCEEDED} — resetting somebody's password
     * is taking their account, which is strictly stronger than editing their profile, so the same
     * ceiling that bounds deactivation bounds this.
     *
     * <p>Gated on the USER-administration authority rather than the role one: it does not change
     * what anybody may do, so gating it on {@code rbac.role.manage} would force a role-granting
     * authority on every administrator who needs to help somebody log back in.
     *
     * <p>POST to a sub-resource rather than PATCH on the user, because nothing about the user
     * RESOURCE changes — a credential is replaced — and PATCH on this API is deliberately the verb
     * that never touches a password.
     */
    @PreAuthorize(USER_ADMIN)
    @PostMapping("/{userId}/reset-password")
    public ResponseEntity<ApiResponse<UserAdminDtos.AdminResetResult>> resetPassword(
            @PathVariable UUID userId,
            @Valid @RequestBody UserAdminDtos.AdminResetRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(userAdminService.resetPassword(userId, request)));
    }

    // ── Branch roles ─────────────────────────────────────────────────────────────────────────

    /** Assign a branch-role to a user — delegates to auth-service, which applies the role ceiling. */
    @PreAuthorize(ROLE_ADMIN)
    @PostMapping("/{userId}/branch-roles")
    public ResponseEntity<ApiResponse<Map<String, Object>>> assignBranchRole(
            @PathVariable UUID userId,
            @Valid @RequestBody BranchDtos.BranchRoleRequest request) {
        Map<String, Object> result = userAdminService.assignRole(userId, request);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /** Revoke a branch-role from a user — delegates to auth-service. */
    @PreAuthorize(ROLE_ADMIN)
    @DeleteMapping("/{userId}/branch-roles")
    public ResponseEntity<Void> revokeBranchRole(
            @PathVariable UUID userId,
            @RequestParam UUID branchId,
            @RequestParam String roleCode) {
        userAdminService.revokeRole(userId, branchId, roleCode);
        return ResponseEntity.noContent().build();
    }

    // ── Station assignments (28-01) ──────────────────────────────────────────

    /**
     * Set which stations a user works at a branch (D-28-02). This is the account-system half of the
     * capability this phase exists for: binding a person to a screen at the moment their account is
     * created or edited.
     *
     * <p>PUT, not POST: the body states what the user's stations now ARE at that branch, and sending
     * it twice must leave the same rows. An additive POST would make a checkbox list impossible to
     * express, because unchecking a box has no additive spelling.
     *
     * <p>Gated on {@link #ROLE_ADMIN}, the same authority that gates role assignment, rather than on
     * the user-administration one. D-28-02 places the station picker in the same form as the role
     * picker; splitting the gate would permit an administrator who can grant a role but not a
     * station, which is a state with no operator meaning. It is deliberately NOT gated on
     * {@code pos.terminals.admin} — that permission governs the terminal CATALOGUE, and this is a
     * decision about a person.
     */
    @PreAuthorize(ROLE_ADMIN)
    @PutMapping("/{userId}/stations")
    public ResponseEntity<ApiResponse<List<BranchDtos.StationAssignment>>> replaceStations(
            @PathVariable UUID userId,
            @Valid @RequestBody BranchDtos.StationAssignmentRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(userAdminService.replaceStations(userId, request)));
    }

    /** A user's current station assignments, grouped by branch. */
    @PreAuthorize(USER_ADMIN)
    @GetMapping("/{userId}/stations")
    public ResponseEntity<ApiResponse<List<BranchDtos.StationAssignment>>> listStations(
            @PathVariable UUID userId) {
        return ResponseEntity.ok(ApiResponse.ok(userAdminService.listStations(userId)));
    }

    /**
     * Read-through: computed permissions from auth-service (a JWT-issuance concern).
     *
     * <p><b>This moved from {@code GET /{userId}} to {@code GET /{userId}/permissions}.</b> That
     * path had to become the user resource — a public user API whose "get a user" returns a
     * permission map instead of a user is a contract nobody can code a UI against, and there is
     * only one obvious path for a user. The move mirrors the internal contract, where permissions
     * have always been at {@code /internal/auth/users/{userId}/permissions}, so the public and
     * internal shapes now agree. One caller existed and was updated in the same commit
     * ({@code scripts/e2e/phase13-roles-e2e.sh}).
     */
    @PreAuthorize(USER_ADMIN)
    @GetMapping("/{userId}/permissions")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getUserPermissions(
            @PathVariable UUID userId,
            @RequestParam(required = false) UUID branchId) {
        Map<String, Object> permissions = userAdminService.getUserPermissions(userId, branchId);
        return ResponseEntity.ok(ApiResponse.ok(permissions));
    }
}
