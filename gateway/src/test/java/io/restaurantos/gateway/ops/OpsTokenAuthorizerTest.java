package io.restaurantos.gateway.ops;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import io.restaurantos.shared.security.JwksKeyProvider;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ServerWebExchange;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.util.Date;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The gate in front of {@code GET /api/v1/ops/health}, asserted directly.
 *
 * <h3>Why this is worth its own class</h3>
 *
 * {@link FleetHealthController} is a controller INSIDE the gateway, so
 * {@code JwtGlobalFilter} — a {@code GlobalFilter}, which only runs for route-matched requests —
 * never sees it, and {@code GatewaySecurityConfig} permits every exchange by design. This class is
 * therefore the entire authentication and authorization boundary for that endpoint. "It is
 * protected because the gateway protects things" is precisely the sort of assumption this
 * repository has been burned by, so each of the four outcomes is asserted here rather than
 * inferred.
 *
 * <p>The negative cases are the point. A gate that has only ever been watched saying yes has not
 * been watched.
 */
class OpsTokenAuthorizerTest {

    private static final String KID = "test-key-1";
    private static KeyPair keyPair;
    private static OpsTokenAuthorizer authorizer;

    @BeforeAll
    static void generateKeys() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        keyPair = generator.generateKeyPair();
        authorizer = new OpsTokenAuthorizer(new JwksKeyProvider(KID, keyPair.getPublic()));
    }

    @Test
    void noAuthorizationHeader_isUnauthenticated() {
        assertThat(authorizer.authorize(exchangeWith(null)))
                .isEqualTo(OpsTokenAuthorizer.Decision.UNAUTHENTICATED);
    }

    @Test
    void garbageBearer_isUnauthenticated() {
        assertThat(authorizer.authorize(exchangeWith("Bearer not-a-jwt")))
                .isEqualTo(OpsTokenAuthorizer.Decision.UNAUTHENTICATED);
    }

    @Test
    void tokenSignedByAnotherKey_isUnauthenticated() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair impostor = generator.generateKeyPair();
        String token = sign((RSAPrivateKey) impostor.getPrivate(),
                List.of(OpsTokenAuthorizer.HEALTH_VIEW_PERMISSION), 900);

        assertThat(authorizer.authorize(exchangeWith("Bearer " + token)))
                .isEqualTo(OpsTokenAuthorizer.Decision.UNAUTHENTICATED);
    }

    @Test
    void expiredToken_isUnauthenticated_evenWithTheRightPermission() throws Exception {
        String token = sign((RSAPrivateKey) keyPair.getPrivate(),
                List.of(OpsTokenAuthorizer.HEALTH_VIEW_PERMISSION), -60);

        assertThat(authorizer.authorize(exchangeWith("Bearer " + token)))
                .isEqualTo(OpsTokenAuthorizer.Decision.UNAUTHENTICATED);
    }

    @Test
    void validTokenWithoutThePermission_isForbidden() throws Exception {
        // A cashier's real token: signed, current, and carrying a POS permission set. It must not
        // reach the fleet inventory, and it must be told apart from a broken token so the client
        // renders a refusal rather than bouncing the user to the login screen.
        String token = sign((RSAPrivateKey) keyPair.getPrivate(),
                List.of("pos.order.create", "pos.order.update"), 900);

        assertThat(authorizer.authorize(exchangeWith("Bearer " + token)))
                .isEqualTo(OpsTokenAuthorizer.Decision.FORBIDDEN);
    }

    @Test
    void validTokenCarryingThePermission_isAllowed() throws Exception {
        String token = sign((RSAPrivateKey) keyPair.getPrivate(),
                List.of("branch.manage", OpsTokenAuthorizer.HEALTH_VIEW_PERMISSION), 900);

        assertThat(authorizer.authorize(exchangeWith("Bearer " + token)))
                .isEqualTo(OpsTokenAuthorizer.Decision.ALLOWED);
    }

    private static ServerWebExchange exchangeWith(String authorizationHeader) {
        MockServerHttpRequest.BaseBuilder<?> builder = MockServerHttpRequest.get("/api/v1/ops/health");
        if (authorizationHeader != null) {
            builder = builder.header(HttpHeaders.AUTHORIZATION, authorizationHeader);
        }
        return MockServerWebExchange.from(builder.build());
    }

    private static String sign(RSAPrivateKey key, List<String> permissions, long expiresInSeconds)
            throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject("00000000-0000-4000-8000-000000000001")
                .claim("permissions", permissions)
                .expirationTime(new Date(System.currentTimeMillis() + expiresInSeconds * 1000))
                .build();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KID).build(), claims);
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }
}
