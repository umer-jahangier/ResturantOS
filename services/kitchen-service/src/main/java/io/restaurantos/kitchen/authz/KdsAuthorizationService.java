package io.restaurantos.kitchen.authz;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.security.JwtClaims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * KDS-specific OPA authorization wrapper. Fail-closed: any exception → deny.
 * Evaluates the "kds" OPA module with the appropriate action and resource.
 */
@Service
public class KdsAuthorizationService {

    private static final Logger log = LoggerFactory.getLogger(KdsAuthorizationService.class);

    /**
     * The token attribute carrying a caller's station assignment (28-01, D-28-02).
     *
     * <p>Written by auth-service's {@code PermissionResolver.STATION_SCOPE_CLAIM} and read here
     * straight off the verified token by shared-lib's {@code JwtAuthenticationFilter} — no
     * cross-service call, no projection table, no consumer that can silently drop a message.
     *
     * <p>The spelling is the contract between two services. It is a constant on both sides so a
     * rename cannot leave them disagreeing, which would not throw — it would silently un-scope
     * every cook in the product.
     */
    private static final String STATION_SCOPE_CLAIM = "stations";

    private final AuthorizationService authorizationService;

    public KdsAuthorizationService(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    public void authorizeView(UUID tenantId, UUID branchId) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "kds_board", null, tenantId, branchId, null, null, null);
        authorizationService.authorize("kds", "pos.kds.view", resource);
    }

    public void authorizeUpdate(UUID tenantId, UUID branchId) {
        OpaInput.Resource resource = new OpaInput.Resource(
                "kds_ticket", null, tenantId, branchId, null, null, null);
        authorizationService.authorize("kds", "pos.kds.update", resource);
    }

    /**
     * What stations the CURRENT caller may look at (D-28-02).
     *
     * <p>Read from the signature-verified token's {@code attributes} map and from nowhere else.
     * Never from a query parameter, a header or a request body — a view scope a client can assert
     * is not a view scope, it is a suggestion.
     *
     * <p><b>Call this AFTER {@link #authorizeView}, never instead of it.</b> Identity is established
     * first and scope is applied second. A scope check that ran first would be deciding what a
     * caller may see before establishing who the caller is, which is the wrong order even when it
     * produces the right answer.
     *
     * <p>Every degenerate input degrades to unrestricted — see {@link StationScope} for why that is
     * deliberately the opposite of this codebase's usual fail-closed posture.
     */
    public StationScope resolveStationScope() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof JwtClaims claims)) {
            // No principal at all. Unrestricted, because this method is only ever reached after
            // authorizeView has already established the caller — so a missing principal here is a
            // filter-chain fault, not an anonymous request, and blacking out the board is not the
            // right way to report a misconfiguration.
            return StationScope.unrestricted();
        }
        Map<String, Object> attributes = claims.attributes();
        if (attributes == null || !attributes.containsKey(STATION_SCOPE_CLAIM)) {
            // The overwhelmingly common case: no assignment, sees everything. This is the state
            // every user in the product is in today and it must stay the do-nothing default.
            return StationScope.unrestricted();
        }
        Object raw = attributes.get(STATION_SCOPE_CLAIM);
        if (!(raw instanceof Collection<?> collection)) {
            log.warn("KDS station scope attribute '{}' is a {} rather than a list — treating the "
                    + "caller as unrestricted. The board keeps working; the token is wrong.",
                STATION_SCOPE_CLAIM, raw == null ? "null" : raw.getClass().getSimpleName());
            return StationScope.unrestricted();
        }
        List<String> codes = new ArrayList<>();
        for (Object entry : collection) {
            if (entry instanceof String code) {
                codes.add(code);
            } else if (entry != null) {
                log.warn("KDS station scope attribute contains a non-string entry ({}) — ignoring it",
                    entry.getClass().getSimpleName());
            }
        }
        // An empty result here means the attribute was present but said nothing usable. Still
        // unrestricted: an empty allow-list has no legitimate meaning, and reading one as
        // "permitted: nothing" is what turns a malformed token into a blacked-out kitchen.
        return StationScope.restrictedTo(codes);
    }
}
