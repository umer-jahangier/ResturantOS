package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.entity.PasswordHistoryEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import io.restaurantos.shared.event.OutboxEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Comparator;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class PasswordResetIT extends BaseIntegrationTest {

    @Autowired private PasswordHistoryRepository passwordHistoryRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
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

    private String requestResetToken() throws Exception {
        rest.post()
            .uri("/api/v1/auth/reset-password/request")
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("email", TestFixtures.CASHIER_EMAIL, "tenantSlug", TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        return latestResetToken();
    }

    private String latestResetToken() throws Exception {
        OutboxEntry entry = outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING").stream()
            .filter(e -> "PASSWORD_RESET_REQUESTED".equals(e.getEventType()))
            .max(Comparator.comparing(OutboxEntry::getCreatedAt))
            .orElseThrow();
        JsonNode envelope = objectMapper.readTree(entry.getEnvelopeJson());
        return envelope.path("payload").path("token").asText();
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
