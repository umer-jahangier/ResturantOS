package io.restaurantos.auth.integration;

import io.restaurantos.auth.config.InternalServiceFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClient;

import java.util.Base64;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code POST /internal/auth/platform-token} — the only door through which a tenant-less platform
 * token can be minted.
 *
 * <p>Two properties are asserted rather than assumed:
 * <ol>
 *   <li>The endpoint is reachable at all under {@code /internal/auth/**}, i.e. SecurityConfig's
 *       {@code permitAll} on that prefix really does let the request through to
 *       {@link InternalServiceFilter}. The plan's premise was "no security config change is
 *       needed"; this is the assertion that makes that a fact instead of a hope.</li>
 *   <li>The InternalServiceFilter secret is the ONLY thing standing in front of it — no secret
 *       means 403 INTERNAL_AUTH_REQUIRED, and the RSA private key never leaves auth-service
 *       (threat T-13-01-B).</li>
 * </ol>
 */
class PlatformTokenInternalIT extends BaseIntegrationTest {

    private static final String PATH = "/internal/auth/platform-token";
    private static final String INTERNAL_SECRET = "dev-internal-secret";

    // ── Gate: no secret / wrong secret → 403, and no token is produced ───────────────────────

    @Test
    void mintPlatformToken_withoutInternalSecret_returns403() {
        ResponseEntity<String> response = post(body(UUID.randomUUID(), "SUPER_ADMIN"), null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
        assertThat(response.getBody()).doesNotContain("token");
    }

    @Test
    void mintPlatformToken_withWrongInternalSecret_returns403() {
        ResponseEntity<String> response = post(body(UUID.randomUUID(), "SUPER_ADMIN"), "not-the-secret");

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    // ── Happy path: a real, tenant-less, RS256 platform token ────────────────────────────────

    @Test
    void mintPlatformToken_withInternalSecret_returnsTenantLessToken() {
        UUID platformUserId = UUID.randomUUID();

        ResponseEntity<String> response = post(body(platformUserId, "SUPER_ADMIN"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        String responseBody = response.getBody();
        assertThat(responseBody).contains("\"tokenType\":\"platform\"");
        assertThat(responseBody).contains("\"expiresIn\":900");

        String token = extract(responseBody, "token");
        assertThat(token).as("a three-segment JWS").matches("[^.]+\\.[^.]+\\.[^.]+");

        String payload = decodePayload(token);
        assertThat(payload).contains(platformUserId.toString());
        assertThat(payload).contains("\"token_type\":\"platform\"");
        assertThat(payload)
                .as("a platform user has no tenant; the claim keys must not appear at all")
                .doesNotContain("tenant_id")
                .doesNotContain("branch_id");
        assertThat(payload).contains("SUPER_ADMIN");
    }

    // ── Validation: an unrecognised platform role never reaches the signer ───────────────────

    @Test
    void mintPlatformToken_withUnknownRole_returns400() {
        ResponseEntity<String> response = post(body(UUID.randomUUID(), "ROOT"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).doesNotContain("\"token\"");
    }

    @Test
    void mintPlatformToken_withoutPlatformUserId_returns400() {
        ResponseEntity<String> response = post(Map.of("platformRole", "SUPER_ADMIN"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private Map<String, Object> body(UUID platformUserId, String platformRole) {
        return Map.of("platformUserId", platformUserId.toString(), "platformRole", platformRole);
    }

    private ResponseEntity<String> post(Object body, String secret) {
        RestClient.RequestBodySpec spec = rest.post().uri(PATH).contentType(MediaType.APPLICATION_JSON);
        if (secret != null) {
            spec = spec.header(InternalServiceFilter.HEADER, secret);
        }
        return spec.body(body).exchange((request, response) -> {
            byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
            return ResponseEntity.status(response.getStatusCode())
                    .body(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
        });
    }

    private static String extract(String json, String field) {
        String marker = "\"" + field + "\":\"";
        int start = json.indexOf(marker);
        assertThat(start).as("field '%s' present in %s", field, json).isNotNegative();
        start += marker.length();
        return json.substring(start, json.indexOf('"', start));
    }

    private static String decodePayload(String token) {
        return new String(Base64.getUrlDecoder().decode(token.split("\\.")[1]),
                java.nio.charset.StandardCharsets.UTF_8);
    }
}
