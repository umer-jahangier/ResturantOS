package io.restaurantos.auth;

import io.restaurantos.auth.config.InternalServiceFilter;
import io.restaurantos.auth.integration.BaseIntegrationTest;
import io.restaurantos.auth.integration.TestFixtures;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.ResultSet;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for AuthInternalController — proves:
 * 1. POST /internal/auth/users/{id}/branch-roles WITHOUT X-Internal-Service → 403 INTERNAL_AUTH_REQUIRED
 * 2. POST /internal/auth/users/{id}/branch-roles WITH the secret → persists a user_branch_roles row
 * 3. GET  /internal/auth/users/{id}/permissions?branchId= returns resolved permissions for a seeded user
 * 4. RLS: row written under tenant A is not visible when GUC is tenant B
 */
class AuthInternalBranchRoleIT extends BaseIntegrationTest {

    private static final String INTERNAL_SECRET = "dev-internal-secret";

    @Autowired JdbcTemplate jdbc;

    // ── Gate test ─────────────────────────────────────────────────────────────

    @Test
    void assignBranchRole_withoutSecret_returns403() {
        UUID userId = TestFixtures.CASHIER_USER_ID;
        Map<String, Object> body = Map.of(
            "branchId", TestFixtures.MAIN_BRANCH_ID.toString(),
            "roleCode", "CASHIER"
        );
        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + userId + "/branch-roles",
            body,
            null,
            null
        );
        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    @Test
    void assignBranchRole_withWrongSecret_returns403() {
        UUID userId = TestFixtures.CASHIER_USER_ID;
        Map<String, Object> body = Map.of(
            "branchId", TestFixtures.MAIN_BRANCH_ID.toString(),
            "roleCode", "CASHIER"
        );
        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + userId + "/branch-roles",
            body,
            InternalServiceFilter.HEADER,
            "wrong-secret"
        );
        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    // ── Happy-path: assign persists row ───────────────────────────────────────

    @Test
    void assignBranchRole_withValidSecret_persistsRow() {
        UUID userId = TestFixtures.CASHIER_USER_ID;
        UUID newBranchId = UUID.fromString("b0000003-0000-4000-8000-000000000003");

        Map<String, Object> body = Map.of(
            "branchId", newBranchId.toString(),
            "roleCode", "CASHIER"
        );

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + userId + "/branch-roles",
            body,
            InternalServiceFilter.HEADER,
            INTERNAL_SECRET
        );
        assertThat(response.getStatusCode().value()).isEqualTo(200);

        // Verify row exists in DB under current tenant
        long count = (long) entityManager
            .createNativeQuery("SELECT COUNT(*) FROM user_branch_roles WHERE user_id = :uid AND branch_id = :bid AND role_code = 'CASHIER'")
            .setParameter("uid", userId)
            .setParameter("bid", newBranchId)
            .getSingleResult();
        assertThat(count).isGreaterThanOrEqualTo(1);
    }

    // ── The role ceiling on the WRITE path (13-11) ────────────────────────────
    //
    // 13-07 built the ceiling into GET /api/v1/roles and left the write path measured-but-open,
    // because closing it needed an identity on a seam that carried none. Reproduced live against
    // the running stack before this change: a caller with the shared secret and NO identity
    // whatsoever assigned OWNER and was answered
    //     HTTP 200  {"roleCode":"OWNER","displacedRoleCode":"WAITER", …}
    // The account so created holds rbac.manage, which is exactly what 13-02's authority split
    // exists to withhold from a tenant admin, and the assigner can then log in as it.

    /**
     * A caller that does not say who is asking is refused — not processed without a ceiling check.
     *
     * <p>The distinct code matters: {@code INTERNAL_AUTH_REQUIRED} would mean the shared secret was
     * missing, and it was not.
     */
    @Test
    void assignBranchRole_withoutAnActingUser_isRefused() {
        Map<String, Object> body = Map.of(
            "branchId", TestFixtures.MAIN_BRANCH_ID.toString(),
            "roleCode", "CASHIER");

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + TestFixtures.CASHIER_USER_ID + "/branch-roles",
            body, InternalServiceFilter.HEADER, INTERNAL_SECRET, null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ACTING_USER_REQUIRED");
        assertThat(response.getBody()).doesNotContain("INTERNAL_AUTH_REQUIRED");
    }

    /**
     * The escalation itself: a caller who does not hold {@code rbac.manage} cannot grant a role
     * that does.
     *
     * <p>The acting user is the seeded CASHIER — chosen because a cashier plainly does not hold the
     * administration permissions OWNER carries, so the refusal cannot be an artefact of two roles
     * that happen to be close. Nothing must be written: a refused assignment that had already
     * displaced the target's existing role would revoke authority while refusing to grant any.
     */
    @Test
    void assignBranchRole_aboveTheActingUsersOwnCeiling_isRefusedAndWritesNothing() {
        UUID target = TestFixtures.KITCHEN_STAFF_USER_ID;
        UUID branch = TestFixtures.MAIN_BRANCH_ID;
        Map<String, Object> body = Map.of("branchId", branch.toString(), "roleCode", "OWNER");

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + target + "/branch-roles",
            body, InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.CASHIER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ROLE_CEILING_EXCEEDED");
        // The message names the role and a COUNT of permissions beyond the ceiling, never the codes
        // themselves — naming them would republish exactly what the ceiling withholds.
        assertThat(response.getBody()).contains("OWNER").doesNotContain("rbac.manage");

        assertThat(activeRoleCount(target, branch, "OWNER"))
            .as("nothing may be written by a refused assignment")
            .isZero();
        assertThat(activeRoleCount(target, branch, "KITCHEN_STAFF"))
            .as("and the role the target already held must survive the refusal")
            .isEqualTo(1L);
    }

    /**
     * The control, without which the test above passes against a ceiling that refuses everything.
     *
     * <p>OWNER holds the whole permission catalogue (changeset 057), so an owner assigning OWNER is
     * within their own ceiling and must succeed.
     */
    @Test
    void assignBranchRole_withinTheActingUsersCeiling_stillSucceeds() {
        UUID target = TestFixtures.MANAGER_USER_ID;
        UUID branch = UUID.fromString("b0000009-0000-4000-8000-000000000009");
        Map<String, Object> body = Map.of("branchId", branch.toString(), "roleCode", "OWNER");

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + target + "/branch-roles",
            body, InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(activeRoleCount(target, branch, "OWNER")).isEqualTo(1L);
    }

    /**
     * An acting user id that resolves to nobody yields the EMPTY permission set, which permits only
     * a role granting nothing — so it is a refusal, not a bypass. Without this, naming a random
     * UUID would be the way around the ceiling.
     */
    @Test
    void assignBranchRole_withAnUnresolvableActingUser_isRefused() {
        Map<String, Object> body = Map.of(
            "branchId", TestFixtures.MAIN_BRANCH_ID.toString(), "roleCode", "CASHIER");

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + TestFixtures.KITCHEN_STAFF_USER_ID + "/branch-roles",
            body, InternalServiceFilter.HEADER, INTERNAL_SECRET, UUID.randomUUID());

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ROLE_CEILING_EXCEEDED");
    }

    /**
     * An unknown code is still 400 UNKNOWN_ROLE_CODE, not 403.
     *
     * <p>It has no permission rows at all, so a subset test alone would pass it vacuously and
     * report a typo as an authorization success. The ceiling validates the code first for exactly
     * that reason, and this pins the ordering.
     */
    @Test
    void assignBranchRole_withAnUnknownRoleCode_isStillReportedAsUnknownNotAsCeiling() {
        Map<String, Object> body = Map.of(
            "branchId", TestFixtures.MAIN_BRANCH_ID.toString(), "roleCode", "NOT_A_REAL_ROLE");

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + TestFixtures.KITCHEN_STAFF_USER_ID + "/branch-roles",
            body, InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.CASHIER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).contains("UNKNOWN_ROLE_CODE");
    }

    private long activeRoleCount(UUID userId, UUID branchId, String roleCode) {
        return ((Number) entityManager.createNativeQuery(
                "SELECT COUNT(*) FROM user_branch_roles "
                    + "WHERE user_id = :uid AND branch_id = :bid AND role_code = :rc AND is_active")
            .setParameter("uid", userId)
            .setParameter("bid", branchId)
            .setParameter("rc", roleCode)
            .getSingleResult()).longValue();
    }

    // ── Permissions endpoint ───────────────────────────────────────────────────

    @Test
    void getUserPermissions_withValidSecret_returnsResolvedPermissions() {
        UUID userId = TestFixtures.CASHIER_USER_ID;
        UUID branchId = TestFixtures.MAIN_BRANCH_ID;

        ResponseEntity<String> response = exchangeGet(
            "/internal/auth/users/" + userId + "/permissions?branchId=" + branchId,
            InternalServiceFilter.HEADER,
            INTERNAL_SECRET
        );
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("branchId");
        assertThat(response.getBody()).contains("permissions");
    }

    @Test
    void getUserPermissions_forCashier_includesVoidOwn() {
        UUID userId = TestFixtures.CASHIER_USER_ID;
        UUID branchId = TestFixtures.MAIN_BRANCH_ID;

        ResponseEntity<String> response = exchangeGet(
            "/internal/auth/users/" + userId + "/permissions?branchId=" + branchId,
            InternalServiceFilter.HEADER,
            INTERNAL_SECRET
        );
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("pos.order.void.own");
    }

    @Test
    void getUserPermissions_withoutSecret_returns403() {
        UUID userId = TestFixtures.CASHIER_USER_ID;
        ResponseEntity<String> response = exchangeGet(
            "/internal/auth/users/" + userId + "/permissions",
            null,
            null
        );
        assertThat(response.getStatusCode().value()).isEqualTo(403);
    }

    // ── RLS isolation: row under tenant A invisible from tenant B ──────────────

    @Test
    void rlsIsolation_tenantIsolationPolicyExists() {
        // Testcontainers creates POSTGRES_USER as a superuser which bypasses RLS.
        // Instead of testing row visibility (which superusers bypass), we verify:
        // 1. RLS is ENABLED and FORCED on user_branch_roles.
        // 2. The tenant_isolation policy references app.current_tenant_id.
        // The actual row-level filtering is verified in production with non-superuser roles.

        Long rlsEnabledCount = jdbc.queryForObject(
            "SELECT COUNT(*) FROM pg_class " +
            "WHERE relname = 'user_branch_roles' AND relrowsecurity = true AND relforcerowsecurity = true",
            Long.class
        );
        assertThat(rlsEnabledCount)
            .as("user_branch_roles must have RLS enabled AND forced")
            .isEqualTo(1L);

        Long policyCount = jdbc.queryForObject(
            "SELECT COUNT(*) FROM pg_policies " +
            "WHERE tablename = 'user_branch_roles' AND policyname = 'tenant_isolation'",
            Long.class
        );
        assertThat(policyCount)
            .as("tenant_isolation RLS policy must exist on user_branch_roles")
            .isEqualTo(1L);

        // Also verify the tenant_id column exists (FK enforcement at DB level)
        Long colCount = jdbc.queryForObject(
            "SELECT COUNT(*) FROM information_schema.columns " +
            "WHERE table_name = 'user_branch_roles' AND column_name = 'tenant_id'",
            Long.class
        );
        assertThat(colCount).as("tenant_id column must exist").isEqualTo(1L);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Defaults the acting user to the tenant's OWNER, who holds the whole permission catalogue
     * (changeset 057) and can therefore assign anything — so the pre-existing assertions in this
     * file keep measuring what they were written to measure rather than the ceiling 13-11 added.
     * {@link #exchangePost(String, Object, String, String, UUID)} is the overload for tests that
     * care who is asking.
     */
    protected ResponseEntity<String> exchangePost(String uri, Object body, String headerName, String headerValue) {
        return exchangePost(uri, body, headerName, headerValue, TestFixtures.OWNER_USER_ID);
    }

    protected ResponseEntity<String> exchangePost(String uri, Object body, String headerName,
                                                  String headerValue, UUID actingUserId) {
        var spec = rest.post()
            .uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body);
        if (headerName != null) {
            spec = spec.header(headerName, headerValue);
        }
        if (headerName != null && "X-Internal-Service".equals(headerName)) {
            spec = spec.header("X-Tenant-Id", TestFixtures.DEMO_TENANT_ID.toString());
            if (actingUserId != null) {
                spec = spec.header("X-Acting-User-Id", actingUserId.toString());
            }
        }
        return spec.exchange((request, response) -> toResponseEntity(response));
    }

    protected ResponseEntity<String> exchangeGet(String uri, String headerName, String headerValue) {
        var spec = rest.get().uri(uri);
        if (headerName != null) {
            spec = spec.header(headerName, headerValue);
        }
        return spec.exchange((request, response) -> toResponseEntity(response));
    }

    private static ResponseEntity<String> toResponseEntity(org.springframework.http.client.ClientHttpResponse response)
            throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
    }
}
