package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.dto.request.StationAssignmentRequest;
import io.restaurantos.auth.dto.response.BranchRoleAssignWriteResponse;
import io.restaurantos.auth.dto.response.BranchRoleAssignmentResponse;
import io.restaurantos.auth.dto.response.BranchStaffResponse;
import io.restaurantos.auth.dto.response.StationAssignmentResponse;
import io.restaurantos.auth.exception.ActingUserRequiredException;
import io.restaurantos.auth.service.BranchAssignmentService;
import io.restaurantos.auth.service.BranchRoleAdminService;
import io.restaurantos.auth.service.PermissionResolver;
import io.restaurantos.auth.service.ResolvedBranchAuth;
import io.restaurantos.auth.service.StationAssignmentAdminService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Internal-only endpoints called by trusted platform services (not public gateway traffic).
 * All paths under /internal/auth/** are gated by InternalServiceFilter (X-Internal-Service header).
 * See Doc 4 §4.1 for the internal-call security contract.
 *
 * auth-service is the SYSTEM OF RECORD for user_branch_roles and permission computation.
 * user-service delegates all role writes + permission reads here — it never writes user_branch_roles.
 */
@RestController
@RequestMapping("/internal/auth")
public class AuthInternalController {

    private final BranchRoleAdminService branchRoleAdminService;
    private final BranchAssignmentService branchAssignmentService;
    private final PermissionResolver permissionResolver;
    private final StationAssignmentAdminService stationAssignmentAdminService;

    public AuthInternalController(BranchRoleAdminService branchRoleAdminService,
                                  BranchAssignmentService branchAssignmentService,
                                  PermissionResolver permissionResolver,
                                  StationAssignmentAdminService stationAssignmentAdminService) {
        this.branchRoleAdminService = branchRoleAdminService;
        this.branchAssignmentService = branchAssignmentService;
        this.permissionResolver = permissionResolver;
        this.stationAssignmentAdminService = stationAssignmentAdminService;
    }

    /**
     * The header naming the human on whose behalf a privilege-bearing internal write is made.
     *
     * <p>See {@link io.restaurantos.auth.controller.UserLifecycleInternalController#ACTING_USER_HEADER}
     * for who is authoritative for its value and why a client cannot supply it. Declared in both
     * places as a constant so a rename cannot leave one door reading a header nobody sends.
     */
    public static final String ACTING_USER_HEADER = "X-Acting-User-Id";

    /**
     * Assign (upsert) a branch-role for a user. Called by user-service UserAdminService.
     *
     * <p><b>Breaking change, deliberate (13-11).</b> {@code X-Acting-User-Id} is now REQUIRED, and a
     * request without it is refused rather than processed without a ceiling check. Before this, a
     * TENANT_ADMIN could POST {@code {"roleCode":"OWNER"}} here and receive 200 — measured live by
     * {@code scripts/e2e/phase13-role-catalog-e2e.sh}, and left failing on purpose by 13-07 because
     * closing it needs a change to this cross-service contract. The account so created holds
     * {@code rbac.manage}, which is what 13-02's authority split exists to withhold from tenant
     * admins, and the assigner can log in as it.
     *
     * <p>Declared {@code required = false} and rejected explicitly, rather than {@code required =
     * true}: Spring's own refusal is a 400 {@code BAD_REQUEST} indistinguishable from a malformed
     * body, and this is an authorization failure with its own code and its own reason. It is still
     * a hard refusal — see {@link ActingUserRequiredException} for why an optional identity header
     * is worse than none.
     *
     * @param tenantId which tenant's rows this touches — sets the row-level-security GUC
     * @param actingUserId who is asking; their own permissions bound what this request may grant
     */
    @PostMapping("/users/{userId}/branch-roles")
    public ResponseEntity<BranchRoleAssignWriteResponse> assignBranchRole(
            @PathVariable UUID userId,
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestHeader(value = ACTING_USER_HEADER, required = false) UUID actingUserId,
            @Valid @RequestBody BranchRoleAssignRequest request) {
        if (actingUserId == null) {
            throw new ActingUserRequiredException("POST /internal/auth/users/{userId}/branch-roles");
        }
        BranchRoleAdminService.RoleAssignmentResult result =
            branchRoleAdminService.assignAsActingUser(tenantId, actingUserId, userId, request);
        return ResponseEntity.ok(
            BranchRoleAssignWriteResponse.of(result.assignment(), result.displacedRoleCode()));
    }

    /**
     * Revoke (soft-deactivate) a branch-role for a user.
     */
    @DeleteMapping("/users/{userId}/branch-roles")
    public ResponseEntity<Void> revokeBranchRole(
            @PathVariable UUID userId,
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam UUID branchId,
            @RequestParam String roleCode) {
        branchRoleAdminService.revoke(tenantId, userId, branchId, roleCode);
        return ResponseEntity.noContent().build();
    }

    /**
     * Everyone rostered at one branch whose role there grants {@code permission}.
     *
     * <p>Added for F11: a duty manager opening a cash drawer for a named cashier needs a picker of
     * the people who may run one, and pos-service cannot build that list — it holds no user rows,
     * and the public {@code GET /api/v1/users} is gated on the tenant user-administration
     * permission a branch MANAGER deliberately does not hold (measured: 403 for
     * {@code manager@terrace.local}). The authorization of the HUMAN happens at pos-service's own
     * endpoint, on {@code pos.till.open.other}; what this seam contributes is the join to
     * {@code role_permissions}, which only this database can do.
     *
     * <p>{@code permission} is required. An unfiltered branch roster is a staff directory, and this
     * path is reachable by any service holding the internal secret; making the caller name the
     * capability keeps the response scoped to the question.
     */
    @GetMapping("/branches/{branchId}/staff")
    public ResponseEntity<List<BranchStaffResponse>> branchStaff(
            @PathVariable UUID branchId,
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam String permission) {
        return ResponseEntity.ok(
            branchAssignmentService.listBranchStaffWithPermission(tenantId, branchId, permission));
    }

    /** List active branch-role assignments for a user (branch-switcher / mine branches). */
    @GetMapping("/users/{userId}/branch-roles")
    public ResponseEntity<List<BranchRoleAssignmentResponse>> listBranchRoles(
            @PathVariable UUID userId,
            @RequestHeader("X-Tenant-Id") UUID tenantId) {
        return ResponseEntity.ok(branchAssignmentService.listActive(tenantId, userId));
    }

    // ── Station assignments (28-01) ──────────────────────────────────────────────────────────

    /**
     * Replace a user's station assignments at one branch (D-28-02).
     *
     * <p>Mounted beside the branch-role endpoints, and gated upstream by the SAME permission,
     * because D-28-02 places both choices in one form. An administrator who could grant a role but
     * not a station would be a state with no operator meaning.
     *
     * <p>No {@code X-Acting-User-Id} requirement, unlike the branch-role write. That header exists
     * so auth-service can apply the ROLE CEILING — the rule that an assigner may only grant a role
     * whose permissions are a subset of their own. A station assignment grants nothing: it NARROWS
     * what the target user sees, and the narrowest possible assignment is strictly less authority
     * than the unrestricted default. There is no ceiling to compute, so there is no identity to
     * compute it against.
     */
    @PutMapping("/users/{userId}/stations")
    public ResponseEntity<List<StationAssignmentResponse>> replaceStations(
            @PathVariable UUID userId,
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @Valid @RequestBody StationAssignmentRequest request) {
        return ResponseEntity.ok(stationAssignmentAdminService.replaceForBranch(
            tenantId, userId, request.branchId(), request.stationCodes()));
    }

    /** A user's active station assignments, grouped by branch. */
    @GetMapping("/users/{userId}/stations")
    public ResponseEntity<List<StationAssignmentResponse>> listStations(
            @PathVariable UUID userId,
            @RequestHeader("X-Tenant-Id") UUID tenantId) {
        return ResponseEntity.ok(stationAssignmentAdminService.list(tenantId, userId));
    }

    /**
     * Compute permissions for a user at a specific branch.
     *
     * <p>X-Tenant-Id is what puts the RLS GUC on the connection. This method's contract has always
     * said so, but it never declared the header and nothing else read it: there is no JWT on
     * {@code /internal/**}, so {@code TenantFilterInterceptor} has no TenantContext to act on and
     * {@code TenantAwareDataSource} sets no GUC. Every RLS-protected read then matched zero rows
     * and the caller got "user has no active branch assignments" — the message for a locked-out
     * user — about a user whose assignments were present the whole time. Tests could not see it,
     * because Testcontainers' Postgres user is a superuser and superusers bypass row security.
     *
     * <p>The header stays optional so the pre-existing callers that omit it keep their current
     * behaviour rather than starting to 400: inside auth-service's own login transaction the GUC is
     * already set, and that path calls the resolver directly, not through here.
     */
    @GetMapping("/users/{userId}/permissions")
    public ResponseEntity<ResolvedBranchAuth> getUserPermissions(
            @PathVariable UUID userId,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId,
            @RequestParam(required = false) UUID branchId) {
        if (tenantId != null) {
            return ResponseEntity.ok(permissionResolver.resolveForTenant(tenantId, userId, branchId));
        }
        ResolvedBranchAuth resolved = branchId != null
            ? permissionResolver.resolve(userId, branchId)
            : permissionResolver.resolveDefault(userId);
        return ResponseEntity.ok(resolved);
    }
}
