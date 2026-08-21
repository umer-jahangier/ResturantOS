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
        // A branch id this class OWNS, and it cleans up after itself below.
        //
        // This used to be b0000003, which is not free: BranchSwitchIT hardcodes that
        // exact UUID as "the branch the cashier is NOT assigned to" in two tests.
        // This test grants the cashier a live CASHIER role there over HTTP, so the
        // write COMMITS, and the module's Postgres container is `static` and shared
        // with no truncation between classes. Whichever class ran second lost: with
        // b0000003 assigned, BranchSwitchIT's switch was legitimately authorized and
        // returned 200, so both of its 403 assertions failed — and looked exactly
        // like an authorization regression rather than a fixture collision.
        //
        // Third instance of the disease @BeforeEach in BranchSwitchIT already
        // documents for d0000006/d0000007. That repair missed this one because it is
        // a collision on a BRANCH id, not a role-row id. Hand-stamped fixture ids are
        // a namespace with no allocator.
        UUID newBranchId = UUID.fromString("b0000093-0000-4000-8000-000000000093");

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

    /**
     * Removes the branch-role this class grants, so no later class inherits it.
     *
     * <p>Cleanup is @AfterEach rather than a trailing line in the test, because a
     * failed assertion must not leave the row behind — that is precisely how one
     * red test becomes three in unrelated classes. Scoped to the id this class owns
     * so it cannot delete another class's fixture.
     */
    @org.junit.jupiter.api.AfterEach
    void removeTheBranchRoleThisClassGrants() throws Exception {
        // Plain JDBC, not the EntityManager. These tests drive the app over HTTP, so
        // nothing here runs inside a JPA transaction and
        // `entityManager.createNativeQuery(...).executeUpdate()` throws
        // TransactionRequiredException — which failed all 21 tests in this class when
        // tried. Annotating the lifecycle method @Transactional does not help: it would
        // open a transaction around the CLEANUP while the writes it is cleaning up were
        // committed by a different connection entirely.
        try (java.sql.Connection c = dataSource.getConnection();
             java.sql.PreparedStatement ps =
                 c.prepareStatement("DELETE FROM user_branch_roles WHERE branch_id = ?")) {
            ps.setObject(1, UUID.fromString("b0000093-0000-4000-8000-000000000093"));
            ps.executeUpdate();
        }
    }

    @org.springframework.beans.factory.annotation.Autowired
    private javax.sql.DataSource dataSource;

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

    /**
     * A user id belonging to ANOTHER tenant is 404, and writes nothing.
     *
     * <p>Nothing in application code checked this before 13-12. The write was refused only by a
     * database foreign key, which answered {@code 409 CONFLICT} with "This conflicts with existing
     * data" — a message about duplicate vendor codes, arriving for an attempt to give another
     * tenant's employee a role. A security boundary held up by a constraint disappears the day
     * someone drops or defers the constraint, and that would not look like a security change to
     * anyone reviewing it.
     *
     * <p>This test cannot prove the row-level-security POLICY: Testcontainers' Postgres user is a
     * SUPERUSER, so the policy is inert here. What it proves is the half CI can assert — the tenant
     * predicate in the query — and the live script
     * {@code scripts/e2e/phase13-tenant-admin-users-e2e.sh} asserts the same thing against the
     * enforcing database with two genuinely provisioned tenants.
     */
    @Test
    void assignBranchRole_toAnotherTenantsUser_isNotFoundAndWritesNothing() {
        UUID neighbourTenant = UUID.fromString("a0000098-0000-4000-8000-000000000098");
        UUID neighbourUser = UUID.fromString("c0000098-0000-4000-8000-000000000098");
        seedNeighbourUser(neighbourTenant, neighbourUser);

        // The control. Without it, "the assignment was refused" is satisfied by a row that was
        // never written, and the test would pass against a completely broken seed.
        assertThat(neighbourUserExists(neighbourUser))
            .as("the neighbouring tenant's user must really exist for this to mean anything")
            .isTrue();

        Map<String, Object> body = Map.of(
            "branchId", TestFixtures.MAIN_BRANCH_ID.toString(), "roleCode", "CASHIER");

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + neighbourUser + "/branch-roles",
            body, InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(response.getBody()).contains("NOT_FOUND");
        assertThat(activeRoleCount(neighbourUser, TestFixtures.MAIN_BRANCH_ID, "CASHIER")).isZero();
    }

    /**
     * A user id that exists NOWHERE answers identically to another tenant's.
     *
     * <p>Two different refusals are a distinguisher whatever their status codes say: if one of them
     * were a 409 and the other a 404, a tenant admin could walk ids and learn which ones name real
     * accounts elsewhere on the platform, without ever reading a row.
     */
    @Test
    void assignBranchRole_toAUserThatExistsNowhere_answersIdenticallyToAnotherTenants() {
        Map<String, Object> body = Map.of(
            "branchId", TestFixtures.MAIN_BRANCH_ID.toString(), "roleCode", "CASHIER");

        ResponseEntity<String> response = exchangePost(
            "/internal/auth/users/" + UUID.randomUUID() + "/branch-roles",
            body, InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(response.getBody()).contains("NOT_FOUND");
    }

    /**
     * Written with the NEIGHBOUR's GUC, so the row belongs to that tenant and not to the demo one.
     *
     * <p>Both statements go in ONE {@code execute}: a {@code JdbcTemplate} returns its connection to
     * the pool between calls, so a GUC set in a separate call would be set on a connection the
     * INSERT may never see — the shape of the five defects this phase has already found.
     */
    private void seedNeighbourUser(UUID tenantId, UUID userId) {
        jdbc.execute("""
            SELECT set_config('app.current_tenant_id', '%s', false);
            INSERT INTO users (id, tenant_id, email, password_hash, full_name, locale,
                               is_active, must_change_password, totp_enabled, failed_login_count,
                               created_at, updated_at)
            VALUES ('%s', '%s', 'neighbour@other.local', 'x',
                    'Neighbour User', 'en', true, false, false, 0, now(), now())
            ON CONFLICT (id) DO NOTHING;
            SELECT set_config('app.current_tenant_id', '%s', false);
            """.formatted(tenantId, userId, tenantId, TestFixtures.DEMO_TENANT_ID));
    }

    private boolean neighbourUserExists(UUID userId) {
        Long count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM users WHERE id = ?::uuid", Long.class, userId.toString());
        return count != null && count == 1L;
    }

    // ── The role ceiling on the REVOKE path (S2) ──────────────────────────────
    //
    // 13-11 closed the ceiling on assign and left revoke naming nobody and checking nothing. The
    // asymmetry was measured against the running dev stack before this change, not argued:
    //     POST   .../branch-roles {"roleCode":"OWNER"} as TENANT_ADMIN → 403 ROLE_CEILING_EXCEEDED
    //     DELETE .../branch-roles?roleCode=OWNER      as TENANT_ADMIN → 204, row went inactive
    // (.planning/audits/floor/S2/_ceiling-probe.json). A ceiling that stops you creating an OWNER
    // but not destroying every OWNER is not a ceiling, and destruction is the irreversible
    // direction: nobody below the ceiling can grant the role back, so the tenant loses its only
    // holder of rbac.manage for good. S2 puts a BUTTON on this endpoint, which is what turned a
    // latent hole into a one-click one.

    /**
     * A revoke that does not say who is asking is refused, and the assignment survives it.
     *
     * <p>The distinct code matters for the same reason it does on assign: {@code
     * INTERNAL_AUTH_REQUIRED} would mean the shared secret was missing, and it was not.
     */
    @Test
    void revokeBranchRole_withoutAnActingUser_isRefusedAndTheRoleSurvives() {
        UUID target = TestFixtures.KITCHEN_STAFF_USER_ID;
        // Its OWN branch, not MAIN_BRANCH_ID. When this test was first watched failing — the point
        // of writing it — the unguarded revoke SUCCEEDED and stripped the shared fixture's role at
        // the main branch, which then failed an unrelated assign test 200 lines up. A test whose
        // pre-fix behaviour damages another test's fixture reports the wrong defect.
        UUID branch = UUID.fromString("b0000030-0000-4000-8000-000000000030");

        ResponseEntity<String> granted = exchangePost(
            "/internal/auth/users/" + target + "/branch-roles",
            Map.of("branchId", branch.toString(), "roleCode", "KITCHEN_STAFF"),
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);
        assertThat(granted.getStatusCode().value()).isEqualTo(200);

        // The control: there must be live authority here for a refusal to mean anything.
        assertThat(activeRoleCount(target, branch, "KITCHEN_STAFF"))
            .as("the fixture must really hold this role before we try to take it away")
            .isEqualTo(1L);

        ResponseEntity<String> response = exchangeDelete(
            "/internal/auth/users/" + target + "/branch-roles"
                + "?branchId=" + branch + "&roleCode=KITCHEN_STAFF",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ACTING_USER_REQUIRED");
        assertThat(response.getBody()).doesNotContain("INTERNAL_AUTH_REQUIRED");
        assertThat(activeRoleCount(target, branch, "KITCHEN_STAFF"))
            .as("a refused revocation must not have deactivated the row")
            .isEqualTo(1L);
    }

    /**
     * The finding itself: a caller who could not GRANT a role may not TAKE IT AWAY either.
     *
     * <p>The acting user is the seeded CASHIER, who plainly holds none of the administration
     * permissions OWNER carries, so the refusal cannot be an artefact of two roles that happen to
     * be close. The target is given OWNER by the OWNER first, so the authority being defended is
     * real and live rather than a row that was never written.
     */
    @Test
    void revokeBranchRole_aboveTheActingUsersOwnCeiling_isRefusedAndTheRoleSurvives() {
        UUID target = TestFixtures.MANAGER_USER_ID;
        UUID branch = UUID.fromString("b0000031-0000-4000-8000-000000000031");

        ResponseEntity<String> granted = exchangePost(
            "/internal/auth/users/" + target + "/branch-roles",
            Map.of("branchId", branch.toString(), "roleCode", "OWNER"),
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);
        assertThat(granted.getStatusCode().value()).isEqualTo(200);
        assertThat(activeRoleCount(target, branch, "OWNER")).isEqualTo(1L);

        ResponseEntity<String> response = exchangeDelete(
            "/internal/auth/users/" + target + "/branch-roles"
                + "?branchId=" + branch + "&roleCode=OWNER",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.CASHIER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ROLE_CEILING_EXCEEDED");
        // Worded for the verb the caller actually used. "You cannot assign the role OWNER" is a
        // confusing thing to read after pressing Revoke, and the message is what an administrator
        // has to act on.
        assertThat(response.getBody()).contains("revoke").contains("OWNER");
        // Still never names the withheld permission codes — see RoleCeilingExceededException.
        assertThat(response.getBody()).doesNotContain("rbac.manage");

        assertThat(activeRoleCount(target, branch, "OWNER"))
            .as("the role must survive a refused revocation")
            .isEqualTo(1L);
    }

    /**
     * The positive control, without which the test above passes against a revoke that refuses
     * everything — including a revoke that is simply broken.
     *
     * <p>OWNER holds the whole permission catalogue (changeset 057), so an owner revoking OWNER is
     * within their own ceiling and the row must genuinely go inactive.
     */
    @Test
    void revokeBranchRole_withinTheActingUsersCeiling_actuallyRevokes() {
        UUID target = TestFixtures.MANAGER_USER_ID;
        UUID branch = UUID.fromString("b0000032-0000-4000-8000-000000000032");

        ResponseEntity<String> granted = exchangePost(
            "/internal/auth/users/" + target + "/branch-roles",
            Map.of("branchId", branch.toString(), "roleCode", "OWNER"),
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);
        assertThat(granted.getStatusCode().value()).isEqualTo(200);
        assertThat(activeRoleCount(target, branch, "OWNER")).isEqualTo(1L);

        ResponseEntity<String> response = exchangeDelete(
            "/internal/auth/users/" + target + "/branch-roles"
                + "?branchId=" + branch + "&roleCode=OWNER",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(204);
        assertThat(activeRoleCount(target, branch, "OWNER"))
            .as("the row must actually go inactive — this is the control for the refusals above")
            .isZero();
    }

    /**
     * An unknown role code is 400, not 403 — the ordering the ceiling fixes on assign, pinned here
     * too. An unknown code has no permission rows, so a subset test alone passes it vacuously and
     * would report a typo as an authorization success.
     */
    @Test
    void revokeBranchRole_withAnUnknownRoleCode_isReportedAsUnknownNotAsCeiling() {
        ResponseEntity<String> response = exchangeDelete(
            "/internal/auth/users/" + TestFixtures.KITCHEN_STAFF_USER_ID + "/branch-roles"
                + "?branchId=" + TestFixtures.MAIN_BRANCH_ID + "&roleCode=NOT_A_REAL_ROLE",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.CASHIER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).contains("UNKNOWN_ROLE_CODE");
    }

    /**
     * The provisioning saga's compensating door still works without an acting user, because there
     * genuinely is none — it is undoing a grant auth-service made itself. Without this the ceiling
     * above would have silently broken tenant-provisioning rollback, leaving a usable OWNER account
     * inside a PROVISIONING_FAILED tenant.
     */
    @Test
    void unprovisionAdmin_needsNoActingUser_andRevokes() {
        UUID target = TestFixtures.MANAGER_USER_ID;
        UUID branch = UUID.fromString("b0000033-0000-4000-8000-000000000033");

        exchangePost("/internal/auth/users/" + target + "/branch-roles",
            Map.of("branchId", branch.toString(), "roleCode", "OWNER"),
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);
        assertThat(activeRoleCount(target, branch, "OWNER")).isEqualTo(1L);

        ResponseEntity<String> response = exchangeDelete(
            "/internal/auth/tenants/" + TestFixtures.DEMO_TENANT_ID + "/provision-admin"
                + "?userId=" + target + "&branchId=" + branch + "&roleCode=OWNER",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, null);

        assertThat(response.getStatusCode().value()).isEqualTo(204);
        assertThat(activeRoleCount(target, branch, "OWNER")).isZero();

        // Idempotent: a saga compensation may run twice and the second run must not fail.
        ResponseEntity<String> replay = exchangeDelete(
            "/internal/auth/tenants/" + TestFixtures.DEMO_TENANT_ID + "/provision-admin"
                + "?userId=" + target + "&branchId=" + branch + "&roleCode=OWNER",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, null);
        assertThat(replay.getStatusCode().value()).isEqualTo(204);
    }

    /**
     * A user id belonging to ANOTHER tenant is 404 on revoke, exactly as it already is on assign.
     *
     * <p>Measured live through the gateway before this guard existed — Control Bistro's OWNER
     * against a Floating Terrace user, reproduced three times — the three verbs disagreed:
     * <pre>
     *   GET    /api/v1/users/{id}                → 404
     *   POST   /api/v1/users/{id}/branch-roles   → 404 NOT_FOUND
     *   DELETE /api/v1/users/{id}/branch-roles   → 204   ← reports success
     * </pre>
     *
     * <p><b>This is an API-honesty defect, not a leak and not a write.</b> RLS hides the foreign row
     * so {@code revoke}'s {@code ifPresent} body never ran, and the victim's assignments survived
     * every attempt — confirmed by reading them back over HTTP as their legitimate owner. What was
     * broken is that the caller was told a privilege revocation had succeeded when it had not and
     * could not. An administrator who revokes a role, is answered 204, and moves on has been handed
     * a false belief about who can do what in their restaurant.
     *
     * <p>Same missing-guard-on-one-verb shape as 13-12 one level up: {@code assign} called
     * {@code requireUserInTenant} and {@code revoke} never did.
     *
     * <p>Like its assign counterpart this cannot prove the RLS POLICY — Testcontainers' Postgres
     * user is a SUPERUSER and the policy is inert here. It proves the half CI can assert: the tenant
     * predicate in {@code findByIdForTenant}.
     */
    @Test
    void revokeBranchRole_forAnotherTenantsUser_isNotFound() {
        UUID neighbourTenant = UUID.fromString("a0000097-0000-4000-8000-000000000097");
        UUID neighbourUser = UUID.fromString("c0000097-0000-4000-8000-000000000097");
        seedNeighbourUser(neighbourTenant, neighbourUser);

        // The control. Without it "the revoke was refused" is satisfied by a user that was never
        // seeded, and the test would pass against a completely broken fixture.
        assertThat(neighbourUserExists(neighbourUser))
            .as("the neighbouring tenant's user must really exist for this to mean anything")
            .isTrue();

        ResponseEntity<String> response = exchangeDelete(
            "/internal/auth/users/" + neighbourUser + "/branch-roles"
                + "?branchId=" + TestFixtures.MAIN_BRANCH_ID + "&roleCode=CASHIER",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);

        assertThat(response.getStatusCode().value())
            .as("a foreign tenant's user must answer 404 on revoke, as it does on assign and GET")
            .isEqualTo(404);
        assertThat(response.getBody()).contains("NOT_FOUND");
    }

    /**
     * The other half of the distinction, and the reason the guard goes on the USER and not on the
     * assignment row: a role the user simply does not hold is still 204.
     *
     * <p>Revoking something already absent is legitimately idempotent — the compensating saga door
     * and every retried revocation depend on it, and {@link #unprovisionAdmin_needsNoActingUser_andRevokes}
     * asserts the replay explicitly. Without this test the 404 above is satisfied by a revoke that
     * simply started answering 404 whenever it found no row, which would break that replay and turn
     * a harmless retry into a saga failure.
     *
     * <p>The target is this tenant's own MANAGER at this tenant's own MAIN branch, so the only thing
     * missing is the assignment itself — not the user, and not the branch.
     */
    @Test
    void revokeBranchRole_forOwnTenantsUserWithoutThatRole_staysNoContent() {
        UUID target = TestFixtures.MANAGER_USER_ID;

        // The control: the role must genuinely be absent, or this measures nothing.
        assertThat(activeRoleCount(target, TestFixtures.MAIN_BRANCH_ID, "CASHIER"))
            .as("the fixture must NOT hold this role for the idempotent case to be the case under test")
            .isZero();

        ResponseEntity<String> response = exchangeDelete(
            "/internal/auth/users/" + target + "/branch-roles"
                + "?branchId=" + TestFixtures.MAIN_BRANCH_ID + "&roleCode=CASHIER",
            InternalServiceFilter.HEADER, INTERNAL_SECRET, TestFixtures.OWNER_USER_ID);

        assertThat(response.getStatusCode().value())
            .as("'this user is mine and holds no such role' is idempotent, not an error")
            .isEqualTo(204);
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

    /**
     * DELETE with an explicitly chosen acting user — {@code null} means the header is omitted
     * entirely, which is the case the revoke tests above have to be able to express.
     */
    protected ResponseEntity<String> exchangeDelete(String uri, String headerName,
                                                    String headerValue, UUID actingUserId) {
        var spec = rest.delete().uri(uri);
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
