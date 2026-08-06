package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.secret.DefaultSecretGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import io.restaurantos.auth.entity.UserEntity;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * TOTP step-up at login, and the {@code totp_verified} access-token claim it mints.
 *
 * <p>That claim is the only authority for the step-up-gated endpoints (payroll approval,
 * accounting-period close). Before it existed those endpoints read a bare {@code X-TOTP-Verified}
 * request header that nothing set, validated or stripped, so any caller holding the permission
 * sent {@code true} and skipped the second factor on money disbursement. The gateway now strips
 * that header and rewrites it from this claim, which makes what auth-service puts in the token the
 * whole of the control — hence the assertions on the token payload rather than only on the status.
 */
class StepUpLoginIT extends BaseIntegrationTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final DefaultSecretGenerator secretGenerator = new DefaultSecretGenerator();
    private final DefaultCodeGenerator codeGenerator = new DefaultCodeGenerator();
    private final SystemTimeProvider timeProvider = new SystemTimeProvider();

    private String ownerTotpSecret;

    @BeforeEach
    void enrollOwnerTotp() {
        ownerTotpSecret = secretGenerator.generate();
        setRls(TestFixtures.demoTenantId());
        UserEntity owner = userRepository.findByEmail(TestFixtures.OWNER_EMAIL).orElseThrow();
        owner.setTotpSecret(ownerTotpSecret);
        owner.setTotpEnabled(true);
        userRepository.save(owner);
    }

    @AfterEach
    void restoreOwnerTotpState() {
        setRls(TestFixtures.demoTenantId());
        userRepository.findByEmail(TestFixtures.OWNER_EMAIL).ifPresent(owner -> {
            owner.setTotpSecret(null);
            owner.setTotpEnabled(false);
            userRepository.save(owner);
        });
    }

    @Test
    void privilegedLogin_requiresTotpThenSucceedsWithValidCode() throws Exception {
        var withoutTotp = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(TestFixtures.OWNER_EMAIL, TestFixtures.OWNER_PASSWORD, TestFixtures.DEMO_SLUG));
        assertThat(withoutTotp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        JsonNode error = objectMapper.readTree(withoutTotp.getBody());
        assertThat(error.path("error").path("code").asText()).isEqualTo("TOTP_REQUIRED");

        var withTotp = loginWithCurrentCode();
        assertThat(withTotp.getStatusCode()).isEqualTo(HttpStatus.OK);
        String accessToken = objectMapper.readTree(withTotp.getBody()).path("data").path("accessToken").asText();
        assertThat(accessToken).isNotBlank();
    }

    /**
     * A genuine TOTP login mints {@code totp_verified=true} — the positive half of the fix. The
     * gateway turns exactly this into {@code X-TOTP-Verified: true}, so without it no legitimate
     * approver could ever approve a payroll run once the forged header stopped working.
     */
    @Test
    void genuineTotpLogin_mintsTotpVerifiedClaim() throws Exception {
        var withTotp = loginWithCurrentCode();
        assertThat(withTotp.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode payload = decodeJwtPayload(accessTokenOf(withTotp.getBody()));
        assertThat(payload.has("totp_verified"))
            .as("the claim must be present, not merely truthy by accident")
            .isTrue();
        assertThat(payload.path("totp_verified").asBoolean())
            .as("a login that verified a code carries the step-up marker")
            .isTrue();
        assertThat(payload.path("permissions").toString()).contains("hr.payroll.approve");
    }

    /**
     * The unchanged-behaviour guard. A cashier has no TOTP secret and no step-up permission: they
     * must still log in with a password alone, and must NOT be handed the step-up marker.
     */
    @Test
    void cashierLogin_stillWorksWithoutTotpCode() throws Exception {
        var response = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode payload = decodeJwtPayload(accessTokenOf(response.getBody()));
        assertThat(payload.path("totp_verified").asBoolean())
            .as("no step-up happened, so the token may not claim one")
            .isFalse();
    }

    /**
     * Same for a manager: no secret, no step-up permission, no enrolment demand. This is the
     * persona a careless widening of {@code requiresTotpStepUp} would lock out, so it is asserted
     * rather than assumed.
     */
    @Test
    void managerLogin_isNotForcedIntoTotpEnrollment() throws Exception {
        var response = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(
                TestFixtures.MANAGER_EMAIL, TestFixtures.MANAGER_PASSWORD, TestFixtures.DEMO_SLUG));
        assertThat(response.getStatusCode())
            .as("body was: %s", response.getBody())
            .isEqualTo(HttpStatus.OK);

        JsonNode payload = decodeJwtPayload(accessTokenOf(response.getBody()));
        assertThat(payload.path("totp_verified").asBoolean()).isFalse();
    }

    /**
     * Refresh deliberately drops the marker. The refresh cookie lives 30 days and the access token
     * one hour; re-minting step-up from the cookie would let a stolen refresh token disburse
     * payroll for a month without ever presenting a code. A step-up-gated action after the access
     * token rotates costs one re-login, which is what step-up is for.
     */
    @Test
    void refreshedToken_doesNotCarryTheStepUpMarker() throws Exception {
        var login = loginWithCurrentCode();
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(decodeJwtPayload(accessTokenOf(login.getBody())).path("totp_verified").asBoolean()).isTrue();

        String refreshCookie = firstCookie(login.getHeaders().getFirst("Set-Cookie"));
        var refreshed = rest.post()
            .uri("/api/v1/auth/refresh")
            .header("Cookie", refreshCookie)
            .retrieve()
            .toEntity(String.class);
        assertThat(refreshed.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode payload = decodeJwtPayload(accessTokenOf(refreshed.getBody()));
        assertThat(payload.path("permissions").toString())
            .as("refresh still re-resolves permissions as before")
            .contains("hr.payroll.approve");
        assertThat(payload.path("totp_verified").asBoolean())
            .as("step-up does not survive a refresh")
            .isFalse();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────

    private org.springframework.http.ResponseEntity<String> loginWithCurrentCode() throws Exception {
        String code = codeGenerator.generate(ownerTotpSecret, timeProvider.getTime() / 30L);
        return rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.OWNER_EMAIL, TestFixtures.OWNER_PASSWORD, TestFixtures.DEMO_SLUG, code))
            .retrieve()
            .toEntity(String.class);
    }

    private String accessTokenOf(String responseBody) throws Exception {
        return objectMapper.readTree(responseBody).path("data").path("accessToken").asText();
    }

    /** Reads the JWT payload without verifying: the assertions here are about what was minted. */
    private JsonNode decodeJwtPayload(String jwt) throws Exception {
        assertThat(jwt).isNotBlank();
        String[] parts = jwt.split("\\.");
        assertThat(parts).hasSize(3);
        return objectMapper.readTree(
            new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
    }

    private static String firstCookie(String setCookie) {
        assertThat(setCookie).startsWith("refresh_token=");
        int semi = setCookie.indexOf(';');
        return semi > 0 ? setCookie.substring(0, semi) : setCookie;
    }
}
