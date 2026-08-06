package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.entity.PasswordHistoryEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Delivery mode pinned to {@code outbox} because this class asserts that a request WRITES an event;
 * the shipped default is {@code disabled} (13-09, D-31) and would correctly write none. The
 * property string is repeated verbatim in {@link PasswordResetHardeningIT} rather than shared via a
 * constant, so both classes produce the identical merged context configuration and Spring reuses
 * one context instead of starting a second.
 */
@TestPropertySource(properties = "restaurantos.auth.password-reset.delivery-mode=outbox")
class PasswordResetIT extends BaseIntegrationTest {

    @Autowired private PasswordHistoryRepository passwordHistoryRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Restored AFTER as well as before. A class that leaves the shared demo cashier holding a
     * password of its own choosing hands every later IT class a 401 on a credential the fixture
     * says is correct — and, because failsafe's default run order is the filesystem's, which class
     * pays for it changes when a file is added. 13-09 hit exactly that: adding one IT turned
     * StepUpLoginIT and RoleCatalogIT red with "Invalid credentials" for reasons that had nothing
     * to do with either. Restoring on both sides makes this class order-independent instead.
     */
    @BeforeEach
    @AfterEach
    void resetCashierPassword() {
        setRls(TestFixtures.demoTenantId());
        userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).ifPresent(user -> {
            user.setPasswordHash(passwordEncoder.encode(TestFixtures.CASHIER_PASSWORD));
            userRepository.save(user);
        });
    }

    @Test
    void passwordReset_singleUseAndHistoryReuseRejected() throws Exception {
        long eventsBefore = countOutboxEvents("PASSWORD_RESET_REQUESTED");

        var request = rest.post()
            .uri("/api/v1/auth/reset-password/request")
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("email", TestFixtures.CASHIER_EMAIL, "tenantSlug", TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(request.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(countOutboxEvents("PASSWORD_RESET_REQUESTED")).isEqualTo(eventsBefore + 1);

        String token = latestResetToken();
        String newPassword = "ResetPass#2026";

        var confirm = rest.post()
            .uri("/api/v1/auth/reset-password/confirm")
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("token", token, "newPassword", newPassword))
            .retrieve()
            .toEntity(String.class);
        assertThat(confirm.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertLoginFails(TestFixtures.CASHIER_PASSWORD);
        assertLoginSucceeds(newPassword);

        var secondConfirm = exchangePost("/api/v1/auth/reset-password/confirm",
            Map.of("token", token, "newPassword", "AnotherPass#2026"));
        assertThat(secondConfirm.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        seedPasswordHistory(newPassword);
        String secondToken = requestResetToken();
        var reuseAttempt = exchangePost("/api/v1/auth/reset-password/confirm",
            Map.of("token", secondToken, "newPassword", newPassword));
        assertThat(reuseAttempt.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(objectMapper.readTree(reuseAttempt.getBody()).path("error").path("code").asText())
            .isEqualTo("PASSWORD_REUSE");
    }

    private String requestResetToken() {
        rest.post()
            .uri("/api/v1/auth/reset-password/request")
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("email", TestFixtures.CASHIER_EMAIL, "tenantSlug", TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        return latestResetToken();
    }

    /**
     * Mints a RESET token whose raw value this test knows.
     *
     * <p>This method used to read {@code payload.token} out of the newest
     * {@code PASSWORD_RESET_REQUESTED} outbox row — which worked only because the raw credential
     * was in the outbox payload, the exact defect plan 13-09 removed (D-19). Once the event carries
     * identity plus a row handle, no observer of the event can reconstruct the token, and neither
     * can a test; recovering it from the stored SHA-256 is the thing the hashing exists to prevent.
     *
     * <p>Minting by construction is not a weakening of this test. Its subject is redemption — single
     * use, and the history/reuse rule — and it exercises the same {@code issueSingleUseToken} the
     * endpoint calls, so what it redeems is a real token. The endpoint's own 200 and its outbox row
     * are still asserted above; the CONTENT of that row is asserted by
     * {@code PasswordResetHardeningIT}, against the database.
     *
     * <p>Note the side effect, which is a property rather than a nuisance: issuing retires any
     * outstanding RESET token for the account, so the token the endpoint just minted is dead. That
     * is the single-live-token rule doing its job.
     */
    private String latestResetToken() {
        return mintResetToken(TestFixtures.demoTenantId(), TestFixtures.CASHIER_USER_ID);
    }

    private void seedPasswordHistory(String currentPassword) {
        setRls(TestFixtures.demoTenantId());
        UserEntity user = userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow();
        for (int i = 0; i < 5; i++) {
            PasswordHistoryEntity history = new PasswordHistoryEntity();
            history.setTenantId(user.getTenantId());
            history.setUserId(user.getId());
            history.setPasswordHash(passwordEncoder.encode("OldPass#" + i));
            passwordHistoryRepository.save(history);
        }
        user.setPasswordHash(passwordEncoder.encode(currentPassword));
        userRepository.save(user);
    }

    private void assertLoginFails(String password) {
        var response = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(TestFixtures.CASHIER_EMAIL, password, TestFixtures.DEMO_SLUG));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    private void assertLoginSucceeds(String password) throws Exception {
        var response = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(TestFixtures.CASHIER_EMAIL, password, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private long countOutboxEvents(String eventType) {
        return outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING").stream()
            .filter(e -> eventType.equals(e.getEventType()))
            .count()
            + outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("SENT").stream()
            .filter(e -> eventType.equals(e.getEventType()))
            .count();
    }
}
