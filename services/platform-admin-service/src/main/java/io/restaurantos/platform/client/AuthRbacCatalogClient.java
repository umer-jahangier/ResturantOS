package io.restaurantos.platform.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.UUID;

/**
 * The role and permission catalogue as the platform plane reads it (superadmin plan).
 *
 * <h2>Why the public catalogue endpoints could not be used</h2>
 *
 * <p>{@code GET /api/v1/roles} and {@code GET /api/v1/permissions} are gated
 * {@code hasAnyAuthority('rbac.manage','rbac.user.manage')}, and a platform token holds exactly one
 * authority. {@code JwtSigningService.signPlatformToken} mints {@code permissions=[SUPER_ADMIN]},
 * {@code roles=[SUPER_ADMIN]} and <b>no {@code tenant_id} claim at all</b> — authorities are built
 * from the {@code permissions} claim alone, so a SuperAdmin matches no {@code rbac.*} gate. Even
 * with the gate widened the read would have no tenant to scope to, and both {@code roles} and
 * {@code role_permissions} are FORCE ROW LEVEL SECURITY on a GUC the platform plane cannot
 * populate.
 *
 * <p>So the platform tier gets its own internal door carrying the tenant as a parameter — the same
 * shape the user seam already uses. Widening the public gate instead would have left a
 * tenant-scoped endpoint in a state where its own tenant is unknown, which is how a catalogue
 * silently answers for the wrong tenant.
 *
 * <h2>Read-only, and permanently so</h2>
 *
 * <p>There is no write method here and none should be added. Composing a role IS granting
 * authority; the tenant tier bounds that with the role ceiling, and the platform tier holds no
 * {@code user_branch_roles} so there is nothing to bound it with. A platform-tier role editor would
 * let an operator author a role granting anything and hand it to an account in any tenant — exactly
 * the escalation 13-02 split {@code rbac.manage} to prevent, re-created one layer up.
 *
 * <p>{@code contextId} is mandatory — see {@link AuthUserDirectoryClient} for why.
 */
@FeignClient(
    name = "auth-service",
    contextId = "authRbacCatalogClient",
    url = "${restaurantos.auth-service.uri:}",
    configuration = FeignSharedConfig.class
)
public interface AuthRbacCatalogClient {

    /**
     * The whole permission vocabulary, grouped by module.
     *
     * <p>Takes no tenant and must not grow one: {@code permissions} is the one genuinely global,
     * non-RLS table of the three (changeset 030) and is identical for every tenant.
     */
    @GetMapping("/internal/auth/rbac/permissions")
    PermissionCatalogResponse permissions();

    /**
     * Every role visible to a tenant — the system roles plus that tenant's own custom ones —
     * unfiltered by any ceiling.
     *
     * <p>{@code tenantId} omitted is meaningful rather than sloppy: it means "the global
     * catalogue", and yields the system roles only. It is not defaulted to a tenant and it fails
     * closed.
     */
    @GetMapping("/internal/auth/rbac/roles")
    RoleCatalogResponse roles(@RequestParam(value = "tenantId", required = false) UUID tenantId);

    // -- Typed contracts, mirroring auth-service's RoleCatalogDtos ------------------------------

    /** {@code ApiResponse.ok} around {@code List<PermissionModule>}. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record PermissionCatalogResponse(List<PermissionModule> data) {}

    /** {@code ApiResponse.ok} around {@code List<RoleEntry>}. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record RoleCatalogResponse(List<RoleEntry> data) {}

    /** {@code RoleCatalogDtos.PermissionModule} - one module and the permissions it owns. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record PermissionModule(String module, List<PermissionEntry> permissions) {}

    /**
     * {@code RoleCatalogDtos.PermissionEntry}.
     *
     * <p>{@code module} is repeated inside the entry even though the entry sits in its module's
     * group, because any client filling a search box flattens the response and would otherwise lose
     * the grouping dimension entirely.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record PermissionEntry(String code, String module, String description) {}

    /**
     * {@code RoleCatalogDtos.RoleEntry}.
     *
     * @param system true for a platform-defined role ({@code tenant_id IS NULL}), false for one a
     *               tenant defined. The distinction is load-bearing on a platform screen: a system
     *               role is global and identical for every tenant, a tenant role is not.
     * @param assignedUserCount how many DISTINCT people in that tenant hold the role. Zero for a
     *               role nobody holds, never null — and it is the same number the tenant-tier
     *               delete refusal counts, read from the same query, so the two cannot disagree.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record RoleEntry(String code, String name, boolean system, List<String> permissions,
                     long assignedUserCount) {}
}
