package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuthRbacCatalogClient;
import io.restaurantos.platform.dto.PlatformUserDtos.MatrixRow;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformPermission;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformPermissionModule;
import io.restaurantos.platform.dto.PlatformUserDtos.PlatformRole;
import io.restaurantos.platform.dto.PlatformUserDtos.RoleCatalogResponse;
import io.restaurantos.platform.dto.PlatformUserDtos.RolePermissionMatrix;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The platform tier's READ-ONLY view of the authorization model (superadmin plan).
 *
 * <h2>Why read-only is the design and not a first cut</h2>
 *
 * <p>Composing a role IS granting authority. The tenant tier bounds that with the role ceiling —
 * an assigner may only grant a role whose permissions are a subset of their own, recomputed from
 * the database on every call ({@code RoleCeiling}). A platform operator holds no
 * {@code user_branch_roles} at all, so that rule resolves the empty permission set against them:
 * there is nothing to bound a platform-tier role editor with.
 *
 * <p>13-02 split {@code rbac.manage} out of {@code rbac.role.manage} precisely so a TENANT_ADMIN
 * could not compose themselves an OWNER, log in as it, and hold the umbrella permission their own
 * role was designed to withhold. A platform-tier role editor hands that same capability back one
 * layer up, to a principal with a wider reach and no ceiling. <b>This module does not undo that,
 * and the reason travels in the response</b> — see {@link RoleCatalogResponse#READ_ONLY_REASON} —
 * so that a console developer reading the payload learns why there is nothing to call, rather than
 * filing it as a missing endpoint.
 *
 * <p>Tenant custom roles remain editable by that tenant's own administrators through
 * {@code POST/PUT/DELETE /api/v1/roles}, which keeps its ceiling. System roles are seeded by
 * Liquibase and are not editable by anyone, at any tier, by construction.
 *
 * <h2>Where the data comes from</h2>
 *
 * <p>{@code auth_db}, over {@code /internal/auth/rbac/**}. The public {@code GET /api/v1/roles} is
 * unreachable to a platform token: it is gated on {@code rbac.*} authorities that a SuperAdmin does
 * not hold, and it scopes itself from a {@code tenant_id} claim that a platform token does not
 * carry. Both {@code roles} and {@code role_permissions} are FORCE row-level security on a GUC the
 * platform plane cannot populate, which is why the internal read sets it from a parameter instead.
 */
@Service
public class PlatformRbacService {

    /** No tenant named: the answer is the global catalogue, and the scope says so. */
    private static final String SCOPE_GLOBAL = "GLOBAL";
    private static final String SCOPE_TENANT = "TENANT";

    private final AuthRbacCatalogClient rbac;
    private final TenantRepository tenantRepository;

    public PlatformRbacService(AuthRbacCatalogClient rbac, TenantRepository tenantRepository) {
        this.rbac = rbac;
        this.tenantRepository = tenantRepository;
    }

    /**
     * The permission vocabulary, grouped by module.
     *
     * <p>Global and identical for every tenant — {@code permissions} is the one non-RLS table of the
     * three — so this takes no tenant and must not grow one.
     *
     * <p>The count is deliberately NOT asserted anywhere in this service. The brief says 79 codes
     * and the changelogs declare within one of that; the exact number is a property of the database
     * and is read from it, never hardcoded. A constant here would be right on the day it was
     * written and wrong after the next changeset — the drift class this repository has hit
     * repeatedly over permission codes, and which {@code PermissionCatalogClosureTest} exists to
     * catch on the other side.
     */
    public List<PlatformPermissionModule> permissions() {
        var response = rbac.permissions();
        List<AuthRbacCatalogClient.PermissionModule> modules =
            response == null || response.data() == null ? List.of() : response.data();
        return modules.stream()
            .map(module -> new PlatformPermissionModule(module.module(),
                (module.permissions() == null ? List.<AuthRbacCatalogClient.PermissionEntry>of()
                    : module.permissions()).stream()
                    .map(p -> new PlatformPermission(p.code(), p.module(), p.description()))
                    .toList()))
            .toList();
    }

    /**
     * The role catalogue, for one tenant or globally.
     *
     * <p>An unknown {@code tenantId} is <b>404 from this service</b>, resolved locally before the
     * upstream call. Without that check a typo'd tenant id would produce the system-role catalogue
     * with a 200 — an answer that looks correct, is correct for SOME tenant, and is not the one
     * asked about.
     */
    public RoleCatalogResponse roles(UUID tenantId) {
        requireTenantIfNamed(tenantId);
        return new RoleCatalogResponse(tenantId, scopeOf(tenantId), fetchRoles(tenantId),
            RoleCatalogResponse.READ_ONLY_REASON);
    }

    /**
     * The role x permission matrix, in the shape a grid renders.
     *
     * <p>Derived here rather than left to the client. Every client would otherwise re-derive the
     * column order, and two consoles showing the same matrix in different column orders produce a
     * diff nobody can read. The columns are the WHOLE vocabulary in the catalogue's own
     * module-major order — the database's order — so the grid and the legend beside it cannot
     * disagree.
     *
     * <p><b>The columns are every permission that exists, not only the granted ones.</b> A matrix
     * that omits ungranted columns cannot answer the question it is usually opened for: "what can
     * nobody do?" — an orphaned permission that no role grants is a real and recurring defect here
     * (a gate naming a code no role holds produces a clean 403 for every user including OWNER,
     * which the changelog carries repair changesets for).
     *
     * <p>Grants are carried as a SET of codes per row rather than a positional boolean array,
     * because adding a permission to the vocabulary would otherwise shift every role's grants by
     * one column in any client that had cached the header.
     */
    public RolePermissionMatrix matrix(UUID tenantId) {
        requireTenantIfNamed(tenantId);

        List<String> columns = new ArrayList<>();
        for (PlatformPermissionModule module : permissions()) {
            for (PlatformPermission permission : module.permissions()) {
                columns.add(permission.code());
            }
        }

        List<MatrixRow> rows = fetchRoles(tenantId).stream()
            .map(role -> new MatrixRow(role.code(), role.name(), role.system(),
                role.permissions(), role.assignedUserCount()))
            .toList();

        return new RolePermissionMatrix(tenantId, scopeOf(tenantId), List.copyOf(columns), rows,
            RoleCatalogResponse.READ_ONLY_REASON);
    }

    // ───────────────────────────────── internals ─────────────────────────────────

    private List<PlatformRole> fetchRoles(UUID tenantId) {
        var response = rbac.roles(tenantId);
        List<AuthRbacCatalogClient.RoleEntry> entries =
            response == null || response.data() == null ? List.of() : response.data();
        return entries.stream()
            .map(role -> new PlatformRole(role.code(), role.name(), role.system(),
                role.permissions() == null ? List.of() : List.copyOf(role.permissions()),
                role.assignedUserCount(),
                // Always false, and a FIELD rather than an omission so a console renders
                // "read-only" from the API instead of hardcoding an assumption that could go
                // stale in the direction that matters.
                false))
            .toList();
    }

    private void requireTenantIfNamed(UUID tenantId) {
        if (tenantId != null && !tenantRepository.existsById(tenantId)) {
            throw new ResourceNotFoundException("Tenant not found: " + tenantId);
        }
    }

    private static String scopeOf(UUID tenantId) {
        return tenantId == null ? SCOPE_GLOBAL : SCOPE_TENANT;
    }
}
