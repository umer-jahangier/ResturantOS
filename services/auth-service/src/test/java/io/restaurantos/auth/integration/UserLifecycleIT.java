package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.config.InternalServiceFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The internal user lifecycle (13-11, D-11/D-12/D-13, blocker B3).
 *
 * <p>Covers the nine behaviours the plan names, plus the two things that are not behaviours but
 * without which the rest is theatre: the tenant boundary, and the role ceiling on the write path
 * that 13-07 measured open.
 *
 * <h2>What this file can and cannot prove about row-level security</h2>
 *
 * <p>Testcontainers' Postgres user is a SUPERUSER, so the {@code tenant_isolation} policy on
 * {@code users} is <b>inert in every test here</b> — a suite that leaned on it would be green
 * against a database that cannot reproduce the failure, which is exactly how {@code ab7e59a} and
 * {@code 7609a0d} shipped broken. So the isolation assertions below measure the OTHER control: the
 * {@code tenant_id} predicate carried in every finder in {@code UserRepository}. Each of them
 * writes a neighbouring tenant's row and asserts it exists before asserting it is not returned, so
 * a negative cannot pass by the fixture never having been created. The policy half is asserted by
 * {@code scripts/e2e/phase13-user-lifecycle-e2e.sh} against the live RLS-enforcing database.
 */
class UserLifecycleIT extends BaseIntegrationTest {

    private static final String INTERNAL_SECRET = "dev-internal-secret";
    private static final String USERS = "/internal/auth/users";
    private static final UUID TENANT = TestFixtures.DEMO_TENANT_ID;
    private static final UUID BRANCH = TestFixtures.MAIN_BRANCH_ID;
    /** The tenant's OWNER: holds the whole catalogue, so they can grant anything. */
    private static final UUID ADMIN = TestFixtures.OWNER_USER_ID;

    private static final ObjectMapper JSON = new ObjectMapper();

    // ── Behaviour 1 + 2: list, page metadata, deterministic order, filter, search ─────────────

    @Test
    void list_returnsAPageOfThisTenantsUsersWithATotalCount() {
        ResponseEntity<String> response = internalGet(USERS + "?size=100", TENANT);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        JsonNode body = parse(response);
        assertThat(body.path("data").isArray()).isTrue();
        assertThat(body.path("data").size()).isGreaterThanOrEqualTo(5);
        assertThat(body.path("meta").path("totalCount").asLong()).isGreaterThanOrEqualTo(5);
        assertThat(body.path("meta").path("page").path("limit").asInt()).isEqualTo(100);

        List<String> emails = emailsOf(body);
        assertThat(emails).contains(TestFixtures.CASHIER_EMAIL, TestFixtures.OWNER_EMAIL);
        // Determinism is the property that matters, and it is asserted as determinism rather than
        // as Java's idea of sorted order: ORDER BY email is evaluated in the DATABASE's collation,
        // which does not agree with String.compareTo about punctuation. Asserting isSorted() here
        // would be asserting the collation, and would fail on a correctly ordered page.
        assertThat(emailsOf(parse(internalGet(USERS + "?size=100", TENANT))))
            .as("two reads of the same page return the same rows in the same order, which is what "
                + "makes a page boundary stable")
            .containsExactlyElementsOf(emails);
    }

    /**
     * Pagination is real, not a decorative envelope: two different pages must return two disjoint
     * sets of rows, and the last page must say it is the last.
     */
    @Test
    void list_pagesAreDisjointAndTheLastPageSaysSo() {
        JsonNode first = parse(internalGet(USERS + "?page=0&size=2", TENANT));
        JsonNode second = parse(internalGet(USERS + "?page=1&size=2", TENANT));

        assertThat(first.path("data").size()).isEqualTo(2);
        assertThat(first.path("meta").path("page").path("cursor").asText()).isEqualTo("0");
        assertThat(first.path("meta").path("page").path("nextCursor").asText()).isEqualTo("1");
        assertThat(emailsOf(first)).doesNotContainAnyElementsOf(emailsOf(second));

        long total = first.path("meta").path("totalCount").asLong();
        JsonNode last = parse(internalGet(USERS + "?page=0&size=" + (total + 10), TENANT));
        assertThat(last.path("meta").path("page").path("nextCursor").isNull())
            .as("nextCursor is null on the last page — the question a client actually asks")
            .isTrue();
    }

    /** The page size is capped whatever the caller asks for (T-13-11-H). */
    @Test
    void list_pageSizeIsCapped() {
        JsonNode body = parse(internalGet(USERS + "?size=100000", TENANT));
        assertThat(body.path("meta").path("page").path("limit").asInt()).isEqualTo(200);
    }

    @Test
    void list_activeOnlyFiltersAndSearchMatchesEmailAndName() {
        // A marker unique to this run. Every test in this class shares one database, and a fixed
        // word like "probe" is one neighbouring fixture away from matching two rows and turning a
        // correct search into a red.
        String marker = "sprobe" + UUID.randomUUID().toString().substring(0, 8);
        String email = marker + "@demo.local";
        UUID created = createdUserId(create(email, "Named " + marker.toUpperCase(java.util.Locale.ROOT), BRANCH, "CASHIER"));

        assertThat(emailsOf(parse(internalGet(USERS + "?size=200&search=" + marker, TENANT))))
            .as("search matches a fragment of the address")
            .containsExactly(email);
        assertThat(emailsOf(parse(internalGet(
                USERS + "?size=200&search=" + marker.toUpperCase(java.util.Locale.ROOT), TENANT))))
            .as("and it is case-insensitive on both sides — the stored full name is upper-cased "
                + "here and the term is upper-cased too, so neither could be matching literally")
            .containsExactly(email);

        deactivate(created);

        assertThat(emailsOf(parse(internalGet(USERS + "?size=200&activeOnly=true&search=" + marker, TENANT))))
            .as("activeOnly excludes the deactivated user")
            .isEmpty();
        assertThat(emailsOf(parse(internalGet(USERS + "?size=200&search=" + marker, TENANT))))
            .as("and the control: without the filter they are still there, so the emptiness above "
                + "is the filter working rather than the row having vanished")
            .containsExactly(email);
    }

    // ── Behaviour 3: get, and the tenant boundary ─────────────────────────────────────────────

    @Test
    void get_returnsTheProfileAndItsActiveAssignments() {
        JsonNode body = parse(internalGet(USERS + "/" + TestFixtures.CASHIER_USER_ID, TENANT));

        assertThat(body.path("data").path("user").path("email").asText())
            .isEqualTo(TestFixtures.CASHIER_EMAIL);
        assertThat(body.path("data").path("user").path("active").asBoolean()).isTrue();
        assertThat(body.path("data").path("assignments").size()).isGreaterThanOrEqualTo(1);
        assertThat(body.path("data").path("assignments").get(0).path("roleCode").asText())
            .isEqualTo("CASHIER");
    }

    /** No password, no hash, no TOTP secret ever crosses this boundary. */
    @Test
    void get_neverReturnsCredentialMaterial() {
        String body = internalGet(USERS + "/" + TestFixtures.CASHIER_USER_ID, TENANT).getBody();
        assertThat(body)
            .doesNotContain("passwordHash").doesNotContain("password_hash")
            .doesNotContain("totpSecret").doesNotContain("totp_secret")
            .doesNotContain("$2a$");
    }

    /**
     * A neighbouring tenant's user is <b>not found</b>, not forbidden — 403 would confirm the id
     * names a real user somewhere.
     */
    @Test
    void get_aUserOfAnotherTenant_is404AndLeaksNothing() {
        UUID neighbourTenant = UUID.randomUUID();
        UUID neighbourUser = insertUserDirectly(neighbourTenant, "neighbour@other.local", "Neighbour");

        assertThat(userExists(neighbourUser))
            .as("control: the neighbour's row really is in the table, so the 404 below is the "
                + "tenant predicate working rather than an absent fixture")
            .isTrue();

        ResponseEntity<String> response = internalGet(USERS + "/" + neighbourUser, TENANT);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(response.getBody()).doesNotContain("neighbour@other.local");
        assertThat(response.getBody()).doesNotContain(neighbourTenant.toString());
    }

    @Test
    void list_neverReturnsAnotherTenantsUser() {
        UUID neighbourTenant = UUID.randomUUID();
        insertUserDirectly(neighbourTenant, "listleak@other.local", "List Leak");

        JsonNode body = parse(internalGet(USERS + "?size=200", TENANT));

        assertThat(emailsOf(body)).doesNotContain("listleak@other.local");
        assertThat(response(internalGet(USERS + "?size=200", neighbourTenant)))
            .as("control: asked for the neighbour's own tenant, the same endpoint DOES return it — "
                + "so the assertion above measures scoping rather than a row that was never written")
            .contains("listleak@other.local");
    }

    // ── Behaviour 4: create ──────────────────────────────────────────────────────────────────

    @Test
    void create_issuesATemporaryPasswordTheForcedChangeFlagAndTheRequestedRole() {
        String email = uniqueEmail("cashier");
        ResponseEntity<String> response = create(email, "New Cashier", BRANCH, "CASHIER");

        assertThat(response.getStatusCode().value()).isEqualTo(201);
        JsonNode data = parse(response).path("data");

        String tempPassword = data.path("tempPassword").asText();
        assertThat(tempPassword).hasSize(16);
        assertThat(data.path("mustChangePassword").asBoolean()).isTrue();
        assertThat(data.path("assignedRoleCode").asText()).isEqualTo("CASHIER");
        assertThat(data.path("loginable").asBoolean())
            .as("an account with no assignment cannot log in at all; the response says so directly")
            .isTrue();
        assertThat(data.path("email").asText())
            .as("normalised on write, because login lower-cases before the lookup")
            .isEqualTo(email);

        UUID userId = UUID.fromString(data.path("id").asText());
        JsonNode detail = parse(internalGet(USERS + "/" + userId, TENANT)).path("data");
        assertThat(detail.path("user").path("mustChangePassword").asBoolean()).isTrue();
        assertThat(detail.path("assignments").size()).isEqualTo(1);
        assertThat(detail.path("assignments").get(0).path("primary").asBoolean())
            .as("a user's first assignment is their default branch at login")
            .isTrue();

        // The temp password exists in the response and nowhere else.
        assertThat(scalar("SELECT password_hash FROM users WHERE id = '" + userId + "'"))
            .isNotEqualTo(tempPassword).asString().startsWith("$2");
        assertThat(count("SELECT count(*) FROM event_outbox WHERE envelope_json LIKE '%"
            + tempPassword + "%'"))
            .as("never in an event payload")
            .isZero();
    }

    /** An upper-cased address is stored lower-cased, or the account could never be found at login. */
    @Test
    void create_normalisesTheEmailAndRefusesACaseVariantAsADuplicate() {
        String email = uniqueEmail("MixedCase");
        ResponseEntity<String> first = create(email.toUpperCase(java.util.Locale.ROOT), "Mixed", BRANCH, "CASHIER");
        assertThat(first.getStatusCode().value()).isEqualTo(201);
        assertThat(parse(first).path("data").path("email").asText()).isEqualTo(email.toLowerCase(java.util.Locale.ROOT));

        ResponseEntity<String> duplicate = create(email.toLowerCase(java.util.Locale.ROOT), "Mixed Again", BRANCH, "CASHIER");
        assertThat(duplicate.getStatusCode().value())
            .as("changeset 058 makes (tenant_id, lower(email)) unique over live rows")
            .isEqualTo(409);
    }

    @Test
    void create_withoutARoleIsAllowedAndSaysTheAccountCannotYetLogIn() {
        JsonNode data = parse(create(uniqueEmail("norole"), "No Role", null, null)).path("data");
        assertThat(data.path("assignedRoleCode").isNull()).isTrue();
        assertThat(data.path("loginable").asBoolean()).isFalse();
    }

    // ── Behaviour 5 + 6: the two create negatives ────────────────────────────────────────────

    @Test
    void create_withAnUnknownRoleCode_is400AndCreatesNothing() {
        String email = uniqueEmail("badrole");
        ResponseEntity<String> response = create(email, "Bad Role", BRANCH, "NOT_A_REAL_ROLE");

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).contains("UNKNOWN_ROLE_CODE").contains("NOT_A_REAL_ROLE");
        assertThat(count("SELECT count(*) FROM users WHERE email = '" + email + "'")).isZero();
    }

    @Test
    void create_withARoleButNoBranch_is400AndCreatesNothing() {
        String email = uniqueEmail("nobranch");
        ResponseEntity<String> response = create(email, "No Branch", null, "CASHIER");

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(count("SELECT count(*) FROM users WHERE email = '" + email + "'")).isZero();
    }

    // ── Behaviour 7: update ──────────────────────────────────────────────────────────────────

    @Test
    void update_changesNameAndLocaleOnly() {
        UUID userId = createdUserId(create(uniqueEmail("editme"), "Before", BRANCH, "CASHIER"));

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("fullName", "After");
        patch.put("locale", "ur-PK");
        JsonNode data = parse(internalPatch(USERS + "/" + userId, patch)).path("data");

        assertThat(data.path("user").path("fullName").asText()).isEqualTo("After");
        assertThat(data.path("user").path("locale").asText()).isEqualTo("ur-PK");
        assertThat(data.path("user").path("active").asBoolean())
            .as("a field the caller did not send is left alone — this is a patch, not a replace")
            .isTrue();
    }

    /**
     * A body carrying a password is REFUSED, not ignored.
     *
     * <p>Jackson's default would drop the unknown key and answer 200 — leaving an administrator
     * certain they had set a password the platform has never heard of, discovered only when the
     * user cannot log in with it.
     */
    @Test
    void update_withAPasswordField_isRejectedAndChangesNothing() {
        UUID userId = createdUserId(create(uniqueEmail("nopassword"), "Keep Me", BRANCH, "CASHIER"));
        String hashBefore = String.valueOf(scalar("SELECT password_hash FROM users WHERE id = '" + userId + "'"));

        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("fullName", "Should Not Apply");
        patch.put("password", "Hunter#2026");
        ResponseEntity<String> response = internalPatch(USERS + "/" + userId, patch);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody())
            .as("and the submitted credential is not echoed back into a log or a browser console")
            .doesNotContain("Hunter#2026");
        assertThat(scalar("SELECT password_hash FROM users WHERE id = '" + userId + "'"))
            .isEqualTo(hashBefore);
        assertThat(scalar("SELECT full_name FROM users WHERE id = '" + userId + "'"))
            .as("nothing at all is applied from a rejected body")
            .isEqualTo("Keep Me");
    }

    /** {@code newPassword}, {@code passwordHash} and {@code temp_password} trip it too. */
    @Test
    void update_rejectsEveryPasswordShapedFieldNameNotJustOne() {
        UUID userId = createdUserId(create(uniqueEmail("anypassword"), "Any", BRANCH, "CASHIER"));
        for (String field : List.of("newPassword", "passwordHash", "temp_password")) {
            Map<String, Object> patch = new LinkedHashMap<>();
            patch.put(field, "Hunter#2026");
            assertThat(internalPatch(USERS + "/" + userId, patch).getStatusCode().value())
                .as("field %s", field)
                .isEqualTo(400);
        }
        Map<String, Object> harmless = new LinkedHashMap<>();
        harmless.put("fullName", "Any");
        harmless.put("somethingElse", "ignored");
        assertThat(internalPatch(USERS + "/" + userId, harmless).getStatusCode().value())
            .as("control: an ordinary unknown field is still tolerated, so the rule is about "
                + "passwords rather than about strictness")
            .isEqualTo(200);
    }

    // ── Behaviour 8 + 9: deactivate, reactivate, and the login refusal ───────────────────────

    @Test
    void deactivate_flipsTheFlagRevokesSessionsAndKeepsTheRowAndItsAssignments() {
        UUID userId = createdUserId(create(uniqueEmail("gone"), "Gone Away", BRANCH, "CASHIER"));
        insertRefreshSessionDirectly(TENANT, userId);
        assertThat(count("SELECT count(*) FROM refresh_sessions WHERE user_id = '" + userId
            + "' AND revoked_at IS NULL")).isEqualTo(1);

        JsonNode data = parse(deactivate(userId)).path("data");

        assertThat(data.path("user").path("active").asBoolean()).isFalse();
        assertThat(count("SELECT count(*) FROM users WHERE id = '" + userId + "'"))
            .as("never a hard delete — audit rows, orders and journal entries reference this id")
            .isEqualTo(1);
        assertThat(data.path("assignments").size())
            .as("assignments survive, so reactivation restores the role they had")
            .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM refresh_sessions WHERE user_id = '" + userId
            + "' AND revoked_at IS NULL"))
            .as("refusing new logins while leaving 30-day refresh tokens renewable is not removal")
            .isZero();

        JsonNode back = parse(reactivate(userId)).path("data");
        assertThat(back.path("user").path("active").asBoolean()).isTrue();
        assertThat(count("SELECT count(*) FROM refresh_sessions WHERE user_id = '" + userId
            + "' AND revoked_at IS NULL"))
            .as("reactivation deliberately does NOT restore sessions — they may have been on a "
                + "device the person no longer has")
            .isZero();
    }

    /**
     * The defect this plan closed: {@code users.is_active} has existed since changeset 020 and
     * login never read it, so deactivating a user did nothing to their ability to log in.
     */
    @Test
    void aDeactivatedUserCannotLogInAndAReactivatedOneCan() {
        Map<String, Object> credentials = TestFixtures.loginBody(
            TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG);

        assertThat(exchangePost("/api/v1/auth/login", credentials).getStatusCode().value())
            .as("control: this account logs in before it is deactivated, so the refusal below is "
                + "the flag rather than a broken credential")
            .isEqualTo(200);

        deactivate(TestFixtures.CASHIER_USER_ID);
        try {
            ResponseEntity<String> refused = exchangePost("/api/v1/auth/login", credentials);
            assertThat(refused.getStatusCode().value()).isEqualTo(401);
            assertThat(refused.getBody())
                .as("the same generic refusal every other failure uses — a distinct message would "
                    + "tell an unauthenticated caller that this address had an account here")
                .contains("Invalid credentials");
        } finally {
            reactivate(TestFixtures.CASHIER_USER_ID);
        }

        assertThat(exchangePost("/api/v1/auth/login", credentials).getStatusCode().value())
            .as("and access is restored on reactivation")
            .isEqualTo(200);
    }

    // ── The role ceiling on the create path (13-11) ──────────────────────────────────────────

    @Test
    void create_withARoleAboveTheActingUsersCeiling_isRefusedAndCreatesNothing() {
        String email = uniqueEmail("escalate");
        ResponseEntity<String> response = internalPost(USERS,
            createBody(email, "Escalation Attempt", BRANCH, "OWNER"),
            TENANT, TestFixtures.CASHIER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ROLE_CEILING_EXCEEDED");
        assertThat(count("SELECT count(*) FROM users WHERE email = '" + email + "'"))
            .as("refused before a password was generated or a row written")
            .isZero();
    }

    @Test
    void create_withoutAnActingUser_isRefused() {
        String email = uniqueEmail("noactor");
        ResponseEntity<String> response = internalPost(USERS,
            createBody(email, "No Actor", BRANCH, "CASHIER"), TENANT, null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ACTING_USER_REQUIRED");
        assertThat(count("SELECT count(*) FROM users WHERE email = '" + email + "'")).isZero();
    }

    /** A lesser role must not be able to deactivate a greater one out of their own tenant. */
    @Test
    void deactivate_aUserHoldingARoleAboveTheActingUsersCeiling_isRefused() {
        ResponseEntity<String> response = internalPost(
            USERS + "/" + TestFixtures.OWNER_USER_ID + "/deactivate", null,
            TENANT, TestFixtures.CASHIER_USER_ID);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("ROLE_CEILING_EXCEEDED");
        assertThat(scalar("SELECT is_active FROM users WHERE id = '" + TestFixtures.OWNER_USER_ID + "'"))
            .isEqualTo(Boolean.TRUE);
    }

    // ── The gate ─────────────────────────────────────────────────────────────────────────────

    @Test
    void everyLifecycleEndpointIsRefusedWithoutTheInternalSecret() {
        ResponseEntity<String> listed = rest.get().uri(USERS)
            .header("X-Tenant-Id", TENANT.toString())
            .exchange((rq, rs) -> toEntity(rs));
        assertThat(listed.getStatusCode().value()).isEqualTo(403);
        assertThat(listed.getBody()).contains("INTERNAL_AUTH_REQUIRED");

        ResponseEntity<String> created = rest.post().uri(USERS)
            .contentType(MediaType.APPLICATION_JSON)
            .header("X-Tenant-Id", TENANT.toString())
            .body(createBody(uniqueEmail("nosecret"), "No Secret", BRANCH, "CASHIER"))
            .exchange((rq, rs) -> toEntity(rs));
        assertThat(created.getStatusCode().value()).isEqualTo(403);
        assertThat(created.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    private ResponseEntity<String> create(String email, String fullName, UUID branchId, String roleCode) {
        return internalPost(USERS, createBody(email, fullName, branchId, roleCode), TENANT, ADMIN);
    }

    private static Map<String, Object> createBody(String email, String fullName, UUID branchId, String roleCode) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("fullName", fullName);
        if (branchId != null) {
            body.put("branchId", branchId.toString());
        }
        if (roleCode != null) {
            body.put("roleCode", roleCode);
        }
        return body;
    }

    private ResponseEntity<String> deactivate(UUID userId) {
        return internalPost(USERS + "/" + userId + "/deactivate", null, TENANT, ADMIN);
    }

    private ResponseEntity<String> reactivate(UUID userId) {
        return internalPost(USERS + "/" + userId + "/reactivate", null, TENANT, ADMIN);
    }

    private ResponseEntity<String> internalPost(String uri, Object body, UUID tenantId, UUID actingUserId) {
        var spec = rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header(InternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", tenantId.toString());
        if (actingUserId != null) {
            spec = spec.header("X-Acting-User-Id", actingUserId.toString());
        }
        return spec.body(body == null ? Map.of() : body)
            .exchange((request, response) -> toEntity(response));
    }

    private ResponseEntity<String> internalPatch(String uri, Object body) {
        return rest.patch().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header(InternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TENANT.toString())
            .header("X-Acting-User-Id", ADMIN.toString())
            .body(body)
            .exchange((request, response) -> toEntity(response));
    }

    private ResponseEntity<String> internalGet(String uri, UUID tenantId) {
        return rest.get().uri(uri)
            .header(InternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", tenantId.toString())
            .exchange((request, response) -> toEntity(response));
    }

    /**
     * Inserts a user for a tenant that has no seed data, with that tenant's GUC set on the same
     * connection — without it the write would be refused on any database that enforces the policy,
     * and the isolation assertion it exists to support would prove nothing.
     */
    private UUID insertUserDirectly(UUID tenantId, String email, String fullName) {
        UUID id = UUID.randomUUID();
        return new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> {
                passwordPolicyService.setTenantGuc(tenantId);
                entityManager.createNativeQuery("""
                        INSERT INTO users (id, tenant_id, email, password_hash, full_name, totp_enabled,
                                           is_active, failed_login_count, created_at, updated_at, version,
                                           must_change_password)
                        VALUES (:id, :tid, :email, '$2a$12$notarealhashnotarealhashnotarealhashnotarealhash',
                                :name, false, true, 0, now(), now(), 0, false)
                        """)
                    .setParameter("id", id)
                    .setParameter("tid", tenantId)
                    .setParameter("email", email)
                    .setParameter("name", fullName)
                    .executeUpdate();
                return id;
            });
    }

    private void insertRefreshSessionDirectly(UUID tenantId, UUID userId) {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> {
                passwordPolicyService.setTenantGuc(tenantId);
                return entityManager.createNativeQuery("""
                        INSERT INTO refresh_sessions (id, tenant_id, user_id, branch_id, token_hash,
                                                      expires_at, created_at)
                        VALUES (:id, :tid, :uid, :bid, :hash, now() + interval '30 days', now())
                        """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("tid", tenantId)
                    .setParameter("uid", userId)
                    .setParameter("bid", BRANCH)
                    .setParameter("hash", "hash-" + UUID.randomUUID())
                    .executeUpdate();
            });
    }

    private boolean userExists(UUID userId) {
        return count("SELECT count(*) FROM users WHERE id = '" + userId + "'") == 1;
    }

    private long count(String sql) {
        return ((Number) entityManager.createNativeQuery(sql).getSingleResult()).longValue();
    }

    private Object scalar(String sql) {
        return entityManager.createNativeQuery(sql).getSingleResult();
    }

    private static UUID createdUserId(ResponseEntity<String> createResponse) {
        assertThat(createResponse.getStatusCode().value()).isEqualTo(201);
        return UUID.fromString(parse(createResponse).path("data").path("id").asText());
    }

    private static String uniqueEmail(String prefix) {
        return prefix.toLowerCase(java.util.Locale.ROOT) + "-"
            + UUID.randomUUID().toString().substring(0, 8) + "@demo.local";
    }

    private static List<String> emailsOf(JsonNode body) {
        List<String> emails = new ArrayList<>();
        body.path("data").forEach(node -> emails.add(node.path("email").asText()));
        return emails;
    }

    private static String response(ResponseEntity<String> response) {
        return response.getBody() == null ? "" : response.getBody();
    }

    private static JsonNode parse(ResponseEntity<String> response) {
        try {
            return JSON.readTree(response.getBody());
        } catch (Exception e) {
            throw new AssertionError("Not JSON: " + response.getBody(), e);
        }
    }

    private static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse response)
            throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }
}
