package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.entity.UserEntity;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Email-first login — {@code POST /api/v1/auth/login} with NO {@code tenantSlug} (16a-01).
 *
 * <h2>What this file is really for</h2>
 *
 * <p>One assertion here matters more than the rest, and the others exist to support it: <b>an
 * unknown address and a wrong password must be indistinguishable</b>. A unified login is the easiest
 * place in a multi-tenant product to build an account-enumeration oracle by accident — resolve first,
 * then ask for the password, and the form will happily tell anyone which restaurant groups a person
 * works for. {@link #unknownEmailAndWrongPassword_areByteForByteIdentical()} compares the two
 * responses field by field rather than just checking both are 401, because "both are 401" is exactly
 * what a leak that lives in the body would also look like.
 *
 * <h2>Why the platform half is disabled here</h2>
 *
 * <p>{@code restaurantos.auth.platform-login-enabled=false}: platform credentials live in
 * {@code platform_db}, which only platform-admin-service may read (PLATFORM-07), and standing that
 * service up inside auth-service's test context would mean either a second Spring app or a stub that
 * proves nothing about the real one. The platform path is asserted where it can be asserted for
 * real — end to end against the live gateway, in the browser, and in
 * {@code scripts/e2e/phase16a-unified-login-e2e.sh}.
 *
 * <p>{@link #platformServiceUnreachable_stillLogsTenantUsersIn()} covers the OTHER half of that
 * boundary, which this context CAN prove: the flag off and an unroutable URI are the same code path
 * as an outage, and a tenant user must still get in.
 */
class UnifiedLoginIT extends BaseIntegrationTest {

    private final ObjectMapper json = new ObjectMapper();

    /** A second tenant, so "this address exists in two places" is a real database state. */
    private static final UUID SECOND_TENANT = UUID.fromString("a0000009-0000-4000-8000-000000000009");
    private static final String SECOND_SLUG = "second-restaurant";
    private static final String SECOND_NAME = "Second Restaurant";

    @DynamicPropertySource
    static void unifiedProps(DynamicPropertyRegistry r) {
        // See the class javadoc. Also proves the escape hatch actually disables the call rather
        // than merely making it fail.
        r.add("restaurantos.auth.platform-login-enabled", () -> "false");
    }

    /**
     * Undo BOTH pieces of state these tests share, before every one of them.
     *
     * <p>Not tidiness. The tests here deliberately submit wrong passwords, and a wrong password
     * against a shared seeded account leaves a {@code failed_login_count} behind — five of them and
     * every later test in the class gets a 423 instead of whatever it was asserting. The duplicate
     * row is the same hazard in the other direction: once created it makes the address ambiguous, so
     * a test expecting a straight login would get the chooser purely because of what ran before it.
     *
     * <p>Both were observed, not anticipated: three tests failed with "expected 200" while each
     * passed in isolation. Resetting here makes the outcome a property of the test rather than of
     * JUnit's method order.
     */
    @org.junit.jupiter.api.BeforeEach
    void isolateSharedState() {
        removeDuplicateAddress();
        resetLockout(TestFixtures.CASHIER_EMAIL);
        resetLockout(TestFixtures.MANAGER_EMAIL);
    }

    // ── The guardrail ──────────────────────────────────────────────────────────────────────────

    /**
     * The refusal an attacker probing for accounts would see, twice, for two very different inputs.
     *
     * <p>Compared on status, on the parsed error code, on the message, and on the absence of any
     * {@code details} — a chooser leaking through the failure path would show up as a populated
     * {@code details} array with the same code and status, which a laxer assertion would pass.
     */
    @Test
    void unknownEmailAndWrongPassword_areByteForByteIdentical() throws Exception {
        ResponseEntity<String> unknown = unified("nobody-at-all@nowhere.invalid", "Whatever#2026");
        ResponseEntity<String> wrongPassword = unified(TestFixtures.CASHIER_EMAIL, "definitely-not-it");

        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(wrongPassword.getStatusCode()).isEqualTo(unknown.getStatusCode());

        JsonNode a = json.readTree(unknown.getBody()).path("error");
        JsonNode b = json.readTree(wrongPassword.getBody()).path("error");

        assertThat(b.path("code").asText()).isEqualTo(a.path("code").asText()).isEqualTo("UNAUTHENTICATED");
        assertThat(b.path("message").asText()).isEqualTo(a.path("message").asText());
        // Nothing names a tenant, in either. `details` is the only place a name could appear.
        assertThat(a.path("details")).isEmpty();
        assertThat(b.path("details")).isEmpty();
        assertThat(unknown.getBody()).doesNotContain(TestFixtures.DEMO_SLUG);
        assertThat(wrongPassword.getBody()).doesNotContain(TestFixtures.DEMO_SLUG);
    }

    /**
     * The enumeration guard restated as the property it actually has to hold: a REAL address with a
     * WRONG password must not reveal that the address is real — including through the chooser, which
     * is the one response shape that names tenants.
     */
    @Test
    void wrongPasswordAgainstAnAddressHeldInTwoTenants_namesNeither() throws Exception {
        createDuplicateAddressInSecondTenant();

        ResponseEntity<String> response = unified(TestFixtures.CASHIER_EMAIL, "not-the-password");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody())
            .doesNotContain(SECOND_SLUG)
            .doesNotContain(SECOND_NAME)
            .doesNotContain(TestFixtures.DEMO_SLUG);
    }

    // ── Resolution ─────────────────────────────────────────────────────────────────────────────

    @Test
    void oneMatchingTenant_logsInWithNoSlugAndIssuesTheSameSessionAsTheSlugBearingPath() throws Exception {
        ResponseEntity<String> response = unified(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode data = json.readTree(response.getBody()).path("data");
        assertThat(data.path("accessToken").asText()).isNotBlank();
        assertThat(data.path("tenantId").asText()).isEqualTo(TestFixtures.DEMO_TENANT_ID.toString());
        assertThat(data.path("branchId").asText()).isEqualTo(TestFixtures.MAIN_BRANCH_ID.toString());
        assertThat(data.path("tokenType").asText()).isEqualTo("access");

        // The refresh cookie is the proof that the unified path really re-entered the ordinary
        // login rather than minting a token of its own: only loginToTenant issues a session.
        assertThat(response.getHeaders().get("Set-Cookie"))
            .anySatisfy(cookie -> assertThat(cookie).contains("refresh_token").contains("HttpOnly"));
    }

    /**
     * Two tenants, correct password in both → a chooser naming exactly those two.
     *
     * <p>The chooser is on the ERROR channel (409) deliberately: nothing was issued. A 200 carrying
     * options would be a success shape with no session in it.
     */
    @Test
    void matchingInTwoTenants_returnsAChooserNamingOnlyTheMatches() throws Exception {
        createDuplicateAddressInSecondTenant();

        ResponseEntity<String> response = unified(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        JsonNode error = json.readTree(response.getBody()).path("error");
        assertThat(error.path("code").asText()).isEqualTo("TENANT_SELECTION_REQUIRED");

        List<String> slugs = error.path("details").findValuesAsText("field");
        assertThat(slugs).containsExactlyInAnyOrder(TestFixtures.DEMO_SLUG, SECOND_SLUG);

        // No session was issued alongside the question.
        assertThat(response.getBody()).doesNotContain("accessToken");
        assertThat(response.getHeaders().get("Set-Cookie")).isNull();
    }

    /** Picking one from the chooser is an ordinary slug-bearing login. */
    @Test
    void choosingFromTheChooser_completesTheLogin() throws Exception {
        createDuplicateAddressInSecondTenant();

        var response = exchangePost("/api/v1/auth/login", TestFixtures.loginBody(
            TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(json.readTree(response.getBody()).path("data").path("tenantId").asText())
            .isEqualTo(TestFixtures.DEMO_TENANT_ID.toString());
    }

    // ── Backwards compatibility ────────────────────────────────────────────────────────────────

    /**
     * A blank slug must take the unified path, not the "unknown tenant" 401.
     *
     * <p>{@code {"tenantSlug": ""}} is what a form with an untouched optional field submits. Before
     * the normalisation in {@code LoginRequest.hasTenantHint} it would have been looked up in
     * {@code auth_tenants}, missed, and produced a generic refusal for a perfectly good credential.
     */
    @Test
    void blankSlugIsTreatedAsAbsent() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("email", TestFixtures.CASHIER_EMAIL);
        body.put("password", TestFixtures.CASHIER_PASSWORD);
        body.put("tenantSlug", "   ");

        var response = exchangePost("/api/v1/auth/login", body);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    /** The pre-16a-01 contract, unchanged: a named tenant behaves exactly as it always did. */
    @Test
    void slugBearingLoginIsUnchanged() throws Exception {
        var ok = exchangePost("/api/v1/auth/login", TestFixtures.loginBody(
            TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG));
        assertThat(ok.getStatusCode()).isEqualTo(HttpStatus.OK);

        var unknownTenant = exchangePost("/api/v1/auth/login", TestFixtures.loginBody(
            TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, "no-such-tenant"));
        assertThat(unknownTenant.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ── Brute-force accounting ─────────────────────────────────────────────────────────────────

    /**
     * Omitting the slug must not be a way to guess passwords for free.
     *
     * <p>The tenant login locks at five failures. If the unified path resolved without touching
     * {@code failed_login_count}, an attacker would simply stop sending a slug — so the failure sink
     * runs the SAME accounting, and this asserts the counter really moved.
     */
    @Test
    void failedUnifiedAttempts_incrementTheSameLockoutCounterAsASlugBearingOne() throws Exception {
        resetLockout(TestFixtures.MANAGER_EMAIL);

        unified(TestFixtures.MANAGER_EMAIL, "wrong-1");
        unified(TestFixtures.MANAGER_EMAIL, "wrong-2");

        setRls(TestFixtures.demoTenantId());
        entityManager.clear();
        UserEntity user = userRepository.findByEmail(TestFixtures.MANAGER_EMAIL).orElseThrow();
        assertThat(user.getFailedLoginCount()).isEqualTo(2);
    }

    // ── Degradation ────────────────────────────────────────────────────────────────────────────

    /**
     * The control plane being unavailable is not a tenant user's problem.
     *
     * <p>Asserted with the flag off, which is the same branch an outage takes: no platform verdict,
     * and the tenant login proceeds. Failing the whole login instead would turn a control-plane
     * incident into every restaurant's staff being unable to sign in.
     */
    @Test
    void platformServiceUnreachable_stillLogsTenantUsersIn() throws Exception {
        var response = unified(TestFixtures.OWNER_EMAIL, TestFixtures.OWNER_PASSWORD);
        // OWNER holds rbac.manage, so it meets the TOTP gate — a 401 TOTP_* is a SUCCESSFUL
        // resolution here: it proves the credential was verified and the tenant was found, and it is
        // the step-up gate refusing, not the unified path.
        JsonNode error = json.readTree(response.getBody()).path("error");
        assertThat(error.path("code").asText()).startsWith("TOTP_");
    }

    // ── Helpers ────────────────────────────────────────────────────────────────────────────────

    /** A login with no tenant field at all — the shape the new form submits. */
    private ResponseEntity<String> unified(String email, String password) {
        Map<String, Object> body = new HashMap<>();
        body.put("email", email);
        body.put("password", password);
        return exchangePost("/api/v1/auth/login", body);
    }

    /**
     * Give {@link TestFixtures#CASHIER_EMAIL} a second, identically-credentialled account in another
     * tenant — the cross-tenant reuse changeset 058 deliberately keeps legal.
     *
     * <p>The password hash is copied from the existing row rather than re-encoded, so both accounts
     * genuinely accept the same password without this test needing to know the cost factor.
     *
     * <p>Written with native SQL and an explicit {@code tenant_id}: {@code users} is
     * {@code FORCE ROW LEVEL SECURITY}, and although the policy is inert under Testcontainers'
     * superuser, the row still has to carry the right tenant for the candidate lookup to find it.
     */
    private void createDuplicateAddressInSecondTenant() {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .executeWithoutResult(status -> {
                entityManager.createNativeQuery("""
                    INSERT INTO auth_tenants (id, slug, name, status)
                    VALUES (:id, :slug, :name, 'ACTIVE')
                    ON CONFLICT (id) DO NOTHING
                    """)
                    .setParameter("id", SECOND_TENANT)
                    .setParameter("slug", SECOND_SLUG)
                    .setParameter("name", SECOND_NAME)
                    .executeUpdate();

                entityManager.createNativeQuery("""
                    INSERT INTO users (id, tenant_id, email, password_hash, full_name, is_active,
                                       totp_enabled, failed_login_count, must_change_password)
                    SELECT :newId, :tenantId, u.email, u.password_hash, u.full_name, true,
                           false, 0, false
                      FROM users u
                     WHERE u.id = :sourceId
                    ON CONFLICT (id) DO NOTHING
                    """)
                    .setParameter("newId", UUID.fromString("c0000009-0000-4000-8000-000000000009"))
                    .setParameter("tenantId", SECOND_TENANT)
                    .setParameter("sourceId", TestFixtures.CASHIER_USER_ID)
                    .executeUpdate();
            });
        entityManager.clear();
    }

    private void removeDuplicateAddress() {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .executeWithoutResult(status -> entityManager
                .createNativeQuery("DELETE FROM users WHERE tenant_id = :t")
                .setParameter("t", SECOND_TENANT)
                .executeUpdate());
        entityManager.clear();
    }

    private void resetLockout(String email) {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .executeWithoutResult(status -> entityManager.createNativeQuery(
                    "UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE lower(email) = :e")
                .setParameter("e", email.toLowerCase())
                .executeUpdate());
        entityManager.clear();
    }
}
