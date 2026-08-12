package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class BranchRoleAdminService {

    private static final Logger log = LoggerFactory.getLogger(BranchRoleAdminService.class);

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final UserRepository userRepository;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;
    private final RoleCatalog roleCatalog;
    private final RoleCeiling roleCeiling;
    private final UserLifecycleEventPublisher events;

    public BranchRoleAdminService(UserBranchRoleRepository userBranchRoleRepository,
                                  UserRepository userRepository,
                                  TenantContext tenantContext,
                                  EntityManager entityManager,
                                  RoleCatalog roleCatalog,
                                  RoleCeiling roleCeiling,
                                  UserLifecycleEventPublisher events) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.userRepository = userRepository;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
        this.roleCatalog = roleCatalog;
        this.roleCeiling = roleCeiling;
        this.events = events;
    }

    /**
     * Sets the RLS tenant GUC inside the active transaction.
     *
     * <p>Neither {@code assign} nor {@code revoke} did this, and both are reached over
     * {@code /internal/auth/**}, where there is no JWT — so {@code JwtAuthenticationFilter} never
     * populates {@link TenantContext}, {@code TenantAwareDataSource} sees an empty context, and no
     * GUC reaches the connection. {@code user_branch_roles} is FORCE ROW LEVEL SECURITY on that
     * GUC, so the INSERT was rejected outright: <em>"new row violates row-level security policy
     * for table user_branch_roles"</em>.
     *
     * <p>That means the only write path for {@code user_branch_roles} — the door user-service
     * delegates every role assignment through — has never worked against a database that actually
     * enforces RLS. It passed every test because Testcontainers' Postgres user is a superuser and
     * superusers bypass row security entirely, so the whole suite was green against a database that
     * could not reproduce the failure. It was found by driving the real endpoint against the real
     * dev stack.
     *
     * <p>{@code BranchAssignmentService.listActive} and {@code BranchSwitchService.switchBranch}
     * already do exactly this, for exactly this reason; these two methods were simply missed.
     */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }

    /**
     * The saved assignment, and the role code it replaced.
     *
     * <p>{@code displacedRoleCode} is null when nothing was replaced — a first assignment, or a
     * re-assignment of the role the user already held. It is returned rather than logged because
     * assigning a role at a branch where the user already has one is a <em>revocation</em> of the
     * old role as much as a grant of the new one, and an administrator who is not told that has no
     * way to know it happened.
     */
    public record RoleAssignmentResult(UserBranchRoleEntity assignment, String displacedRoleCode) {}

    /**
     * Assign a role on behalf of a named human, refusing anything above that human's own authority.
     *
     * <p><b>This is the entry point every networked caller reaches.</b> {@link #assign} below is
     * unbounded and is reachable only in-process, from {@code ProvisioningAdminService}, which
     * creates a tenant's FIRST admin — a genuine system context where there is no acting human yet
     * and no prior user whose authority could bound it.
     *
     * <p>The rule and the reason it must be enforced HERE rather than in user-service are in
     * {@link RoleCeiling}. In short: a check that lives only in the calling service is bypassed by
     * anything that reaches the internal port, and auth-service is the only party that knows what
     * the target role actually grants.
     *
     * <p>Ordering is load-bearing three times over. The tenant GUC comes first, because everything
     * after it reads a FORCE ROW LEVEL SECURITY table — including the acting user's own
     * assignments, which without it resolve to "no active branch assignments" and would silently
     * reduce a legitimate OWNER to the empty ceiling. The ceiling check comes next, BEFORE
     * {@link #assign}, so a refused assignment cannot have already displaced the role the target
     * user holds. And inside the ceiling check the role code is validated before the subset test,
     * so an unknown code is reported as a typo rather than passing vacuously.
     *
     * @param actingUserId the human on whose behalf this is done, asserted by the calling service
     *                     from a verified JWT — never taken from a client-supplied header
     * @throws io.restaurantos.auth.exception.UnknownRoleCodeException if the code is not in the catalog (400)
     * @throws io.restaurantos.auth.exception.RoleCeilingExceededException if the role exceeds the
     *         acting user's own permissions (403)
     */
    @Transactional
    public RoleAssignmentResult assignAsActingUser(UUID tenantId, UUID actingUserId, UUID userId,
                                                   BranchRoleAssignRequest req) {
        setTenantGuc(tenantId);
        roleCeiling.requireAssignable(actingUserId, req.roleCode());
        // The acting user is threaded through EXPLICITLY rather than left to TenantContext.
        // /internal/auth/** carries no JWT, so JwtAuthenticationFilter never populates the context
        // and TenantContext.getUserId() is empty on this path — which is how the first live run of
        // this phase produced a ROLE_GRANTED audit row with a NULL actor. A privilege escalation
        // that cannot say who performed it is the one audit row that most needs to.
        return assign(tenantId, actingUserId, userId, req);
    }

    /**
     * Assign a role to a user at a branch. auth-service is the system of record for
     * user_branch_roles — this is the ONLY write path.
     *
     * <p><b>Unbounded by design, and therefore not reachable over the wire.</b> It applies no role
     * ceiling, so it must stay an in-process, system-context operation: the only caller is
     * {@code ProvisioningAdminService.provisionAdmin}, which creates a tenant's first admin before
     * any human in that tenant exists. Every networked caller goes through
     * {@link #assignAsActingUser} instead, and {@code AuthInternalController} will not accept a
     * request that does not name an acting user. Adding a second caller here is how the escalation
     * 13-11 closed comes back.
     *
     * <p>A user holds at most one active role per branch, held by a partial unique index on
     * {@code (user_id, branch_id) WHERE is_active}. Assigning a second, different role is therefore
     * a REPLACEMENT, not an addition: any other active row for the pair is deactivated in this same
     * transaction. Permission unions across roles are deliberately not supported — the JWT's
     * {@code roles} claim is singular and every downstream consumer of it assumes so, and a tenant
     * needing a blend of two roles needs a role that carries the blend.
     *
     * <p>The role code is validated against the catalog before anything is touched (D-13). It used
     * to be trusted, and an arbitrary string persisted happily: {@code role_permissions} then has no
     * rows for it, so the holder logs in successfully with an empty permission set — a working login
     * into a product with every screen missing, reported to nobody as an error. Validation happens
     * AFTER the GUC is set, because a tenant's own custom role is invisible without it and would
     * otherwise be rejected as unknown; and BEFORE the displacement loop, because a rejected
     * assignment must not revoke the role the user already holds.
     */
    @Transactional
    public RoleAssignmentResult assign(UUID tenantId, UUID userId, BranchRoleAssignRequest req) {
        // No acting human: the only caller is ProvisioningAdminService, creating a tenant's first
        // admin before anyone in that tenant exists. Recorded as a null actor rather than
        // substituted with the target's own id — see the roleGranted call below.
        return assign(tenantId, null, userId, req);
    }

    private RoleAssignmentResult assign(UUID tenantId, UUID actingUserId, UUID userId,
                                        BranchRoleAssignRequest req) {
        setTenantGuc(tenantId);
        requireUserInTenant(tenantId, userId);
        roleCatalog.requireKnown(req.roleCode());
        List<UserBranchRoleEntity> activeAtBranch =
            userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(userId, req.branchId());
        boolean hadNoActiveAssignmentAnywhere =
            userBranchRoleRepository.findByUserIdAndActiveTrue(userId).isEmpty();

        String displacedRoleCode = null;
        boolean displacedWasPrimary = false;
        for (UserBranchRoleEntity other : activeAtBranch) {
            if (other.getRoleCode().equals(req.roleCode())) {
                continue;
            }
            other.setActive(false);
            // A deactivated row must not keep the primary flag: it would survive into the next
            // reactivation and collide with whichever row is primary by then.
            displacedWasPrimary |= other.isPrimary();
            other.setPrimary(false);
            displacedRoleCode = other.getRoleCode();
            log.info("Displacing role {} for user {} at branch {} — replaced by {}",
                other.getRoleCode(), userId, req.branchId(), req.roleCode());
            // Flushed before the new row is written. Hibernate orders inserts ahead of updates
            // within a flush, so without this the insert would hit the partial unique index while
            // the row it replaces is still active, and a legitimate replacement would fail as a
            // constraint violation.
            userBranchRoleRepository.saveAndFlush(other);
        }

        UserBranchRoleEntity entity = userBranchRoleRepository
            .findByUserIdAndBranchIdAndRoleCode(userId, req.branchId(), req.roleCode())
            .orElseGet(() -> {
                UserBranchRoleEntity e = new UserBranchRoleEntity();
                e.setId(UUID.randomUUID());
                e.setTenantId(tenantId);
                e.setUserId(userId);
                e.setBranchId(req.branchId());
                e.setRoleCode(req.roleCode());
                return e;
            });
        entity.setActive(true);
        entity.setApprovalLimitPaisa(req.approvalLimitPaisa());
        // The user's first assignment becomes their default branch at login; so does a role that
        // replaces the assignment that was previously default, so a replacement never leaves a user
        // with active assignments and no primary among them.
        if (hadNoActiveAssignmentAnywhere || displacedWasPrimary) {
            entity.setPrimary(true);
        }

        UserBranchRoleEntity saved = userBranchRoleRepository.save(entity);

        // A privilege change, recorded in the same transaction that makes it. displacedRoleCode
        // matters as much as the new role: one active role per branch means a grant is usually
        // also a revocation, and a trail that names only what the person can do now cannot answer
        // what they could do yesterday.
        //
        // The acting user comes from the caller, falling back to the verified context. Null on the
        // provisioning path, where there genuinely is no acting human — recorded honestly rather
        // than substituted with the target's own id, which is the D-34 defect that put every user
        // in impersonation_logs down as their own impersonator.
        events.roleGranted(tenantId,
            actingUserId != null ? actingUserId : tenantContext.getUserId().orElse(null),
            userId, req.branchId(), req.roleCode(), displacedRoleCode,
            saved.getApprovalLimitPaisa(), saved.isPrimary());

        return new RoleAssignmentResult(saved, displacedRoleCode);
    }

    /**
     * The target user must be a live user OF THIS TENANT, or this is a 404.
     *
     * <p><b>Nothing in application code checked this.</b> Cross-tenant assignment was refused only
     * by a database foreign key, which answered {@code 409 CONFLICT} with the message "This
     * conflicts with existing data" — true of a duplicate vendor code and useless here. Measured
     * live by {@code scripts/e2e/phase13-tenant-admin-users-e2e.sh}, which asserts all five verbs
     * against a second genuinely provisioned tenant and found this one disagreeing with the other
     * four. Relying on a constraint for a security boundary means the boundary disappears the day
     * someone drops or defers the constraint, and neither event would look like a security change.
     *
     * <p><b>404, not 403</b>, matching every other cross-tenant answer in this service. A 403 would
     * confirm that the id names a real account somewhere, letting a tenant admin walk ids and learn
     * the size and shape of the rest of the platform without reading a row. And a nonexistent id
     * now answers identically to another tenant's — verified, because two different refusals are a
     * distinguisher whatever their status codes say.
     *
     * <p>{@code findByIdForTenant} carries {@code tenant_id} in the query as well as relying on the
     * row-level-security policy, because Testcontainers runs as a SUPERUSER and the policy is inert
     * in every integration test here. The predicate is what CI can actually assert.
     */
    private void requireUserInTenant(UUID tenantId, UUID userId) {
        userRepository.findByIdForTenant(userId, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    /**
     * Revoke a role on behalf of a named human, refusing any role above that human's own authority.
     *
     * <p><b>This is the entry point every networked caller reaches</b>, and it is the half of the
     * ceiling that was missing. {@link #assignAsActingUser} has refused a grant above the caller's
     * own permissions since 13-11; revoke had no ceiling at all, and the asymmetry was measured
     * live rather than argued: a TENANT_ADMIN assigning OWNER was answered
     * <b>403 ROLE_CEILING_EXCEEDED</b> while the same admin revoking OWNER from the same account
     * was answered <b>204</b> and the row went inactive
     * ({@code .planning/audits/floor/S2/_ceiling-probe.json}).
     *
     * <p><b>Why "you may revoke only what you could grant" is the right rule.</b> A role's
     * permissions ARE the authority it carries, and the ceiling's whole statement is that a caller
     * may not act on authority they do not themselves hold. Bounding only the grant makes the
     * ceiling decorative: the tenant admin who cannot create an OWNER can instead delete every
     * OWNER in the tenant, and the damage does not undo — nobody below the ceiling can grant OWNER
     * back, so the account that holds {@code rbac.manage} is gone for good and the restaurant is
     * locked out of its own product. {@link RoleCeiling#requireMayAdminister} already made exactly
     * this argument for deactivating and renaming a user ("a TENANT_ADMIN who can deactivate the
     * OWNER can lock the only holder of {@code rbac.manage} out of their own tenant"); this applies
     * the rule that already exists to the one write that escaped it.
     *
     * <p>{@link RoleCeiling#requireAssignable} is reused rather than a second predicate written,
     * for the reason that class records: a rule with two implementations is a rule with two
     * behaviours. The refusal is worded for revocation because "you cannot assign" is a confusing
     * thing to read after pressing Revoke.
     *
     * <p>Ordering matches the assign path and is load-bearing for the same reason: the tenant GUC
     * first, because the ceiling reads {@code user_branch_roles} under FORCE ROW LEVEL SECURITY and
     * without it a legitimate OWNER resolves to the empty permission set; then the check; then the
     * write, so a refused revocation cannot have already deactivated the row.
     *
     * @param actingUserId the human on whose behalf this is done, asserted by the calling service
     *                     from a verified JWT — never taken from a client-supplied header
     * @throws io.restaurantos.auth.exception.UnknownRoleCodeException if the code is not in the catalog (400)
     * @throws io.restaurantos.auth.exception.RoleCeilingExceededException if the role exceeds the
     *         acting user's own permissions (403)
     */
    @Transactional
    public void revokeAsActingUser(UUID tenantId, UUID actingUserId, UUID userId,
                                   UUID branchId, String roleCode) {
        setTenantGuc(tenantId);
        roleCeiling.requireRevocable(actingUserId, roleCode);
        revoke(tenantId, actingUserId, userId, branchId, roleCode);
    }

    /**
     * Soft-deactivate the branch-role assignment (active=false).
     * A hard-delete is avoided so audit history is preserved.
     *
     * <p><b>Unbounded by design, and therefore not reachable by a human.</b> It applies no role
     * ceiling, exactly as {@link #assign(UUID, UUID, BranchRoleAssignRequest)} applies none: the
     * only caller is the provisioning saga's compensating step, undoing the OWNER assignment it
     * made moments earlier in a system context where there is no acting human at all. Every
     * networked caller acting for a person goes through {@link #revokeAsActingUser}. Adding a
     * second caller here is how the hole this method's sibling just closed comes back.
     */
    @Transactional
    public void revoke(UUID tenantId, UUID userId, UUID branchId, String roleCode) {
        revoke(tenantId, null, userId, branchId, roleCode);
    }

    private void revoke(UUID tenantId, UUID actingUserId, UUID userId, UUID branchId,
                        String roleCode) {
        setTenantGuc(tenantId);
        userBranchRoleRepository
            .findByUserIdAndBranchIdAndRoleCode(userId, branchId, roleCode)
            .ifPresent(e -> {
                boolean wasActive = e.isActive();
                e.setActive(false);
                // Same reasoning as the displacement path: the flag belongs to an active row.
                e.setPrimary(false);
                userBranchRoleRepository.save(e);
                // Only a revocation that actually removed live authority is an audit event.
                // Re-revoking an already-inactive assignment changes nothing and recording it
                // would put rows in the trail that describe no change in what anyone can do.
                if (wasActive) {
                    // The acting user now arrives EXPLICITLY from the caller, as it does on the
                    // assign path — /internal/auth/** carries no JWT, so TenantContext.getUserId()
                    // is empty here and every revocation used to be recorded with a null actor
                    // (the W-15-02 follow-up this closes). It falls back to the context, and then
                    // to null on the provisioning path where there genuinely is no acting human:
                    // recorded honestly rather than substituted with the target's own id, which is
                    // the D-34 defect that put every user in impersonation_logs down as their own
                    // impersonator. A privilege revocation that cannot say who performed it is the
                    // one audit row that most needs to.
                    events.roleRevoked(tenantId,
                        actingUserId != null ? actingUserId : tenantContext.getUserId().orElse(null),
                        userId, branchId, roleCode);
                }
            });
    }
}
