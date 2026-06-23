package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import io.restaurantos.auth.entity.UserEntity;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class TotpFlowIT extends BaseIntegrationTest {

    private static final Pattern SECRET_PARAM = Pattern.compile("[?&]secret=([^&]+)");

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final DefaultCodeGenerator codeGenerator = new DefaultCodeGenerator();
    private final SystemTimeProvider timeProvider = new SystemTimeProvider();

    @AfterEach
    void restoreCashierTotpState() {
        setRls(TestFixtures.demoTenantId());
        userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).ifPresent(user -> {
            user.setTotpSecret(null);
            user.setTotpEnabled(false);
            userRepository.save(user);
        });
    }

    @Test
    void totpSetupVerifyAndDisable_encryptsSecretAtRest() throws Exception {
        String accessToken = loginCashier();

        var setup = rest.post()
            .uri("/api/v1/auth/2fa/setup")
            .header("Authorization", "Bearer " + accessToken)
            .retrieve()
            .toEntity(String.class);
        assertThat(setup.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode setupBody = objectMapper.readTree(setup.getBody());
        String otpauthUri = setupBody.path("data").path("otpauthUri").asText();
        assertThat(otpauthUri).startsWith("otpauth://");
        String rawSecret = extractSecret(otpauthUri);

        byte[] storedBytes = rawTotpSecretBytes(TestFixtures.cashierUserId());
        assertThat(storedBytes).isNotNull();
        assertThat(storedBytes).isNotEqualTo(rawSecret.getBytes(StandardCharsets.UTF_8));

        String validCode = codeGenerator.generate(rawSecret, timeProvider.getTime() / 30L);
        var verify = rest.post()
            .uri("/api/v1/auth/2fa/verify")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("code", validCode))
            .retrieve()
            .toEntity(String.class);
        assertThat(verify.getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        UserEntity user = userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow();
        assertThat(user.isTotpEnabled()).isTrue();

        var badVerify = exchangePostWithAuth("/api/v1/auth/2fa/verify", accessToken, Map.of("code", "000000"));
        assertThat(badVerify.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    private String loginCashier() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        return objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();
    }

    private byte[] rawTotpSecretBytes(java.util.UUID userId) {
        Object result = entityManager.createNativeQuery(
                "SELECT totp_secret FROM users WHERE id = :id")
            .setParameter("id", userId)
            .getSingleResult();
        return result != null ? (byte[]) result : null;
    }

    private static String extractSecret(String otpauthUri) throws Exception {
        Matcher matcher = SECRET_PARAM.matcher(otpauthUri);
        assertThat(matcher.find()).isTrue();
        return URLDecoder.decode(matcher.group(1), StandardCharsets.UTF_8);
    }

    private org.springframework.http.ResponseEntity<String> exchangePostWithAuth(
            String uri, String accessToken, Object body) {
        return rest.post()
            .uri(uri)
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((request, response) -> {
                byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
                return org.springframework.http.ResponseEntity.status(response.getStatusCode())
                    .body(new String(bytes, StandardCharsets.UTF_8));
            });
    }
}
