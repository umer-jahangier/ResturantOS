package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.config.InternalServiceFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The internal seam the platform control plane reads and writes through (superadmin plan):
 * {@code /internal/auth/rbac/**} and {@code /internal/auth/platform/users/**}.
 *
 * <h2>What is worth asserting here, and what is not</h2>
 *
 * <p>The interesting properties of this seam are all NEGATIVE or COMPARATIVE, so most of these
 * tests assert one thing succeeding beside the same thing being refused:
 *
 * <ul>
 *   <li><b>the ceiling exemption is real and is scoped.</b> A CASHIER cannot deactivate the OWNER
 *       through the tenant-tier path — {@code UserLifecycleIT} pins that — and the platform tier
 *       can, through a DIFFERENT path. Asserting only the second would not distinguish "the
 *       platform tier is exempt" from "the ceiling stopped working";</li>
 *   <li><b>the tenant boundary survives the exemption.</b> The exemption is from the ceiling and
 *       from nothing else, so another tenant's user is still 404;</li>
 *   <li><b>the RBAC seam is unfiltered where the public one is filtered.</b> The point of a
 *       platform catalogue is that it shows OWNER with the whole grant set. A platform token
 *       resolves the empty permission set, so a ceiling-filtered read would return an EMPTY
 *       matrix — which is why this path exists at all;</li>
 *   <li><b>and it has no write.</b> Asserted as a missing route, because "we decided not to build
 *       it" and "somebody built it later" look identical in a codebase and different in a test.</li>
 * </ul>
 *
 * <p>Row-level security is <b>inert in this suite</b>: Testcontainers' Postgres user is a SUPERUSER.
 * So the isolation assertions here measure the OTHER control — the {@code tenant_id} predicate
 * carried in {@code UserRepository}'s finders — exactly as {@code UserLifecycleIT} records.
 */
class PlatformRbacAndUserSecurityIT extends BaseIntegrationTest {

    private static final String INTERNAL_SECRET = "dev-internal-secret";
    private static final String RBAC = "/internal/auth/rbac";
    private static final String PLATFORM_USERS = "/internal/auth/platform/users";
    private static final String TENANT_USERS = "/internal/auth/users";

    private static final UUID TENANT = TestFixtures.DEMO_TENANT_ID;
    private static final UUID OWNER = TestFixtures.OWNER_USER_ID;
    private static final UUID CASHIER = TestFixtures.CASHIER_USER_ID;

    /**
     * A {@code platform_users.id}. It exists in {@code platform_db} and this service has never
     * heard of it — which is the whole point: it holds no {@code user_branch_roles}, so the role
     * ceiling would resolve the empty permission set against it and refuse everything.
     */
    private static final UUID PLATFORM_OPERATOR =
        UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");

    private static final ObjectMapper JSON = new ObjectMapper();

    // ── The RBAC catalogue ───────────────────────────────────────────────────────────────────

    @Test
    void permissions_returnsTheWholeVocabularyGroupedByModule() {
        JsonNode body = parse(internalGet(RBAC + "/permissions", null));

        List<String> codes = codesOf(body.path("data"));
        assertThat(codes)
            .as("the catalogue is read from the database, never from a constant — so this asserts "
                + "that well-known codes are present, not that there are exactly N of them. A "
                + "hardcoded total would be right the day it was written and wrong after the next "
                + "changeset, which is the drift class this repo has hit repeatedly")
            .contains("rbac.manage", "rbac.user.manage", "rbac.role.manage");
        assertThat(codes).doesNotHaveDuplicates();

        List<String> modules = new ArrayList<>();
        body.path("data").forEach(module -> modules.add(module.path("module").asText()));
        assertThat(modules).doesNotHaveDuplicates().contains("rbac", "pos");
        // Every entry repeats its own module, so a client that flattens the response does not lose
        // the grouping dimension.
        body.path("data").forEach(module ->
            module.path("permissions").forEach(permission ->
                assertThat(permission.path("module").asText())
                    .isEqualTo(module.path("module").asText())));
    }

    @Test
    void roles_areReturnedUNFILTERED_whichIsTheEntirePointOfThisPath() {
        JsonNode body = parse(internalGet(RBAC + "/roles?tenantId=" + TENANT, null));

        JsonNode owner = roleNamed(body.path("data"), "OWNER");
        assertThat(owner).as("OWNER must be present").isNotNull();
        assertThat(owner.path("system").asBoolean()).isTrue();
        assertThat(owner.path("permissions").size())
            .as("OWNER holds every permission. The public /api/v1/roles filters by the caller's own "
                + "ceiling, and a platform token resolves the EMPTY permission set — so the "
                + "ceiling-filtered read would return no roles at all and the matrix would be "
                + "blank. This is the measurement that says the unfiltered path is doing its job")
            .isGreaterThan(10);

        List<String> roleCodes = new ArrayList<>();
        body.path("data").forEach(role -> roleCodes.add(role.path("code").asText()));
        assertThat(roleCodes).contains("OWNER", "TENANT_ADMIN", "MANAGER", "CASHIER");
        assertThat(roleCodes).doesNotHaveDuplicates();

        JsonNode tenantAdmin = roleNamed(body.path("data"), "TENANT_ADMIN");
        assertThat(permissionCodes(tenantAdmin))
            .as("13-02 split rbac.manage precisely so a tenant admin could not mint an OWNER. The "
                + "platform catalogue must REPORT that split, not paper over it")
            .doesNotContain("rbac.manage");
        assertThat(permissionCodes(owner)).contains("rbac.manage");
    }

    @Test
    void roles_withNoTenant_yieldTheSystemRolesOnly_failingClosed() {
        JsonNode body = parse(internalGet(RBAC + "/roles", null));
        assertThat(body.path("data").size()).isGreaterThanOrEqualTo(4);
        body.path("data").forEach(role ->
            assertThat(role.path("system").asBoolean())
                .as("an omitted tenant means the GLOBAL catalogue; a tenant's own custom role "
                    + "must not appear in it")
                .isTrue());
    }

    /**
     * The absence is the design, so it is asserted rather than left to a comment. A route that
     * "was decided against" and one that "somebody added later" look identical in a codebase.
     */
    @Test
    void thereIsNoPlatformTierWriteOnTheRbacSeam() {
        for (String path : List.of(RBAC + "/roles", RBAC + "/permissions")) {
            ResponseEntity<String> posted = internalPost(path, Map.of("code", "SUPER_ROLE"),
                null, PLATFORM_OPERATOR);
            assertThat(posted.getStatusCode().value())
                .as("composing a role is granting authority, and the platform tier has no ceiling "
                    + "to be bounded by — %s must not accept a write", path)
                .isIn(404, 405);
        }
    }

    @Test
    void theRbacSeamIsRefusedWithoutTheInternalSecret() {
        ResponseEntity<String> noSecret = rest.get().uri(RBAC + "/permissions")
            .exchange((rq, rs) -> toEntity(rs));
        assertThat(noSecret.getStatusCode().value()).isEqualTo(403);
        assertThat(noSecret.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    // ── The platform-tier account-security writes ────────────────────────────────────────────

    /**
     * The comparison that gives the exemption its meaning: the same target, the same verb, refused
     * on the tenant path and permitted on the platform one.
     */
    @Test
    void platformTierDeactivatesTheOwner_whereATenantAdminBelowTheCeilingCannot() {
        ResponseEntity<String> refusedAtTenantTier = internalPost(
            TENANT_USERS + "/" + OWNER + "/deactivate", null, TENANT, CASHIER);
        assertThat(refusedAtTenantTier.getStatusCode().value()).isEqualTo(403);
        assertThat(refusedAtTenantTier.getBody()).contains("ROLE_CEILING_EXCEEDED");
        assertThat(isActive(OWNER)).isTrue();

        try {
            ResponseEntity<String> permitted = internalPost(
                PLATFORM_USERS + "/" + OWNER + "/deactivate", null, TENANT, PLATFORM_OPERATOR);
            assertThat(permitted.getStatusCode().value()).isEqualTo(200);
            assertThat(isActive(OWNER))
                .as("a platform id holds no user_branch_roles, so a ceiling check would resolve the "
                    + "empty set and refuse every real account — which is why the exemption exists")
                .isFalse();
        } finally {
            internalPost(PLATFORM_USERS + "/" + OWNER + "/reactivate", null, TENANT,
                PLATFORM_OPERATOR);
        }
        assertThat(isActive(OWNER)).isTrue();
    }

    /**
     * The exemption is from the CEILING and from nothing else. A platform operator naming another
     * tenant's id gets a clean not-found, not a cross-tenant write.
     */
    @Test
    void theTenantBoundarySurvivesTheCeilingExemption() {
        UUID otherTenant = UUID.randomUUID();
        ResponseEntity<String> response = internalPost(
            PLATFORM_USERS + "/" + OWNER + "/deactivate", null, otherTenant, PLATFORM_OPERATOR);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(isActive(OWNER))
            .as("the row was not touched — 404 here is a real not-found from a tenant-scoped "
                + "query, not a permission refusal after the fact")
            .isTrue();
    }

    @Test
    void everyPlatformTierWriteRequiresTheActingIdentity() {
        for (String verb : List.of("deactivate", "reactivate", "unlock", "revoke-sessions")) {
            ResponseEntity<String> response = internalPost(
                PLATFORM_USERS + "/" + CASHIER + "/" + verb, null, TENANT, null);
            assertThat(response.getStatusCode().value())
                .as("%s without X-Acting-User-Id", verb).isEqualTo(403);
            assertThat(response.getBody()).contains("ACTING_USER_REQUIRED");
        }
        assertThat(isActive(CASHIER))
            .as("and none of them took effect").isTrue();
    }

    @Test
    void everyPlatformTierWriteIsRefusedWithoutTheInternalSecret() {
        ResponseEntity<String> response = rest.post()
            .uri(PLATFORM_USERS + "/" + CASHIER + "/deactivate")
            .contentType(MediaType.APPLICATION_JSON)
            .header("X-Tenant-Id", TENANT.toString())
            .header("X-Acting-User-Id", PLATFORM_OPERATOR.toString())
            .body(Map.of())
            .exchange((rq, rs) -> toEntity(rs));
        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
        assertThat(isActive(CASHIER)).isTrue();
    }

    @Test
    void unlock_clearsTheLockoutWithoutTouchingTheActiveFlag() {
        execute("UPDATE users SET locked_until = now() + interval '15 minutes', "
            + "failed_login_count = 5 WHERE id = '" + CASHIER + "'");

        JsonNode body = parse(internalPost(PLATFORM_USERS + "/" + CASHIER + "/unlock", null,
            TENANT, PLATFORM_OPERATOR));

        assertThat(body.path("data").path("lockedUntil").isNull())
            .as("null is the STATE 'not locked', which is why it is returned rather than a 204")
            .isTrue();
        assertThat(body.path("data").path("failedLoginCount").asInt()).isZero();
        assertThat(body.path("data").path("active").asBoolean())
            .as("clearing a fifteen-minute cooldown is NOT the same operation as deactivating an "
                + "account, and an operator must not be able to confuse the two")
            .isTrue();
        assertThat(scalar("SELECT locked_until FROM users WHERE id = '" + CASHIER + "'")).isNull();
    }

    @Test
    void revokeSessions_revokesRefreshSessionsAndReportsHowMany_leavingTheAccountAlone() {
        insertRefreshSession(CASHIER);
        insertRefreshSession(CASHIER);

        JsonNode body = parse(internalPost(PLATFORM_USERS + "/" + CASHIER + "/revoke-sessions",
            null, TENANT, PLATFORM_OPERATOR));

        assertThat(body.path("data").path("sessionsRevoked").asInt()).isGreaterThanOrEqualTo(2);
        assertThat(body.path("data").path("active").asBoolean())
            .as("signing somebody out is not disabling their account").isTrue();
        assertThat(count("SELECT count(*) FROM refresh_sessions WHERE user_id = '" + CASHIER
            + "' AND revoked_at IS NULL")).isZero();

        JsonNode second = parse(internalPost(PLATFORM_USERS + "/" + CASHIER + "/revoke-sessions",
            null, TENANT, PLATFORM_OPERATOR));
        assertThat(second.path("data").path("sessionsRevoked").asInt())
            .as("0 is a MEASURED zero — the user held no live session — and is why a count is "
                + "returned instead of a bare success")
            .isZero();
    }

    // ── The directory filters ────────────────────────────────────────────────────────────────

    @Test
    void list_filtersByRoleUsingAnActiveAssignment() {
        JsonNode cashiers = parse(internalGet(
            TENANT_USERS + "?size=200&roleCode=CASHIER", TENANT));
        List<String> ids = idsOf(cashiers.path("data"));
        assertThat(ids).contains(CASHIER.toString());
        assertThat(ids).doesNotContain(TestFixtures.ACCOUNTANT_USER_ID.toString());
        assertThat(cashiers.path("meta").path("totalCount").asLong())
            .as("the count describes the FILTERED set — a page filtered after the fact carries a "
                + "total describing a different set from its own rows")
            .isEqualTo(cashiers.path("data").size());

        assertThat(parse(internalGet(TENANT_USERS + "?size=200&roleCode=NOT_A_REAL_ROLE", TENANT))
            .path("data").size())
            .as("an unknown role code matches nobody and is NOT refused: a directory has to be "
                + "able to answer 'does anyone still hold this retired role?'")
            .isZero();
    }

    @Test
    void list_filtersByUserStatus_andLockedIsNotTheSameAsInactive() {
        // Clear every lock FIRST, so this test owns its own precondition.
        //
        // `containsExactly` below is the assertion worth keeping — LOCKED and INACTIVE being
        // distinguishable is the whole point of the test — but it is only meaningful if the set of
        // locked users is one this test put there. The ITs share one Postgres container with no
        // truncation between classes, so a sibling that exercises failed-login lockout leaves its
        // subject locked and this assertion sees two ids. It passed locally and failed in CI for
        // exactly that reason: locally the class runs alone, in CI it runs after its siblings.
        //
        // Loosening to `contains` would have hidden the coupling instead of removing it.
        execute("UPDATE users SET locked_until = NULL WHERE locked_until IS NOT NULL");
        execute("UPDATE users SET locked_until = now() + interval '15 minutes' WHERE id = '"
            + TestFixtures.MANAGER_USER_ID + "'");
        try {
            List<String> locked = idsOf(parse(internalGet(
                TENANT_USERS + "?size=200&status=LOCKED", TENANT)).path("data"));
            assertThat(locked).containsExactly(TestFixtures.MANAGER_USER_ID.toString());

            List<String> active = idsOf(parse(internalGet(
                TENANT_USERS + "?size=200&status=ACTIVE", TENANT)).path("data"));
            assertThat(active)
                .as("ACTIVE means usable RIGHT NOW. An account with a live lockout cannot log in, "
                    + "and listing it as active tells an operator the opposite of what they need")
                .doesNotContain(TestFixtures.MANAGER_USER_ID.toString())
                .contains(CASHIER.toString());

            List<String> inactive = idsOf(parse(internalGet(
                TENANT_USERS + "?size=200&status=INACTIVE", TENANT)).path("data"));
            assertThat(inactive)
                .as("locked is a cooldown on a live account; inactive is the durable lock. They "
                    + "are different states and the filter must not merge them")
                .doesNotContain(TestFixtures.MANAGER_USER_ID.toString());
        } finally {
            execute("UPDATE users SET locked_until = NULL WHERE id = '"
                + TestFixtures.MANAGER_USER_ID + "'");
        }
    }

    @Test
    void list_withAnUnknownStatus_isRefusedRatherThanIgnored() {
        ResponseEntity<String> response = internalGet(
            TENANT_USERS + "?size=200&status=ACTIVE_ONLY", TENANT);
        assertThat(response.getStatusCode().value())
            .as("a caller who asked for the locked accounts and received all of them has no way "
                + "to notice; an unrecognised filter must fail loudly")
            .isEqualTo(400);
    }

    @Test
    void list_withoutTheNewFilters_isUnchanged_soTheExistingCallerIsUnaffected() {
        JsonNode body = parse(internalGet(TENANT_USERS + "?size=100", TENANT));
        assertThat(body.path("data").size()).isGreaterThanOrEqualTo(5);
        assertThat(body.path("meta").path("totalCount").asLong()).isGreaterThanOrEqualTo(5);
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    private ResponseEntity<String> internalGet(String uri, UUID tenantId) {
        var spec = rest.get().uri(uri).header(InternalServiceFilter.HEADER, INTERNAL_SECRET);
        if (tenantId != null) {
            spec = spec.header("X-Tenant-Id", tenantId.toString());
        }
        return spec.exchange((request, response) -> toEntity(response));
    }

    private ResponseEntity<String> internalPost(String uri, Object body, UUID tenantId,
                                                UUID actingUserId) {
        var spec = rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header(InternalServiceFilter.HEADER, INTERNAL_SECRET);
        if (tenantId != null) {
            spec = spec.header("X-Tenant-Id", tenantId.toString());
        }
        if (actingUserId != null) {
            spec = spec.header("X-Acting-User-Id", actingUserId.toString());
        }
        return spec.body(body == null ? Map.of() : body)
            .exchange((request, response) -> toEntity(response));
    }

    private void insertRefreshSession(UUID userId) {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> {
                passwordPolicyService.setTenantGuc(TENANT);
                return entityManager.createNativeQuery("""
                        INSERT INTO refresh_sessions (id, tenant_id, user_id, branch_id, token_hash,
                                                      expires_at, created_at)
                        VALUES (:id, :tid, :uid, :bid, :hash, now() + interval '30 days', now())
                        """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("tid", TENANT)
                    .setParameter("uid", userId)
                    .setParameter("bid", TestFixtures.MAIN_BRANCH_ID)
                    .setParameter("hash", "hash-" + UUID.randomUUID())
                    .executeUpdate();
            });
    }

    private void execute(String sql) {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> {
                passwordPolicyService.setTenantGuc(TENANT);
                return entityManager.createNativeQuery(sql).executeUpdate();
            });
    }

    private boolean isActive(UUID userId) {
        return Boolean.TRUE.equals(
            scalar("SELECT is_active FROM users WHERE id = '" + userId + "'"));
    }

    private long count(String sql) {
        return ((Number) entityManager.createNativeQuery(sql).getSingleResult()).longValue();
    }

    private Object scalar(String sql) {
        List<?> rows = entityManager.createNativeQuery(sql).getResultList();
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static JsonNode roleNamed(JsonNode roles, String code) {
        for (JsonNode role : roles) {
            if (code.equals(role.path("code").asText())) {
                return role;
            }
        }
        return null;
    }

    private static List<String> permissionCodes(JsonNode role) {
        List<String> codes = new ArrayList<>();
        role.path("permissions").forEach(node -> codes.add(node.asText()));
        return codes;
    }

    private static List<String> codesOf(JsonNode modules) {
        List<String> codes = new ArrayList<>();
        modules.forEach(module ->
            module.path("permissions").forEach(p -> codes.add(p.path("code").asText())));
        return codes;
    }

    private static List<String> idsOf(JsonNode data) {
        List<String> ids = new ArrayList<>();
        data.forEach(node -> ids.add(node.path("id").asText()));
        return ids;
    }

    private static JsonNode parse(ResponseEntity<String> response) {
        try {
            return JSON.readTree(response.getBody());
        } catch (Exception e) {
            throw new AssertionError("Not JSON: " + response.getBody(), e);
        }
    }

    private static ResponseEntity<String> toEntity(
            org.springframework.http.client.ClientHttpResponse response) throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }
}
