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
 *       {@code X-TOTP-Verified} (from the signed {@code totp_verified} claim — see
 *       {@link StripInternalHeaderFilter}, which deleted the client's version at
 *       {@code HIGHEST_PRECEDENCE + 5}), and optionally {@code X-Impersonated-By}
 *       (Pitfall 7 — propagate for audit).</li>
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
            // First-time TOTP enrolment. Public for the same reason /login is: the caller has no
            // token yet and cannot obtain one until this completes. auth-service re-verifies the
            // password on both calls and refuses once a secret exists.
            "/api/v1/auth/2fa/bootstrap",
            "/.well-known",
            "/actuator/health",
            "/actuator/prometheus",
            "/fallback",
            // Device-authenticated attendance ingest: no user JWT (the device has no login). The
            // device token is verified by hr-service's DeviceAuthResolver, and these paths stay
            // FEATURE_HR-gated (RouteFeatureMap) + per-device rate-limited. JWT-skip only.
            "/iclock",
            "/internal/attendance/ingest",
            // Platform (SuperAdmin) login — implemented by 13-05 in platform-admin-service. Public
            // for the same reason /api/v1/auth/login is: the caller has no token and cannot get one
            // until this succeeds. Rate-limited by platform-auth-route, which is declared BEFORE
            // platform-admin-route in application.yml (threat T-13-01-BF).
            "/api/v1/platform/auth/login",
            // Forced password change — implemented by 13-08. Registered in its FULLY QUALIFIED form
            // on purpose: isPublicPath uses startsWith, so registering the bare
            // "/api/v1/auth/change-password" would also expose the authenticated self-service
            // endpoint 13-04 adds at exactly that path. This one is self-authenticating (single-use
            // change token + current password); that one must stay behind the JWT check.
            "/api/v1/auth/change-password/forced"
    );

    /**
     * Path prefixes on which a token carrying NO {@code tenant_id} claim is acceptable.
     *
     * <p>Exactly one entry, and it should stay that way. A platform user lives in
     * {@code platform_db.platform_users} and belongs to no tenant, so
     * {@link TenantResolutionSupport#resolve} necessarily fails for its token — no claim, and no
     * tenant subdomain in the Host either — and {@link #authorizeAndForward} turns that failure
     * into a 401. That is the third independent cause of audit blocker B1: even a correctly signed
     * SuperAdmin token could never reach {@code /api/v1/platform/**}.
     *
     * <p>The exemption is scoped HERE, at the caller, rather than by relaxing
     * {@code TenantResolutionSupport}. The resolver's contract stays honest ("a tenant-scoped
     * request without a resolvable tenant is an error"), and no tenant-scoped route can reach the
     * relaxed branch by construction rather than by review (threat T-13-01-A).
     */
    private static final List<String> TENANT_OPTIONAL_PATHS = List.of("/api/v1/platform");

    /**
     * Path prefixes for WebSocket endpoints whose handshake auth MUST be allowed via a
     * {@code ?token=} query param, because a browser's native {@code WebSocket} API cannot set
     * a custom {@code Authorization} header on the upgrade request (12-12 gap closure, §1h).
     *
     * <p>This fallback is deliberately scoped to genuine WebSocket UPGRADE requests on these two
     * prefixes only — ordinary REST traffic (no {@code Upgrade} header) always requires the
     * {@code Authorization} header, so a JWT is never accepted from a URL/query string for normal
     * API calls (where it could leak into logs/proxies/browser history).
     */
    private static final List<String> WS_UPGRADE_PATHS = List.of(
            "/api/v1/reporting/dashboard/",
            "/api/v1/kitchen/"
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

        if (isWebSocketUpgrade(exchange) && isWsUpgradePath(path)) {
            String token = exchange.getRequest().getQueryParams().getFirst("token");
            if (token == null || token.isBlank()) {
                return writeError(exchange, HttpStatus.UNAUTHORIZED, UNAUTHENTICATED_BODY);
            }

            JwtClaims claims;
            try {
                claims = validateAndParse(token);
            } catch (Exception e) {
                return writeError(exchange, HttpStatus.UNAUTHORIZED, UNAUTHENTICATED_BODY);
            }

            return authorizeAndForward(exchange, claims, chain);
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

        return authorizeAndForward(exchange, claims, chain);
    }

    /**
     * Resolves the tenant for {@code claims}, mutates the request with the downstream identity
     * headers ({@code X-Tenant-Id}, {@code X-User-Id}, optionally {@code X-Impersonated-By}), and
     * forwards the request down the filter chain. Shared by BOTH the header-auth path and the
     * WS-upgrade query-param path to avoid duplicating the mutation logic.
     */
    private Mono<Void> authorizeAndForward(ServerWebExchange exchange, JwtClaims claims, GatewayFilterChain chain) {
        // Tenant-less token on a tenant-optional path: forward WITHOUT resolving a tenant and
        // WITHOUT an X-Tenant-Id header. Deliberately not "resolve, and fall back to no tenant on
        // failure" — that would let any tenant-scoped route through whenever resolution merely
        // broke (Redis down, platform-admin unreachable), converting an outage into an
        // authorization bypass. Both conditions must hold, and TenantResolutionSupport is not
        // consulted at all on this branch.
        //
        // The upstream must therefore treat an ABSENT X-Tenant-Id as "no tenant", never as a
        // default one. No placeholder is injected here, and none may be inferred there
        // (threat T-13-01-D).
        if (claims.tenantId() == null && isTenantOptionalPath(exchange.getRequest().getPath().value())) {
            return chain.filter(exchange.mutate().request(identityHeaders(exchange, claims).build()).build());
        }

        return tenantResolutionSupport.resolve(exchange, claims)
                .flatMap(tenantId -> {
                    ServerHttpRequest.Builder requestBuilder = identityHeaders(exchange, claims)
                            .header("X-Tenant-Id", tenantId.toString());

                    ServerWebExchange mutated = exchange.mutate()
                            .request(requestBuilder.build())
                            .build();
                    return chain.filter(mutated);
                })
                .onErrorResume(ex -> writeError(exchange, HttpStatus.UNAUTHORIZED, UNAUTHENTICATED_BODY));
    }

    /**
     * The identity headers every authenticated request carries upstream, tenant-bearing or not.
     *
     * <p>Extracted so the tenant-optional branch cannot drift from the tenant-bearing one: the only
     * difference between them must be the presence of {@code X-Tenant-Id}, and keeping the rest in
     * one place is what makes that true rather than merely intended.
     */
    private ServerHttpRequest.Builder identityHeaders(ServerWebExchange exchange, JwtClaims claims) {
        ServerHttpRequest.Builder requestBuilder = exchange.getRequest().mutate()
                .header("X-User-Id", claims.subject().toString())
                // Re-created from the signed claim, never forwarded from the client:
                // StripInternalHeaderFilter (HIGHEST_PRECEDENCE + 5) has already
                // deleted whatever the caller sent. Written on every authenticated
                // request, including the false case, so the upstream reads a value
                // this gateway authored rather than an absence it has to interpret.
                .header(StripInternalHeaderFilter.TOTP_VERIFIED_HEADER,
                        Boolean.toString(claims.totpVerified()));

        // Propagate impersonation claim for downstream audit logging (Pitfall 7)
        if (claims.impersonatedBy() != null) {
            requestBuilder.header("X-Impersonated-By", claims.impersonatedBy().toString());
        }
        return requestBuilder;
    }

    /**
     * True when the request is a WebSocket handshake (the {@code Upgrade} header case-insensitively
     * equals {@code websocket}), matching RFC 6455 client handshake semantics.
     */
    private boolean isWebSocketUpgrade(ServerWebExchange exchange) {
        String upgrade = exchange.getRequest().getHeaders().getFirst(HttpHeaders.UPGRADE);
        return upgrade != null && upgrade.equalsIgnoreCase("websocket");
    }

    private boolean isWsUpgradePath(String path) {
        return WS_UPGRADE_PATHS.stream().anyMatch(path::startsWith);
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
        // Anything that is not a JSON true — absent, null, the string "true", a number — is not a
        // verified step-up. Tokens minted before this claim existed therefore read as false.
        boolean totpVerified = claims.get("totp_verified") instanceof Boolean b && b;

        return new JwtClaims(subject, tenantId, branchId, roles, permissions, attributes,
                impersonatedBy, totpVerified);
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

    /**
     * True when {@code path} needs no token at all.
     *
     * <p>Package-private for the same reason {@link #isTenantOptionalPath} is: this list is a
     * security boundary, and "path X is NOT public" is a property that should be assertable
     * directly rather than inferred from an integration test happening to 401. A path added here by
     * mistake fails open silently — no error, no log, just an endpoint that stops asking for a
     * token — which is the shape of defect that has to be caught by a test naming the path.
     */
    boolean isPublicPath(String path) {
        return PUBLIC_PATHS.stream().anyMatch(path::startsWith);
    }

    /**
     * True when {@code path} is inside a {@link #TENANT_OPTIONAL_PATHS} prefix.
     *
     * <p>Matches on a SEGMENT boundary, not a bare {@code startsWith}: {@code /api/v1/platform} and
     * {@code /api/v1/platform/tenants} match, {@code /api/v1/platformish} does not. A bare prefix
     * test would let any future route whose path merely began with those characters inherit the
     * tenant exemption — the whole point of T-13-01-A is that this set is closed.
     *
     * <p>A path containing a {@code ..} segment is refused outright. WebFlux does not collapse dot
     * segments — {@code getPath().value()} is what the client sent — so without this a request
     * could carry the platform prefix here while an upstream that DOES normalise sees a different
     * resource. Refusing is fail-closed: the request simply falls through to ordinary tenant
     * resolution, which 401s a tenant-less token. No legitimate API path contains {@code ..}.
     *
     * <p>Package-private so {@code JwtGlobalFilterTenantOptionalPathTest} can assert the boundary
     * directly, without a Spring context.
     */
    boolean isTenantOptionalPath(String path) {
        if (path.contains("/../") || path.endsWith("/..")) {
            return false;
        }
        return TENANT_OPTIONAL_PATHS.stream()
                .anyMatch(prefix -> path.equals(prefix) || path.startsWith(prefix + "/"));
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
