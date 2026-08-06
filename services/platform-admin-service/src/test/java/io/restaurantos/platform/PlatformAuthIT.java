package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The platform (SuperAdmin) login endpoint — blocker B1's third and final cause.
 *
 * <p>Before this suite existed, {@code PlatformUserRepository.findByEmail} had zero production
 * callers: the platform control plane shipped an entire API that nobody could authenticate against.
 *
 * <p><b>The assertion that matters most is not "both are 401".</b> Two failures can share a status
 * and still be an account-existence oracle if their bodies differ by one character. Every negative
 * case here is compared <i>byte for byte</i> against the unknown-email baseline, which is the only
 * form of the assertion that can actually fail when someone adds a helpful "no such user" message.
 */
class PlatformAuthIT extends BasePlatformIT {

    private static final String LOGIN_PATH = "/api/v1/platform/auth/login";
    private static final String MINT_PATH  = "/internal/auth/platform-token";

    private static final String GOOD_PASSWORD = "Platform#2026it";
    private static final String BAD_PASSWORD  = "Platform#2026xx";

    private static final String SUPER_EMAIL    = "it-super@platform.test";
    private static final String INACTIVE_EMAIL = "it-inactive@platform.test";
    private static final String SUPPORT_EMAIL  = "it-support@platform.test";
    private static final String UNKNOWN_EMAIL  = "it-nobody@platform.test";
    private static final String LOCKOUT_EMAIL  = "it-lockout@platform.test";

    /** Must match PlatformAuthService's Redis key shape; asserted rather than assumed by the lockout test. */
    private static final String FAIL_KEY_PREFIX = "platform:auth:fail:";

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);

    private UUID superAdminId;

    @BeforeEach
    void seedPlatformUsers() {
        jdbc.update("DELETE FROM platform_users WHERE email LIKE 'it-%@platform.test'");

        superAdminId = insertUser(SUPER_EMAIL, GOOD_PASSWORD, "SUPER_ADMIN", true);
        insertUser(INACTIVE_EMAIL, GOOD_PASSWORD, "SUPER_ADMIN", false);
        insertUser(SUPPORT_EMAIL, GOOD_PASSWORD, "SUPPORT", true);
        insertUser(LOCKOUT_EMAIL, GOOD_PASSWORD, "SUPER_ADMIN", true);

        for (String email : new String[]{SUPER_EMAIL, INACTIVE_EMAIL, SUPPORT_EMAIL, UNKNOWN_EMAIL, LOCKOUT_EMAIL}) {
            redis.delete(FAIL_KEY_PREFIX + email);
        }

        stubMintPlatformToken();
    }

    private UUID insertUser(String email, String password, String role, boolean active) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO platform_users (id, email, password_hash, role, is_active) VALUES (?,?,?,?,?)",
            id, email, encoder.encode(password), role, active);
        return id;
    }

    private void stubMintPlatformToken() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo(MINT_PATH))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"token\":\"stub.platform.token\",\"expiresIn\":900,"
                    + "\"tokenType\":\"platform\"}}")));
    }

    private ResponseEntity<String> login(String email, String password) {
        return httpPost(LOGIN_PATH, Map.of("email", email, "password", password));
    }

    // --- Behaviour 1: the happy path ---------------------------------------------------------

    @Test
    void login_activeSuperAdmin_returns200_withTokenExpiryIdAndRole() {
        ResponseEntity<String> res = login(SUPER_EMAIL, GOOD_PASSWORD);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody()).contains("stub.platform.token");
        assertThat(res.getBody()).contains("\"expiresIn\":900");
        assertThat(res.getBody()).contains(superAdminId.toString());
        assertThat(res.getBody()).contains("SUPER_ADMIN");
        // The password must never be echoed back, in any field, on any path.
        assertThat(res.getBody()).doesNotContain(GOOD_PASSWORD);
    }

    @Test
    void login_isCaseInsensitiveOnEmail() {
        assertThat(login(SUPER_EMAIL.toUpperCase(), GOOD_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.OK);
    }

    // --- Behaviours 2-5: every refusal is the SAME refusal ------------------------------------

    @Test
    void login_unknownEmail_returns401() {
        ResponseEntity<String> res = login(UNKNOWN_EMAIL, GOOD_PASSWORD);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void login_wrongPassword_bodyIsByteIdenticalToUnknownEmail() {
        String unknown = login(UNKNOWN_EMAIL, GOOD_PASSWORD).getBody();
        String wrong   = login(SUPER_EMAIL, BAD_PASSWORD).getBody();

        assertThat(wrong)
            .as("a wrong password must be indistinguishable from an account that does not exist")
            .isEqualTo(unknown);
    }

    @Test
    void login_inactiveUser_bodyIsByteIdenticalToUnknownEmail() {
        String unknown  = login(UNKNOWN_EMAIL, GOOD_PASSWORD).getBody();
        ResponseEntity<String> res = login(INACTIVE_EMAIL, GOOD_PASSWORD);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(res.getBody()).isEqualTo(unknown);
    }

    @Test
    void login_supportRole_cannotObtainToken_andBodyIsByteIdenticalToUnknownEmail() {
        String unknown = login(UNKNOWN_EMAIL, GOOD_PASSWORD).getBody();
        WIREMOCK.resetRequests();

        ResponseEntity<String> res = login(SUPPORT_EMAIL, GOOD_PASSWORD);

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(res.getBody()).isEqualTo(unknown);
        // The strong form: not merely "no token in the response" but "the signer was never asked".
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlPathEqualTo(MINT_PATH)));
    }

    @Test
    void login_unknownEmail_neverAsksTheSignerForAToken() {
        WIREMOCK.resetRequests();
        login(UNKNOWN_EMAIL, GOOD_PASSWORD);
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlPathEqualTo(MINT_PATH)));
    }

    // --- Behaviour 6: per-account lockout ------------------------------------------------------

    @Test
    void login_repeatedFailures_lockAccount_andCorrectPasswordIsStillRefused() {
        for (int i = 0; i < 5; i++) {
            assertThat(login(LOCKOUT_EMAIL, BAD_PASSWORD).getStatusCode())
                .as("attempt %d must be refused", i + 1)
                .isEqualTo(HttpStatus.UNAUTHORIZED);
        }

        String unknown = login(UNKNOWN_EMAIL, GOOD_PASSWORD).getBody();
        ResponseEntity<String> locked = login(LOCKOUT_EMAIL, GOOD_PASSWORD);

        assertThat(locked.getStatusCode())
            .as("the correct password must not open a locked account")
            .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(locked.getBody())
            .as("lockout must not be an account-existence oracle either")
            .isEqualTo(unknown);
    }

    @Test
    void lockoutCounter_isBoundedByATtl_notStoredForever() {
        login(LOCKOUT_EMAIL, BAD_PASSWORD);
        Long ttl = redis.getExpire(FAIL_KEY_PREFIX + LOCKOUT_EMAIL);
        assertThat(ttl).as("the failure counter must expire; an unbounded key is a permanent lockout")
            .isNotNull().isGreaterThan(0L);
    }

    @Test
    void successfulLogin_clearsTheFailureCounter() {
        login(SUPER_EMAIL, BAD_PASSWORD);
        assertThat(redis.hasKey(FAIL_KEY_PREFIX + SUPER_EMAIL)).isTrue();

        assertThat(login(SUPER_EMAIL, GOOD_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(redis.hasKey(FAIL_KEY_PREFIX + SUPER_EMAIL)).isFalse();
    }

    // --- The prohibition: no long-lived credential leaves this endpoint -----------------------

    @Test
    void login_setsNoCookie_onSuccessOrFailure() {
        assertThat(login(SUPER_EMAIL, GOOD_PASSWORD).getHeaders().get("Set-Cookie"))
            .as("a platform session is re-authenticated, never refreshed — no cookie may be issued")
            .isNull();
        assertThat(login(UNKNOWN_EMAIL, GOOD_PASSWORD).getHeaders().get("Set-Cookie")).isNull();
    }

    @Test
    void login_responseCarriesNoRefreshCredential() {
        String body = login(SUPER_EMAIL, GOOD_PASSWORD).getBody();
        assertThat(body).doesNotContainIgnoringCase("refresh");
    }

    // --- The endpoint is reachable without a JWT ----------------------------------------------

    @Test
    void login_isNotBehindTheServicesOwnJwtGate() {
        // A 401 whose body is the security chain's UNAUTHENTICATED (rather than the service's
        // credential refusal) would mean the endpoint never ran. Distinguish them: a *valid*
        // credential must produce a 200 with no Authorization header present at all.
        assertThat(login(SUPER_EMAIL, GOOD_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
