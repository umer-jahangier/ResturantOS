package io.restaurantos.auth.service;

import io.restaurantos.auth.exception.RoleCeilingExceededException;
import io.restaurantos.auth.repository.RolePermissionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * One implementation of "may this caller grant that role?", shared by the read side and the write
 * side so the two cannot disagree.
 *
 * <h2>The rule</h2>
 *
 * <p><b>A role is assignable by a caller only if every permission it grants is one the caller
 * already holds.</b> 13-07 derived that rule and applied it to {@code GET /api/v1/roles}, which is
 * why a tenant admin is not offered OWNER. It applied to nothing else, and the consequence was
 * measured live rather than argued: {@code POST /internal/auth/users/&#123;id&#125;/branch-roles}
 * with {@code {"roleCode":"OWNER"}} was answered <b>200</b> for a TENANT_ADMIN, who could then log
 * in as that account holding {@code rbac.manage} — the umbrella permission 13-02 split the
 * tenant-administration authority precisely in order to withhold from them.
 *
 * <p>A picker that hides a role while the write path accepts it is not a control; it is a hint.
 * Both sides now call {@link #permits}, so a change to the rule is a change to one method.
 *
 * <h2>Derived, never enumerated</h2>
 *
 * <p>Computed from {@code role_permissions}. A hardcoded "TENANT_ADMIN may not assign OWNER" would
 * be correct today and wrong the moment someone adds a role — the drift class this repository has
 * hit repeatedly over permission codes alone, and which changeset 057 exists to repair one instance
 * of.
 *
 * <h2>Where the caller's permissions come from</h2>
 *
 * <p>{@link #requireAssignable} takes an acting USER ID, not a permission list, and recomputes that
 * user's permissions here against {@code user_branch_roles} and {@code role_permissions}. A
 * forwarded permission list would be a claim about authority made by the party whose authority is
 * in question, and it can be stale — a role revoked a second ago is still in a token minted a
 * minute ago. Recomputing costs two queries and cannot be lied to.
 *
 * <p>It resolves at the acting user's <b>default (primary) branch</b>, which is what
 * {@code PermissionResolver.selectDefaultBranch} picks and is therefore deterministic and
 * server-chosen. A user who holds a narrower role at their primary branch than at some other branch
 * is bounded by the narrower one: that direction is the fail-closed one, and the alternative —
 * accepting a branch id from the caller — would let the caller choose which of their own roles to
 * be measured against.
 *
 * <h2>It fails closed</h2>
 *
 * <p>An acting user with no resolvable active assignment holds no permissions and can therefore
 * assign only a role that grants none. That is a refusal, not an error swallowed into a pass.
 */
@Service
public class RoleCeiling {

    private final RolePermissionRepository rolePermissionRepository;
    private final PermissionResolver permissionResolver;
    private final RoleCatalog roleCatalog;

    public RoleCeiling(RolePermissionRepository rolePermissionRepository,
                       PermissionResolver permissionResolver,
                       RoleCatalog roleCatalog) {
        this.rolePermissionRepository = rolePermissionRepository;
        this.permissionResolver = permissionResolver;
        this.roleCatalog = roleCatalog;
    }

    /**
     * The predicate itself, with no I/O, so both call sites share the exact comparison.
     *
     * <p>A null or empty caller set permits only a role that grants nothing — the fail-closed
     * reading of "you may grant no more than you hold".
     */
    public static boolean permits(Collection<String> callerPermissions,
                                  Collection<String> rolePermissions) {
        if (rolePermissions == null || rolePermissions.isEmpty()) {
            return true;
        }
        return callerPermissions != null && Set.copyOf(callerPermissions).containsAll(rolePermissions);
    }

    /**
     * Refuses unless {@code actingUserId} may grant {@code roleCode}.
     *
     * <p>Must be called inside a transaction whose tenant GUC is already set: it reads
     * {@code user_branch_roles} (FORCE ROW LEVEL SECURITY) and validates the code against
     * {@code roles} (also FORCE, and where a tenant's own custom role is invisible without the
     * GUC). Ordering inside is load-bearing — the code is validated FIRST, because an unknown role
     * has no permission rows at all and would otherwise sail through the subset test and be
     * reported as an authorization success rather than as the typo it is.
     *
     * @throws io.restaurantos.auth.exception.UnknownRoleCodeException if the code is not in the catalog (400)
     * @throws RoleCeilingExceededException if the role grants anything the acting user lacks (403)
     */
    @Transactional
    public void requireAssignable(UUID actingUserId, String roleCode) {
        roleCatalog.requireKnown(roleCode);

        List<String> rolePermissions = permissionsOfRole(roleCode);
        Set<String> callerPermissions = permissionsOfActingUser(actingUserId);

        if (permits(callerPermissions, rolePermissions)) {
            return;
        }
        int beyond = (int) rolePermissions.stream().filter(code -> !callerPermissions.contains(code)).count();
        throw new RoleCeilingExceededException(roleCode.trim(), beyond);
    }

    /**
     * Refuses unless {@code actingUserId} may administer a user holding {@code targetRoleCodes}.
     *
     * <p>The same ceiling, applied to the other direction. Granting is not the only way authority
     * leaks: a TENANT_ADMIN who can <em>deactivate</em> the OWNER can lock the only holder of
     * {@code rbac.manage} out of their own tenant, and one who can rename them can make an account
     * unrecognisable before doing something else with it. Neither is an escalation, but both let a
     * lesser role act on a greater one, and the fix is the rule that already exists rather than a
     * second one.
     *
     * <p>A user with no active assignment holds nothing and is administerable by anyone with the
     * authority to reach this code — which is what makes a freshly created, not-yet-assigned account
     * editable.
     *
     * <p>Must be called inside a transaction whose tenant GUC is already set.
     *
     * @throws RoleCeilingExceededException if any of the target's roles exceeds the acting user's
     *         own permissions (403)
     */
    @Transactional
    public void requireMayAdminister(UUID actingUserId, Collection<String> targetRoleCodes) {
        if (targetRoleCodes == null || targetRoleCodes.isEmpty()) {
            return;
        }
        Set<String> callerPermissions = permissionsOfActingUser(actingUserId);
        for (String roleCode : targetRoleCodes) {
            List<String> rolePermissions = permissionsOfRole(roleCode);
            if (permits(callerPermissions, rolePermissions)) {
                continue;
            }
            int beyond = (int) rolePermissions.stream().filter(c -> !callerPermissions.contains(c)).count();
            throw new RoleCeilingExceededException(
                "You cannot administer a user holding the role " + roleCode + ": it grants "
                    + beyond + " permission(s) you do not hold yourself");
        }
    }

    /** The permission codes a role grants, sorted and de-duplicated. */
    public List<String> permissionsOfRole(String roleCode) {
        return rolePermissionRepository
            .findPermissionCodesByRoleCodes(List.of(roleCode.trim()))
            .stream()
            .distinct()
            .sorted()
            .toList();
    }

    /**
     * What the acting user may actually do, computed here rather than taken on trust.
     *
     * <p>An acting user who cannot be resolved — unknown id, a user in another tenant (invisible
     * under the tenant GUC), or one with no active branch assignment — yields the empty set rather
     * than an exception. Empty is the correct answer and the safe one: it permits only a role that
     * grants nothing, so a caller cannot obtain authority by naming a user id that does not resolve.
     */
    private Set<String> permissionsOfActingUser(UUID actingUserId) {
        if (actingUserId == null) {
            return Set.of();
        }
        try {
            return new TreeSet<>(permissionResolver.resolveDefault(actingUserId).permissions());
        } catch (IllegalStateException unresolvable) {
            return Set.of();
        }
    }
}
