package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.RoleCatalogDtos.AssignableRoles;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.PermissionEntry;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.PermissionModule;
import io.restaurantos.auth.dto.response.RoleCatalogDtos.RoleEntry;
import io.restaurantos.auth.entity.PermissionEntity;
import io.restaurantos.auth.entity.RoleEntity;
import io.restaurantos.auth.repository.PermissionRepository;
import io.restaurantos.auth.repository.RolePermissionRepository;
import io.restaurantos.auth.repository.RoleRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * The discovery half of user administration (D-14): which roles may I assign, and what does the
 * platform's permission vocabulary look like?
 *
 * <p>13-06 made an unknown {@code roleCode} a hard {@code 400 UNKNOWN_ROLE_CODE} on the only write
 * path for {@code user_branch_roles}. A validator that rejects what a caller cannot discover is
 * only half a contract, and this is the other half. Both read the SAME three tables — {@code
 * roles}, {@code permissions}, {@code role_permissions} — so the catalog cannot advertise a code
 * assignment refuses, or hide one it accepts. Nothing here is a list maintained in Java; adding a
 * role in a changeset adds it to this response with no code change, which is the property
 * {@code scripts/e2e/phase13-role-catalog-e2e.sh} closes the loop on by assigning every code the
 * catalog returns.
 *
 * <h2>Row-level security</h2>
 *
 * <p>The plan for this work asserted that all three tables are global and need no tenant GUC. That
 * is true of {@code permissions} and {@code role_permissions} and <b>false of {@code roles}</b>,
 * which is {@code FORCE ROW LEVEL SECURITY} under
 * {@code tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid}
 * (changesets 032 and 053). Measured, not assumed — see 13-07-SUMMARY.
 *
 * <p>Both callers of this service arrive with a JWT, so {@code JwtAuthenticationFilter} has
 * populated {@code TenantContext} and {@code TenantAwareDataSource} has already set the GUC on the
 * connection. This class therefore sets no GUC itself, exactly as {@code RoleCatalog} does not —
 * and for the same reason: a class that sets the GUC for its own read lets a caller skip it on the
 * surrounding work while still passing.
 *
 * <p>It does <b>not</b> rely on that policy for tenant isolation. See
 * {@link RoleRepository#findVisibleToTenant} — every integration test in this repository runs as a
 * SUPERUSER, for which the policy is inert, so the query carries the predicate itself.
 */
@Service
public class RoleCatalogService {

    private final RoleRepository roleRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final PermissionRepository permissionRepository;

    public RoleCatalogService(RoleRepository roleRepository,
                              RolePermissionRepository rolePermissionRepository,
                              PermissionRepository permissionRepository) {
        this.roleRepository = roleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.permissionRepository = permissionRepository;
    }

    /**
     * The roles {@code tenantId} owns or inherits, restricted to those the caller may actually
     * grant.
     *
     * <h2>The ceiling</h2>
     *
     * <p>A role is assignable by a caller only if every permission it grants is one the caller
     * already holds. Without that rule the role picker is a privilege-escalation control:
     * TENANT_ADMIN deliberately does not hold {@code rbac.manage} (13-02 split the authority so
     * that it would not), but it does hold {@code rbac.role.manage} — so it could grant OWNER to an
     * account it controls, log in as that account, and hold the umbrella permission its own role
     * was designed to withhold. Withholding the role from the catalog is the visible half of
     * closing that; see 13-07-SUMMARY for the measured state of the write path, which this plan
     * does not own.
     *
     * <p><b>Derived, never enumerated.</b> The rule is computed from {@code role_permissions}, so
     * it needs no maintenance when a role's grants change and cannot disagree with them. A
     * hardcoded "TENANT_ADMIN may not assign OWNER" would be right today and wrong the moment
     * someone adds a role — which is the drift class this codebase has hit five times over
     * permission codes alone.
     *
     * <p><b>It fails closed, and loudly.</b> If a permission is ever added to the catalog and not
     * back-granted to OWNER, OWNER stops being able to assign every role that DOES hold it. That is
     * a real inconsistency in the grant lattice rather than an artefact of this rule, it withholds
     * rather than over-grants, and it is surfaced in the response as a warning count rather than a
     * role silently vanishing from a picker.
     *
     * <p>Exactly two queries, regardless of how many roles exist (T-13-07-D).
     */
    @Transactional(readOnly = true)
    public AssignableRoles listAssignableRoles(UUID tenantId, Collection<String> callerPermissions) {
        Map<String, RoleEntity> byCode = distinctByCode(roleRepository.findVisibleToTenant(tenantId));
        Map<String, List<String>> permissionsByRole = permissionsFor(byCode.keySet());
        Set<String> ceiling = callerPermissions == null ? Set.of() : Set.copyOf(callerPermissions);

        List<RoleEntry> assignable = new ArrayList<>();
        int withheld = 0;
        for (Map.Entry<String, RoleEntity> entry : byCode.entrySet()) {
            List<String> granted = permissionsByRole.getOrDefault(entry.getKey(), List.of());
            if (!ceiling.containsAll(granted)) {
                withheld++;
                continue;
            }
            RoleEntity role = entry.getValue();
            assignable.add(new RoleEntry(role.getCode(), role.getName(), role.isSystem(), granted));
        }
        return new AssignableRoles(List.copyOf(assignable), withheld);
    }

    /**
     * The whole permission vocabulary, grouped by module.
     *
     * <p>Grouped here rather than by the caller so that every client groups it the same way, and so
     * the module dimension is part of the contract instead of something each UI re-derives by
     * splitting codes on a dot — which would break the day a module name contains one.
     *
     * <p>Deliberately NOT ceiling-filtered, unlike the role list. A permission code is not
     * assignable: no endpoint in this system accepts one from a caller, so seeing
     * {@code rbac.manage} in a legend grants nobody anything, while hiding it would make an admin
     * screen unable to explain the role it is already allowed to see.
     */
    @Transactional(readOnly = true)
    public List<PermissionModule> listPermissionsByModule() {
        List<PermissionModule> modules = new ArrayList<>();
        String currentModule = null;
        List<PermissionEntry> current = null;
        // The query returns module-major, code-minor, so one pass is enough and the output order
        // is the database's rather than a re-sort that could disagree with it.
        for (PermissionEntity permission : permissionRepository.findAllByOrderByModuleAscCodeAsc()) {
            if (!permission.getModule().equals(currentModule)) {
                if (current != null) {
                    modules.add(new PermissionModule(currentModule, List.copyOf(current)));
                }
                currentModule = permission.getModule();
                current = new ArrayList<>();
            }
            current.add(new PermissionEntry(
                permission.getCode(), permission.getModule(), permission.getDescription()));
        }
        if (current != null) {
            modules.add(new PermissionModule(currentModule, List.copyOf(current)));
        }
        return List.copyOf(modules);
    }

    /**
     * One row per role CODE, code-sorted, preferring the tenant's own definition.
     *
     * <p>{@code uk_roles_tenant_code} spans {@code (tenant_id, code)}, so a code can legitimately
     * exist twice — once as a system role with a null tenant and once as a tenant override — and
     * the RLS policy makes both visible at once. That duplication is the same fact
     * {@link RoleRepository#findByCode} returns a {@code List} for. A catalog must not list the
     * code twice, and when a tenant has overridden a system role its own row is the one a picker
     * should show.
     */
    private static Map<String, RoleEntity> distinctByCode(List<RoleEntity> roles) {
        Map<String, RoleEntity> byCode = new LinkedHashMap<>();
        for (RoleEntity role : roles) {
            byCode.merge(role.getCode(), role,
                (incumbent, candidate) -> candidate.getTenantId() != null ? candidate : incumbent);
        }
        return byCode;
    }

    /** Role code to its sorted permission codes, in ONE query for every role (T-13-07-D). */
    private Map<String, List<String>> permissionsFor(Set<String> roleCodes) {
        if (roleCodes.isEmpty()) {
            return Map.of();
        }
        Map<String, TreeSet<String>> sorted = new LinkedHashMap<>();
        for (var pair : rolePermissionRepository.findRolePermissionPairs(roleCodes)) {
            sorted.computeIfAbsent(pair.getRoleCode(), code -> new TreeSet<>())
                .add(pair.getPermissionCode());
        }
        Map<String, List<String>> result = new LinkedHashMap<>();
        sorted.forEach((code, codes) -> result.put(code, List.copyOf(codes)));
        return result;
    }
}
