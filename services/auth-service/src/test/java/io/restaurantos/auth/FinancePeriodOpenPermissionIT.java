package io.restaurantos.auth;

import io.restaurantos.auth.integration.BaseIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DB-assertion integration test for changeset 044 — proves:
 * 1. finance.period.open is granted to exactly OWNER, TENANT_ADMIN, and ACCOUNTANT.
 * 2. finance.period.open is NOT granted to CASHIER, MANAGER, KITCHEN_STAFF, or INVENTORY_MANAGER.
 * 3. The finance.period.open permission row exists in the permissions table.
 *
 * Runs Liquibase (including changeset 044) against a fresh Testcontainers Postgres instance,
 * so this is the authoritative proof the changeset applies cleanly and grants exactly the
 * intended role set (RESEARCH.md Pitfall 4 — OWNER/TENANT_ADMIN do NOT retroactively receive
 * new permission codes via changeset 036's one-time wildcard SELECT).
 */
class FinancePeriodOpenPermissionIT extends BaseIntegrationTest {

    @Autowired JdbcTemplate jdbc;

    @Test
    void financePeriodOpen_grantedToExactlyOwnerTenantAdminAccountant() {
        List<String> roleCodes = jdbc.queryForList(
            "SELECT role_code FROM role_permissions WHERE permission_code = 'finance.period.open'",
            String.class
        );
        assertThat(roleCodes).containsExactlyInAnyOrder("OWNER", "TENANT_ADMIN", "ACCOUNTANT");
    }

    @Test
    void financePeriodOpen_notGrantedToCashierOrManager() {
        List<String> roleCodes = jdbc.queryForList(
            "SELECT role_code FROM role_permissions WHERE permission_code = 'finance.period.open'",
            String.class
        );
        assertThat(roleCodes).doesNotContain("CASHIER", "MANAGER", "KITCHEN_STAFF", "INVENTORY_MANAGER");
    }

    @Test
    void financePeriodOpen_permissionRowExists() {
        Long count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM permissions WHERE code = 'finance.period.open'",
            Long.class
        );
        assertThat(count).isEqualTo(1L);
    }
}
