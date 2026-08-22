package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.RoleCatalogDtos.PermissionModule;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.RoleEntry;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * The role and permission catalogue as the PLATFORM control plane reads it (superadmin plan).
 *
 * <h2>Why this exists rather than the platform calling {@code GET /api/v1/roles}</h2>
 *
 * <p>It cannot. {@code JwtSigningService.signPlatformToken} mints {@code permissions=[SUPER_ADMIN]}
 * and <b>no {@code tenant_id} claim at all</b>, so a platform token fails
 * {@code RoleCatalogController}'s {@code hasAnyAuthority('rbac.manage','rbac.user.manage')} gate,
 * and even if it passed there would be no tenant for the read to be scoped to. Widening that gate
 * to admit {@code SUPER_ADMIN} was the alternative and is worse: it would put a tenant-scoped
 * endpoint into a state where its own tenant is unknown, which is how a catalogue silently answers
 * for the wrong tenant.
 *
 * <p>So the platform tier gets its own door on {@code /internal/auth/**}, carrying the tenant as a
 * parameter — the same shape {@code UserLifecycleInternalController} already uses, gated by
 * {@code InternalServiceFilter}'s constant-time shared secret, on a path the gateway maps no route
 * to (asserted live at 404 by 13-06).
 *
 * <h2>Row-level security</h2>
 *
 * <p>{@code roles} and {@code role_permissions} are both FORCE ROW LEVEL SECURITY on
 * {@code app.current_tenant_id} (changesets 032, 053 and 092). {@code /internal/**} carries no JWT,
 * so nothing has populated {@code TenantContext} and {@code TenantAwareDataSource} has written
 * {@code ''} onto the connection — under which a tenant's OWN custom roles are invisible while the
 * system roles still are not, i.e. a silently partial answer rather than an error. This class sets
 * the GUC as the first statement of the transaction for exactly that reason, and
 * {@link RoleCatalogService} deliberately does not set it itself so that a caller cannot skip it on
 * the surrounding work and still pass.
 *
 * <p>Isolation does not rest on the policy either way: {@code RoleRepository.findVisibleToTenant}
 * and {@code RolePermissionRepository.findRolePermissionPairsForTenant} both carry the tenant
 * predicate in the query, which is the half CI can assert — every integration test here runs as
 * Testcontainers' SUPERUSER, for whom row security is inert.
 *
 * <h2>Read-only, deliberately and permanently</h2>
 *
 * <p>There is no write here and none should be added. Composing a role IS granting authority
 * ({@code RoleAdminController}), the tenant tier bounds that with {@link RoleCeiling}, and the
 * platform tier holds no {@code user_branch_roles} so it has no ceiling to be bounded by. A
 * platform-tier role editor would let an operator author a role granting anything and hand it to an
 * account in any tenant — which is precisely the escalation 13-02 split {@code rbac.manage} to
 * prevent, re-created one layer up. If it is ever wanted it needs its own security review, an
 * explicit {@code actorTier} exemption, a mandatory reason and an audit event, in the shape
 * {@code ADMIN_PASSWORD_RESET} already establishes.
 */
@Service
public class RbacCatalogInternalService {

    private final RoleCatalogService roleCatalogService;
    private final EntityManager entityManager;

    public RbacCatalogInternalService(RoleCatalogService roleCatalogService,
                                      EntityManager entityManager) {
        this.roleCatalogService = roleCatalogService;
        this.entityManager = entityManager;
    }

    /**
     * Every role visible to {@code tenantId}, with its permission codes and how many people hold
     * it. A null tenant yields the system roles only.
     */
    @Transactional(readOnly = true)
    public List<RoleEntry> roles(UUID tenantId) {
        if (tenantId != null) {
            setTenantGuc(tenantId);
        }
        return roleCatalogService.listRolesForTenant(tenantId);
    }

    /**
     * The whole permission vocabulary, grouped by module.
     *
     * <p>No GUC: {@code permissions} is the one genuinely global, NON-RLS table in the trio
     * (changeset 030), and it is identical for every tenant. Setting a tenant here would imply a
     * scoping that does not exist.
     */
    @Transactional(readOnly = true)
    public List<PermissionModule> permissions() {
        return roleCatalogService.listPermissionsByModule();
    }

    /** Transaction-local tenant GUC. Must be the first statement of the transaction. */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
