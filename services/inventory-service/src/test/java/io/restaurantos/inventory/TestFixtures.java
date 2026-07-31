package io.restaurantos.inventory;

import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Tenant/JWT/context test-fixture helpers shared by every inventory-service integration
 * test. Entity-independent (see InventoryTestBase) — this class only builds UUIDs,
 * JwtClaims-based principals, and TenantContext activation, never a Phase-8 domain entity.
 */
public final class TestFixtures {

    /** View permission granted to OWNER, MANAGER, and INVENTORY_MANAGER roles. */
    public static final String INVENTORY_ITEM_VIEW = "inventory.item.view";

    /** Manage (create/update) permission granted to OWNER, MANAGER, and INVENTORY_MANAGER roles. */
    public static final String INVENTORY_ITEM_MANAGE = "inventory.item.manage";

    private TestFixtures() {}

    /** A fresh random tenant/branch UUID pair for a single test. */
    public record TenantBranch(UUID tenantId, UUID branchId) {}

    public static TenantBranch newTenantBranch() {
        return new TenantBranch(UUID.randomUUID(), UUID.randomUUID());
    }

    /**
     * Activates the given TenantContext for the current thread — the same
     * (tenantId, branchId, userId, impersonatedBy) shape every existing service IT uses
     * (e.g. KitchenTestBase-derived ITs' {@code tenantContext.set(tenantId, branchId, null, null)}).
     */
    public static void activateTenantContext(TenantContext tenantContext, UUID tenantId, UUID branchId, UUID userId) {
        tenantContext.set(tenantId, branchId, userId, null);
    }

    public static JwtClaims ownerClaims(UUID tenantId, UUID branchId) {
        return claims(tenantId, branchId, List.of("OWNER"), List.of(INVENTORY_ITEM_VIEW, INVENTORY_ITEM_MANAGE));
    }

    public static JwtClaims managerClaims(UUID tenantId, UUID branchId) {
        return claims(tenantId, branchId, List.of("MANAGER"), List.of(INVENTORY_ITEM_VIEW, INVENTORY_ITEM_MANAGE));
    }

    /** INVENTORY_MANAGER: the phase-8-specific role, carrying both inventory permissions. */
    public static JwtClaims inventoryManagerClaims(UUID tenantId, UUID branchId) {
        return claims(tenantId, branchId, List.of("INVENTORY_MANAGER"),
                List.of(INVENTORY_ITEM_VIEW, INVENTORY_ITEM_MANAGE));
    }

    public static JwtClaims claims(UUID tenantId, UUID branchId, List<String> roles, List<String> permissions) {
        return new JwtClaims(UUID.randomUUID(), tenantId, branchId, roles, permissions, Map.of(), null);
    }

    /** Installs the given claims as the Spring Security principal for the current thread. */
    public static void authenticateAs(JwtClaims claims) {
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(claims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    @FunctionalInterface
    public interface TenantScopedAction {
        void run(Connection connection) throws SQLException;
    }

    /**
     * Opens a raw JDBC connection with the RLS GUC ({@code app.current_tenant_id}) set to
     * the given tenant, then runs the supplied action on it — for RLS-scoped raw seeding
     * that bypasses the JPA/tenant-context layer (e.g. cross-tenant fixture setup where the
     * test needs two tenants' rows to exist simultaneously).
     */
    public static void withTenantScope(DataSource dataSource, UUID tenantId, TenantScopedAction action) {
        try (Connection connection = dataSource.getConnection()) {
            try (Statement stmt = connection.createStatement()) {
                stmt.execute("SET app.current_tenant_id = '" + tenantId + "'");
            }
            action.run(connection);
        } catch (SQLException e) {
            throw new IllegalStateException("Failed to run tenant-scoped JDBC action", e);
        }
    }
}
