package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;

class RefreshLogoutIT extends BaseIntegrationTest {

    @Autowired private RefreshSessionRepository refreshSessionRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void refreshAndLogout_lifecycle() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);

        String refreshCookie = extractRefreshCookie(login.getHeaders().get("Set-Cookie").getFirst());
        JsonNode loginBody = objectMapper.readTree(login.getBody());
        String firstAccessToken = loginBody.path("data").path("accessToken").asText();

        var refresh = rest.post()
            .uri("/api/v1/auth/refresh")
            .header("Cookie", refreshCookie)
            .retrieve()
            .toEntity(String.class);
        assertThat(refresh.getStatusCode()).isEqualTo(HttpStatus.OK);
        String refreshedToken = objectMapper.readTree(refresh.getBody()).path("data").path("accessToken").asText();
        assertThat(refreshedToken).isNotBlank().isNotEqualTo(firstAccessToken);

        var logout = exchangePost("/api/v1/auth/logout", refreshCookie);
        assertThat(logout.getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        String tokenHash = sha256Hex(extractCookieValue(refreshCookie));
        RefreshSessionEntity session = refreshSessionRepository.findByTokenHash(tokenHash).orElseThrow();
        assertThat(session.getRevokedAt()).isNotNull();

        var refreshAfterLogout = exchangePost("/api/v1/auth/refresh", refreshCookie);
        assertThat(refreshAfterLogout.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    private static String extractRefreshCookie(String setCookie) {
        assertThat(setCookie).startsWith("refresh_token=");
        return setCookie.substring(0, setCookie.indexOf(';') > 0 ? setCookie.indexOf(';') : setCookie.length());
    }

    private static String extractCookieValue(String cookieHeader) {
        int start = cookieHeader.indexOf('=') + 1;
        int end = cookieHeader.indexOf(';');
        return end > start ? cookieHeader.substring(start, end) : cookieHeader.substring(start);
    }

    private static String sha256Hex(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
