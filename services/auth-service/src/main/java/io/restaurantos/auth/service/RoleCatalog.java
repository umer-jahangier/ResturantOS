package io.restaurantos.auth.service;

import io.restaurantos.auth.exception.UnknownRoleCodeException;
import io.restaurantos.auth.repository.RoleRepository;
import org.springframework.stereotype.Service;

/**
 * Resolves a caller-supplied role code against the real {@code roles} catalog (D-13).
 *
 * <p>One helper rather than a check at each controller, for the reason 13-01 recorded about
 * authority derivation: a per-caller copy of a security check is how a rule comes to be enforced on
 * one path and silently absent on another. Both doors that accept a role code from outside — the
 * extended provision-admin operation and {@code BranchRoleAdminService.assign}, which is the only
 * write path for {@code user_branch_roles} — go through here.
 *
 * <h2>The tenant GUC is the caller's responsibility</h2>
 *
 * <p>{@code roles} is FORCE ROW LEVEL SECURITY under the policy
 * {@code tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid}.
 * System roles carry a null tenant and are therefore visible with no GUC at all, but a tenant's own
 * custom role is NOT — so a caller that has not set the GUC would reject a perfectly valid custom
 * role code as unknown. Every call site here is inside a transaction that has already set it, and
 * this class deliberately does not set it itself: doing so would need a tenant id it has no reason
 * to know, and would let a caller skip the GUC on the surrounding writes while still passing
 * validation.
 */
@Service
public class RoleCatalog {

    private final RoleRepository roleRepository;

    public RoleCatalog(RoleRepository roleRepository) {
        this.roleRepository = roleRepository;
    }

    /**
     * @throws UnknownRoleCodeException if the code is blank or absent from the catalog.
     * @throws IllegalStateException    if the catalog is EMPTY, which is a misconfigured database
     *                                  rather than a bad request — see below.
     */
    public void requireKnown(String roleCode) {
        if (roleCode == null || roleCode.isBlank()) {
            throw new UnknownRoleCodeException(String.valueOf(roleCode));
        }
        if (!roleRepository.findByCode(roleCode.trim()).isEmpty()) {
            return;
        }
        // An empty catalog is not a bad role code, and reporting it as one sends an operator
        // hunting a typo that is not there. The system roles are seeded by changeset 035 under
        // Liquibase context "seed" (`LIQUIBASE_CONTEXTS`, default "seed"), so a deployment that
        // narrows that variable gets a roles table with nothing in it — at which point THIS
        // validation would reject every code including OWNER and make provisioning impossible for
        // every tenant. Distinguishing the two costs one query on the failure path only.
        if (roleRepository.count() == 0) {
            throw new IllegalStateException(
                "The roles catalog is empty, so no role code can be validated. The system roles are "
                    + "seeded by changeset auth-1.0.0-035-seed-system-roles under Liquibase context "
                    + "'seed'; check LIQUIBASE_CONTEXTS on this deployment.");
        }
        throw new UnknownRoleCodeException(roleCode);
    }
}
