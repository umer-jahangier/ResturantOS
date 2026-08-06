package io.restaurantos.auth;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.integration.BaseIntegrationTest;
import io.restaurantos.auth.integration.TestFixtures;
import io.restaurantos.auth.service.BranchRoleAdminService;
import io.restaurantos.auth.service.PermissionResolver;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * One active role per user per branch — enforced by the database, not by a crash at login.
 *
 * <p>{@code user_branch_roles} has a unique constraint spanning
 * {@code (tenant_id, user_id, branch_id, role_code)}, which permits a user to hold CASHIER
 * <em>and</em> MANAGER at the same branch. Nothing rejected that, and nothing coped with it:
 * {@code PermissionResolver} asked for an {@code Optional} and Spring Data answered
 * {@code IncorrectResultSizeDataAccessException}, so the second assignment did not degrade the
 * user's login — it ended it. A 500 on the credential path, caused by a row that an administrator
 * was allowed to write.
 *
 * <p>These tests deliberately go through {@link BranchRoleAdminService} and
 * {@link PermissionResolver} directly rather than over HTTP: the invariant being proved is about
 * the database and the write path, and routing it through Tomcat would only add a way for the test
 * to fail for reasons that have nothing to do with the invariant.
 *
 * <p>Each test uses its own branch id and never touches the seeded {@code b0000001} / {@code
 * b0000002} assignments, because {@code BranchSwitchIT} and {@code AuthLoginIT} assert on those and
 * share this database.
 */
class OneActiveRolePerBranchIT extends BaseIntegrationTest {

    @Autowired BranchRoleAdminService branchRoleAdminService;
    @Autowired PermissionResolver permissionResolver;
    @Autowired JdbcTemplate jdbc;

    private static final UUID USER = TestFixtures.CASHIER_USER_ID;
    private static final UUID TENANT = TestFixtures.DEMO_TENANT_ID;

    private static final UUID BRANCH_DISPLACE = UUID.fromString("b0000031-0000-4000-8000-000000000031");
    private static final UUID BRANCH_IDEMPOTENT = UUID.fromString("b0000032-0000-4000-8000-000000000032");
    private static final UUID BRANCH_DIRECT_SQL = UUID.fromString("b0000033-0000-4000-8000-000000000033");
    private static final UUID BRANCH_RESOLVE = UUID.fromString("b0000034-0000-4000-8000-000000000034");

    // ── The invariant, at the level that actually holds it ────────────────────

    @Test
    void aSecondActiveRowForTheSamePairIsRejectedByTheDatabase() {
        branchRoleAdminService.assign(TENANT, USER, assignment(BRANCH_DIRECT_SQL, "CASHIER"));

        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO user_branch_roles (id, tenant_id, user_id, branch_id, role_code, is_active) "
                        + "VALUES (?, ?, ?, ?, 'MANAGER', true)",
                UUID.randomUUID(), TENANT, USER, BRANCH_DIRECT_SQL))
                .as("the constraint has to live in the database. Enforcing it only in the service "
                        + "leaves every other writer — a repair script, a psql session, a future "
                        + "service — free to create the row that ends this user's login")
                .isInstanceOf(DataAccessException.class);
    }

    // ── The write path ────────────────────────────────────────────────────────

    @Test
    void assigningADifferentRoleAtTheSameBranchReplacesRatherThanAdds() {
        branchRoleAdminService.assign(TENANT, USER, assignment(BRANCH_DISPLACE, "CASHIER"));
        branchRoleAdminService.assign(TENANT, USER, assignment(BRANCH_DISPLACE, "WAITER"));

        assertThat(activeRoleCodesAt(BRANCH_DISPLACE))
                .as("a second role at the same branch is a replacement, not an addition — permission "
                        + "unions across roles are not supported, because the JWT's roles claim is "
                        + "singular and every downstream consumer of it assumes so")
                .containsExactly("WAITER");
    }

    @Test
    void assigningTheSameRoleTwiceIsIdempotent() {
        branchRoleAdminService.assign(TENANT, USER, assignment(BRANCH_IDEMPOTENT, "WAITER"));
        branchRoleAdminService.assign(TENANT, USER, assignment(BRANCH_IDEMPOTENT, "WAITER"));

        assertThat(activeRoleCodesAt(BRANCH_IDEMPOTENT)).containsExactly("WAITER");
    }

    // ── The read path this all exists to protect ──────────────────────────────

    @Test
    void resolvingPermissionsAfterAReassignmentReturnsOneRoleAndDoesNotThrow() {
        branchRoleAdminService.assign(TENANT, USER, assignment(BRANCH_RESOLVE, "CASHIER"));
        branchRoleAdminService.assign(TENANT, USER, assignment(BRANCH_RESOLVE, "WAITER"));

        assertThatCode(() -> {
            var resolved = permissionResolver.resolve(USER, BRANCH_RESOLVE);
            assertThat(resolved.roles()).containsExactly("WAITER");
            assertThat(resolved.permissions()).contains("pos.order.create");
            assertThat(resolved.permissions()).doesNotContain("pos.till.open");
        })
                .as("this is the login path. Before the invariant existed, the second assign left "
                        + "two active rows and the next login for this user was an "
                        + "IncorrectResultSizeDataAccessException — a 500, not a denial")
                .doesNotThrowAnyException();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static BranchRoleAssignRequest assignment(UUID branchId, String roleCode) {
        return new BranchRoleAssignRequest(branchId, roleCode, null);
    }

    private java.util.List<String> activeRoleCodesAt(UUID branchId) {
        return jdbc.queryForList(
                "SELECT role_code FROM user_branch_roles "
                        + "WHERE user_id = ? AND branch_id = ? AND is_active ORDER BY role_code",
                String.class, USER, branchId);
    }
}
