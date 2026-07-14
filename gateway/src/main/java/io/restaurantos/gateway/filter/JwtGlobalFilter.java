package io.restaurantos.gateway.filter;

import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Reactive JWT validation filter — the gateway's authentication boundary.
 *
 * <p>This is a reactive {@link GlobalFilter} (NOT {@code OncePerRequestFilter} which is
 * servlet-only — Pitfall 3). It runs at {@code Ordered.HIGHEST_PRECEDENCE + 10}, before
 * the {@link FeatureFlagGlobalFilter} (which runs at HIGHEST_PRECEDENCE + 20).
 *
 * <h3>Processing steps:</h3>
 * <ol>
 *   <li>Pass through public paths without JWT check.</li>
 *   <li>Extract and validate the {@code Authorization: Bearer} header.</li>
 *   <li>Verify RS256 signature and expiry against {@link JwksKeyProvider} (shared-lib).</li>
 *   <li>Parse {@link JwtClaims} from the JWT payload.</li>
 *   <li>Resolve {@code tenant_id} via {@link TenantResolutionSupport}.</li>
 *   <li>Mutate the upstream request by injecting {@code X-Tenant-Id}, {@code X-User-Id},
 *       and optionally {@code X-Impersonated-By} (Pitfall 7 — propagate for audit).</li>
 * </ol>
 *
 * <p>Any failure in steps 2–5 results in a 401 UNAUTHENTICATED response; the upstream
 * NEVER receives the request.
 */
@Component
public class JwtGlobalFilter implements GlobalFilter, Ordered {

    private static final List<String> PUBLIC_PATHS = List.of(
            "/api/v1/auth/login",
            "/api/v1/auth/refresh",
            "/api/v1/auth/reset-password",
            "/api/v1/auth/tenants",
            "/.well-known",
            "/actuator/health",
            "/actuator/prometheus",
            "/fallback"
    );

    private static final String UNAUTHENTICATED_BODY =
            "{\"error\":{\"code\":\"UNAUTHENTICATED\",\"message\":\"Authentication required\"}}";

    private final JwksKeyProvider jwksKeyProvider;
    private final TenantResolutionSupport tenantResolutionSupport;

    public JwtGlobalFilter(JwksKeyProvider jwksKeyProvider,
                           TenantResolutionSupport tenantResolutionSupport) {
        this.jwksKeyProvider = jwksKeyProvider;
        this.tenantResolutionSupport = tenantResolutionSupport;
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 10;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();

        if (isPublicPath(path)) {
            return chain.filter(exchange);
        }

        String authHeader = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return writeError(exchange, HttpStatus.UNAUTHORIZED, UNAUTHENTICATED_BODY);
        }

        String token = authHeader.substring(7);

        JwtClaims claims;
        try {
            claims = validateAndParse(token);
        } catch (Exception e) {
            return writeError(exchange, HttpStatus.UNAUTHORIZED, UNAUTHENTICATED_BODY);
        }

        return tenantResolutionSupport.resolve(exchange, claims)
                .flatMap(tenantId -> {
                    ServerHttpRequest.Builder requestBuilder = exchange.getRequest().mutate()
                            .header("X-Tenant-Id", tenantId.toString())
                            .header("X-User-Id", claims.subject().toString());

                    // Propagate impersonation claim for downstream audit logging (Pitfall 7)
                    if (claims.impersonatedBy() != null) {
                        requestBuilder.header("X-Impersonated-By", claims.impersonatedBy().toString());
                    }

                    ServerWebExchange mutated = exchange.mutate()
                            .request(requestBuilder.build())
                            .build();
                    return chain.filter(mutated);
                })
                .onErrorResume(ex -> writeError(exchange, HttpStatus.UNAUTHORIZED, UNAUTHENTICATED_BODY));
    }

    /**
     * Validates the JWT signature (RS256) and expiry, then parses the payload into
     * {@link JwtClaims}. Throws on any verification failure.
     */
    private JwtClaims validateAndParse(String token) throws Exception {
        SignedJWT jwt = SignedJWT.parse(token);

        // Peek the kid from the header to select the correct public key
        String kid = jwt.getHeader().getKeyID();
        if (kid == null) {
            // Fallback: peek from base64 header if nimbus doesn't expose it
            kid = JwtClaims.peekKid(token);
        }

        RSAPublicKey publicKey = (RSAPublicKey) jwksKeyProvider.getKey(kid);
        JWSVerifier verifier = new RSASSAVerifier(publicKey);

        if (!jwt.verify(verifier)) {
            throw new SecurityException("JWT signature verification failed");
        }

        Date expiry = jwt.getJWTClaimsSet().getExpirationTime();
        if (expiry == null || expiry.before(new Date())) {
            throw new SecurityException("JWT is expired");
        }

        Map<String, Object> claims = jwt.getJWTClaimsSet().getClaims();

        UUID subject = parseUuid(claims, "sub");
        UUID tenantId = parseUuid(claims, "tenant_id");
        UUID branchId = parseUuid(claims, "branch_id");
        UUID impersonatedBy = parseUuid(claims, "impersonated_by");

        @SuppressWarnings("unchecked")
        List<String> roles = claims.get("roles") instanceof List<?> r
                ? (List<String>) r : List.of();
        @SuppressWarnings("unchecked")
        List<String> permissions = claims.get("permissions") instanceof List<?> p
                ? (List<String>) p : List.of();
        @SuppressWarnings("unchecked")
        Map<String, Object> attributes = claims.get("attributes") instanceof Map<?, ?> a
                ? (Map<String, Object>) a : Map.of();

        return new JwtClaims(subject, tenantId, branchId, roles, permissions, attributes, impersonatedBy);
    }

    private UUID parseUuid(Map<String, Object> claims, String key) {
        Object val = claims.get(key);
        if (val == null) return null;
        try {
            return UUID.fromString(val.toString());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private boolean isPublicPath(String path) {
        return PUBLIC_PATHS.stream().anyMatch(path::startsWith);
    }

    /**
     * Writes a JSON error response and terminates the reactive chain. The upstream
     * is NEVER called when this method is invoked.
     */
    Mono<Void> writeError(ServerWebExchange exchange, HttpStatus status, String body) {
        exchange.getResponse().setStatusCode(status);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        byte[] bytes = body.getBytes();
        return exchange.getResponse().writeWith(
                Mono.just(exchange.getResponse().bufferFactory().wrap(bytes))
        );
    }
}
