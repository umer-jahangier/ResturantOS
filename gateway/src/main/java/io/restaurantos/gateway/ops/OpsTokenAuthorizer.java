package io.restaurantos.gateway.ops;

import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import io.restaurantos.shared.security.JwksKeyProvider;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;

import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.List;

/**
 * The authorization gate in front of the gateway's own operator endpoints.
 *
 * <h3>Why this exists rather than reusing {@code JwtGlobalFilter}</h3>
 *
 * {@code JwtGlobalFilter} is a {@link org.springframework.cloud.gateway.filter.GlobalFilter}, and a
 * GlobalFilter only runs for requests that {@code RoutePredicateHandlerMapping} matched to a ROUTE.
 * {@link FleetHealthController} is a controller inside the gateway itself, so it is dispatched by
 * WebFlux without any route matching — and {@code GatewaySecurityConfig} permits every exchange on
 * purpose, because the GlobalFilter is meant to be the authentication boundary. A gateway-local
 * endpoint therefore has NO authentication at all unless it performs its own, and assuming
 * otherwise would have published the fleet's topology to the open internet.
 *
 * <p>The verification below is deliberately the same shape as the filter's — same
 * {@link JwksKeyProvider} bean, same RS256-and-expiry checks — and then STRICTER, because it
 * additionally requires {@link #HEALTH_VIEW_PERMISSION}. There is no path through this class that
 * ends in "allowed" without a valid signature, an unexpired token and that permission present.
 *
 * <h3>Fail closed</h3>
 *
 * Every failure — malformed header, unknown {@code kid}, bad signature, expired token, missing
 * permission — returns a refusal. Nothing here falls through to allow, and nothing distinguishes
 * "your token is broken" from "your token is fine but you may not look" beyond the 401/403 split
 * the client needs to tell a re-login from a refusal.
 */
@Component
public class OpsTokenAuthorizer {

    /**
     * The permission that gates the operator health screen.
     *
     * <p>Defined and granted by auth changelog {@code 089-ops-health-view-permission.xml} to OWNER
     * and TENANT_ADMIN. Named as a constant so {@code PermissionCatalogClosureTest}'s
     * {@code PERMISSION_CONSTANT} pattern reads it out of the gateway source and fails the build if
     * the catalogue ever stops defining it — this repository has shipped five separate outages whose
     * entire cause was a permission code that the running system enforced and the catalogue had
     * never heard of.
     */
    public static final String HEALTH_VIEW_PERMISSION = "ops.health.view";

    /** What the caller is allowed to do, and if not, why not. */
    public enum Decision {
        ALLOWED,
        /** No usable token — the client should sign in again. */
        UNAUTHENTICATED,
        /** A perfectly good token belonging to someone who may not see this. */
        FORBIDDEN
    }

    private final JwksKeyProvider jwksKeyProvider;

    public OpsTokenAuthorizer(JwksKeyProvider jwksKeyProvider) {
        this.jwksKeyProvider = jwksKeyProvider;
    }

    public Decision authorize(ServerWebExchange exchange) {
        String header = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith("Bearer ")) {
            return Decision.UNAUTHENTICATED;
        }
        JwtClaims claims;
        try {
            claims = verify(header.substring(7));
        } catch (Exception e) {
            return Decision.UNAUTHENTICATED;
        }
        List<String> permissions = claims.permissions();
        return permissions != null && permissions.contains(HEALTH_VIEW_PERMISSION)
                ? Decision.ALLOWED
                : Decision.FORBIDDEN;
    }

    /** Verifies the RS256 signature and the expiry, then reads the claims this gate needs. */
    private JwtClaims verify(String token) throws Exception {
        SignedJWT jwt = SignedJWT.parse(token);
        String kid = jwt.getHeader().getKeyID();
        if (kid == null) {
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
        @SuppressWarnings("unchecked")
        List<String> permissions = jwt.getJWTClaimsSet().getClaims().get("permissions") instanceof List<?> p
                ? (List<String>) p : List.of();
        return new JwtClaims(null, null, null, List.of(), permissions, java.util.Map.of(), null);
    }
}
