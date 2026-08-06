package io.restaurantos.auth;

import io.restaurantos.auth.integration.BaseIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Changeset 055 actually applied, and applied the way it reads.
 *
 * <p>{@link WaiterRoleGrantsTest} pins what the changelog <em>says</em>; this pins what a database
 * that has run the changelog <em>contains</em>. Both are needed: the changelog can be correct and
 * still not have run (that is precisely the divergence changeset 049 exists to repair), and it can
 * run and still not mean what it looks like — the WAITER role insert is guarded by a
 * {@code WHERE NOT EXISTS} rather than {@code ON CONFLICT}, because {@code uk_roles_tenant_code}
 * spans a nullable {@code tenant_id} and therefore does not constrain system roles at all.
 *
 * <p>Every query here is a plain read. No POST is issued, so this exercises the migration without
 * depending on the HTTP stack.
 */
class RoleCatalogSeedIT extends BaseIntegrationTest {

    @Autowired JdbcTemplate jdbc;

    // ── WAITER ────────────────────────────────────────────────────────────────

    @Test
    void waiterIsSeededExactlyOnceAsASystemRole() {
        List<String> names = jdbc.queryForList(
                "SELECT name FROM roles WHERE code = 'WAITER' AND tenant_id IS NULL AND is_system",
                String.class);
        assertThat(names)
                .as("exactly one system WAITER role. Two rows would mean the WHERE NOT EXISTS guard "
                        + "is not holding — uk_roles_tenant_code does not constrain NULL tenant_id, "
                        + "so nothing else would stop a duplicate")
                .containsExactly("Waiter");
    }

    @Test
    void waiterHoldsTheOrderTakingPermissions() {
        assertThat(permissionsOf("WAITER")).contains(
                "pos.order.create",
                "pos.order.update",
                "pos.order.view",
                "pos.order.send_to_kds",
                "pos.menu.view",
                "pos.tables.manage",
                "pos.kds.view");
    }

    @Test
    void waiterHoldsNoTillVoidRefundOrPaymentPermission() {
        Long offending = jdbc.queryForObject(
                """
                SELECT COUNT(*) FROM role_permissions
                 WHERE role_code = 'WAITER'
                   AND (permission_code LIKE 'pos.till.%'
                     OR permission_code LIKE 'pos.order.void%'
                     OR permission_code = 'pos.order.refund'
                     OR permission_code = 'pos.order.close'
                     OR permission_code LIKE 'rbac.%'
                     OR permission_code LIKE 'finance.%')
                """,
                Long.class);
        assertThat(offending)
                .as("a WAITER who can open the till, void, refund or settle a bill is a CASHIER "
                        + "under another name, and seeding the role has stopped buying anything")
                .isZero();
    }

    // ── The tenant-administration split ───────────────────────────────────────

    @Test
    void tenantAdminHoldsTheThreeFineGrainedCodes() {
        assertThat(permissionsOf("TENANT_ADMIN"))
                .contains("rbac.user.manage", "rbac.role.manage", "branch.manage");
    }

    @Test
    void tenantAdminStillDoesNotHoldTheUmbrellaCode() {
        assertThat(permissionsOf("TENANT_ADMIN"))
                .as("rbac.manage is AuthServiceImpl.requiresTotpStepUp's trigger. Granting it to "
                        + "TENANT_ADMIN would force mandatory TOTP on every tenant admin as a side "
                        + "effect of an authorisation change, and a tenant admin with no enrolled "
                        + "secret would be met with TotpEnrollmentRequiredException at login — i.e. "
                        + "the fix for 'tenant admins can administer nothing' would re-break login "
                        + "for the exact persona it exists to enable. That is why the authority was "
                        + "split rather than widened, and this assertion is the split")
                .doesNotContain("rbac.manage");
    }

    @Test
    void ownerHoldsBothTheUmbrellaCodeAndTheThreeNewOnes() {
        assertThat(permissionsOf("OWNER"))
                .as("the blanket grants in 030/041/042 are point-in-time inserts and do not "
                        + "retro-grant codes added later, so 055 has to grant OWNER explicitly; "
                        + "and OWNER keeps rbac.manage, so OWNER keeps step-up")
                .contains("rbac.manage", "rbac.user.manage", "rbac.role.manage", "branch.manage");
    }

    @Test
    void everyNewCodeIsInTheCatalogAndNotOnlyInTheGrants() {
        List<String> declared = jdbc.queryForList(
                "SELECT code FROM permissions "
                        + "WHERE code IN ('rbac.user.manage', 'rbac.role.manage', 'branch.manage') "
                        + "ORDER BY code",
                String.class);
        assertThat(declared)
                .as("a code granted to a role but absent from the permissions table reaches the JWT "
                        + "and works, while anything reading the catalog to answer 'what can this "
                        + "role do' is wrong — see PermissionCatalogClosureTest")
                .containsExactly("branch.manage", "rbac.role.manage", "rbac.user.manage");
    }

    private List<String> permissionsOf(String roleCode) {
        return jdbc.queryForList(
                "SELECT permission_code FROM role_permissions WHERE role_code = ? ORDER BY permission_code",
                String.class, roleCode);
    }
}
