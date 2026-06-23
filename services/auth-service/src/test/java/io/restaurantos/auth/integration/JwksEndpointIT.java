package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.service.JwtSigningService;
import io.restaurantos.shared.security.JwtClaims;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;

import java.security.PublicKey;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class JwksEndpointIT extends BaseIntegrationTest {

    @Autowired private JwtSigningService jwtSigningService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void jwksEndpoint_exposesKeyThatVerifiesSignedToken() throws Exception {
        var jwksResponse = rest.get()
            .uri("/.well-known/jwks.json")
            .retrieve()
            .toEntity(String.class);
        assertThat(jwksResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode jwksJson = objectMapper.readTree(jwksResponse.getBody());
        JWKSet jwkSet = JWKSet.parse(jwksJson.toString());
        assertThat(jwkSet.getKeys()).hasSize(1);
        assertThat(jwkSet.getKeys().getFirst().getKeyID()).isEqualTo("test-key-1");

        PublicKey publicKey = jwkSet.getKeys().getFirst().toRSAKey().toPublicKey();
        JwtClaims claims = new JwtClaims(
            TestFixtures.cashierUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("CASHIER"),
            List.of("pos.order.view"),
            Map.of("approval_limit_paisa", 5000000L),
            null);

        String token = jwtSigningService.signAccessToken(claims);

        assertThat(Jwts.parser().verifyWith(publicKey).build().parseSignedClaims(token)).isNotNull();
    }
}
