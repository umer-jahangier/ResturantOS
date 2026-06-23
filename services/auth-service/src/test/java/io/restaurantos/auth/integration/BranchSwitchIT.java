package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class BranchSwitchIT extends BaseIntegrationTest {

    @Autowired private UserBranchRoleRepository userBranchRoleRepository;
    @Autowired private RefreshSessionRepository refreshSessionRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void ensureCashierOnBranchTwo() {
        setRls(TestFixtures.demoTenantId());
        if (userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(
                TestFixtures.cashierUserId(), TestFixtures.branch2Id()).isEmpty()) {
            UserBranchRoleEntity assignment = new UserBranchRoleEntity();
            assignment.setId(UUID.fromString("d0000006-0000-4000-8000-000000000006"));
            assignment.setTenantId(TestFixtures.demoTenantId());
            assignment.setUserId(TestFixtures.cashierUserId());
            assignment.setBranchId(TestFixtures.branch2Id());
            assignment.setRoleCode("CASHIER");
            assignment.setApprovalLimitPaisa(5_000_000L);
            assignment.setActive(true);
            userBranchRoleRepository.save(assignment);
        }
    }

    @Test
    void switchBranch_reissuesJwtAndKeepsRefreshSession() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);

        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();
        String refreshCookie = login.getHeaders().get("Set-Cookie").getFirst();
        Claims initialClaims = parseJwt(accessToken);
        assertThat(initialClaims.get("branch_id", String.class))
            .isEqualTo(TestFixtures.mainBranchId().toString());

        var switched = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", TestFixtures.branch2Id().toString()))
            .retrieve()
            .toEntity(String.class);
        assertThat(switched.getStatusCode()).isEqualTo(HttpStatus.OK);

        String newAccessToken = objectMapper.readTree(switched.getBody()).path("data").path("accessToken").asText();
        Claims newClaims = parseJwt(newAccessToken);
        assertThat(newClaims.get("branch_id", String.class))
            .isEqualTo(TestFixtures.branch2Id().toString());

        var refresh = rest.post()
            .uri("/api/v1/auth/refresh")
            .header("Cookie", refreshCookie.substring(0, refreshCookie.indexOf(';')))
            .retrieve()
            .toEntity(String.class);
        assertThat(refresh.getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        String tokenHash = sha256Hex(extractCookieValue(refreshCookie));
        RefreshSessionEntity session = refreshSessionRepository.findByTokenHash(tokenHash).orElseThrow();
        assertThat(session.getRevokedAt()).isNull();
    }

    @Test
    void switchBranch_unassignedBranchReturns403() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();

        UUID unassignedBranch = UUID.fromString("b0000003-0000-4000-8000-000000000003");
        var response = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", unassignedBranch.toString()))
            .exchange((request, httpResponse) -> {
                byte[] bytes = httpResponse.getBody() != null ? httpResponse.getBody().readAllBytes() : new byte[0];
                return org.springframework.http.ResponseEntity.status(httpResponse.getStatusCode())
                    .body(new String(bytes, StandardCharsets.UTF_8));
            });
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    private Claims parseJwt(String accessToken) throws Exception {
        String jwksBody = rest.get().uri("/.well-known/jwks.json").retrieve().body(String.class);
        JWKSet jwkSet = JWKSet.parse(jwksBody);
        PublicKey publicKey = jwkSet.getKeys().getFirst().toRSAKey().toPublicKey();
        return Jwts.parser().verifyWith(publicKey).build()
            .parseSignedClaims(accessToken).getPayload();
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
