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

import static org.assertj.core.api.Assertions.assertThat;

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

        String code = codeGenerator.generate(ownerTotpSecret, timeProvider.getTime() / 30L);
        var withTotp = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.OWNER_EMAIL, TestFixtures.OWNER_PASSWORD, TestFixtures.DEMO_SLUG, code))
            .retrieve()
            .toEntity(String.class);
        assertThat(withTotp.getStatusCode()).isEqualTo(HttpStatus.OK);
        String accessToken = objectMapper.readTree(withTotp.getBody()).path("data").path("accessToken").asText();
        assertThat(accessToken).isNotBlank();
    }

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
    }
}
