package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.entity.UserEntity;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import java.security.PublicKey;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AuthLoginIT extends BaseIntegrationTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void loginSuccess_issuesJwtRefreshCookieAndLoginEvent() throws Exception {
        long eventsBefore = countOutboxEvents("USER_LOGIN_SUCCEEDED");

        var response = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode body = objectMapper.readTree(response.getBody());
        String accessToken = body.path("data").path("accessToken").asText();
        assertThat(accessToken).isNotBlank();

        Claims claims = verifyAgainstJwks(accessToken);
        assertThat(claims.getSubject()).isEqualTo(TestFixtures.CASHIER_USER_ID.toString());
        assertThat(claims.get("tenant_id", String.class)).isEqualTo(TestFixtures.DEMO_TENANT_ID.toString());
        assertThat(claims.get("branch_id", String.class)).isEqualTo(TestFixtures.MAIN_BRANCH_ID.toString());
        @SuppressWarnings("unchecked")
        List<String> permissions = claims.get("permissions", List.class);
        assertThat(permissions).doesNotContain("rbac.manage", "finance.period.close");
        @SuppressWarnings("unchecked")
        Map<String, Object> attributes = claims.get("attributes", Map.class);
        assertThat(attributes).containsEntry("approval_limit_paisa", 5000000);

        List<String> cookies = response.getHeaders().get("Set-Cookie");
        assertThat(cookies).anySatisfy(cookie -> {
            assertThat(cookie).contains("HttpOnly");
            assertThat(cookie).contains("Secure");
            assertThat(cookie).contains("SameSite=Strict");
            assertThat(cookie).contains("Path=/api/v1/auth");
        });

        assertThat(countOutboxEvents("USER_LOGIN_SUCCEEDED")).isEqualTo(eventsBefore + 1);
    }

    @Test
    void unknownTenantSlug_returns401WithoutLoginEvent() throws Exception {
        long failedBefore = countOutboxEvents("USER_LOGIN_FAILED");
        long succeededBefore = countOutboxEvents("USER_LOGIN_SUCCEEDED");

        var response = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, "unknown-slug"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(countOutboxEvents("USER_LOGIN_FAILED")).isEqualTo(failedBefore);
        assertThat(countOutboxEvents("USER_LOGIN_SUCCEEDED")).isEqualTo(succeededBefore);
    }

    @Test
    void repeatedBadPassword_locksAccountAndEmitsFailedEvents() throws Exception {
        resetAccountantLockout();
        long failedBefore = countOutboxEvents("USER_LOGIN_FAILED");

        for (int i = 0; i < 5; i++) {
            var response = exchangePost("/api/v1/auth/login",
                TestFixtures.loginBody(TestFixtures.ACCOUNTANT_EMAIL, "wrong-password", TestFixtures.DEMO_SLUG));
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        }

        setRls(TestFixtures.demoTenantId());
        UserEntity user = userRepository.findByEmail(TestFixtures.ACCOUNTANT_EMAIL).orElseThrow();
        assertThat(user.getLockedUntil()).isNotNull();
        assertThat(user.getLockedUntil()).isAfter(Instant.now());

        var lockedResponse = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(TestFixtures.ACCOUNTANT_EMAIL, TestFixtures.ACCOUNTANT_PASSWORD, TestFixtures.DEMO_SLUG));
        assertThat(lockedResponse.getStatusCode()).isEqualTo(HttpStatus.LOCKED);

        assertThat(countOutboxEvents("USER_LOGIN_FAILED")).isGreaterThanOrEqualTo(failedBefore + 5);
    }

    private Claims verifyAgainstJwks(String accessToken) throws Exception {
        String jwksBody = rest.get().uri("/.well-known/jwks.json").retrieve().body(String.class);
        JWKSet jwkSet = JWKSet.parse(jwksBody);
        PublicKey publicKey = jwkSet.getKeys().getFirst().toRSAKey().toPublicKey();
        return Jwts.parser().verifyWith(publicKey).build()
            .parseSignedClaims(accessToken).getPayload();
    }

    private long countOutboxEvents(String eventType) {
        return outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING").stream()
            .filter(e -> eventType.equals(e.getEventType()))
            .count()
            + outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("SENT").stream()
            .filter(e -> eventType.equals(e.getEventType()))
            .count();
    }

    private void resetAccountantLockout() {
        setRls(TestFixtures.demoTenantId());
        userRepository.findByEmail(TestFixtures.ACCOUNTANT_EMAIL).ifPresent(user -> {
            user.setFailedLoginCount(0);
            user.setLockedUntil(null);
            userRepository.save(user);
        });
    }
}
