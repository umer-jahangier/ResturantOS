package io.restaurantos.shared.authz;

import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Instant;

/**
 * Shared authorization helper (Doc 9 §9.4). Reads validated JWT claims from the
 * security context, evaluates OPA, and throws {@link PermissionDeniedException} on deny.
 * Not a Spring bean — each service exposes it via its own {@code @Configuration}.
 */
public class AuthorizationService {

    private final OpaClient opaClient;

    public AuthorizationService(OpaClient opaClient) {
        this.opaClient = opaClient;
    }

    public void authorize(String module, String action, OpaInput.Resource resource) {
        JwtClaims claims = (JwtClaims) SecurityContextHolder.getContext()
            .getAuthentication()
            .getPrincipal();
        OpaInput input = OpaInput.builder()
            .user(new OpaInput.User(
                claims.subject(),
                claims.tenantId(),
                claims.branchId(),
                claims.permissions(),
                claims.attributes()))
            .resource(resource)
            .action(action)
            .environment(new OpaInput.Environment(Instant.now(), null))
            .build();
        if (!opaClient.evaluate(module, input).allow()) {
            throw new PermissionDeniedException("Not permitted: " + module + "." + action);
        }
    }
}
