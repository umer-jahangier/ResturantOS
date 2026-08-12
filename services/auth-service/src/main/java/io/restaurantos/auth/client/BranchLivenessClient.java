package io.restaurantos.auth.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * Asks user-service whether a branch is somewhere a human may still be sent to work.
 *
 * <h3>Why auth-service calls out at all</h3>
 *
 * <p>{@code branches} lives in {@code user_db} and auth-service does not connect to it — it has no
 * {@code BranchEntity} and no branch repository. What it does have is {@code user_branch_roles},
 * and for the whole life of {@code BranchSwitchService} that was mistaken for the same question.
 * It is not: {@code user_branch_roles.is_active} is <b>the ROLE row</b> being live, and deactivating
 * a branch through {@code PUT /api/v1/branches/{id}} sets {@code branches.is_active = false} and
 * touches no role row at all. So every assignment to a retired branch stayed active, and
 * {@code POST /api/v1/auth/switch-branch} minted a token for it on demand.
 *
 * <p>Measured against the live stack on 2026-08-12, before this class existed: create a branch,
 * deactivate it, then switch into it from an HQ token → <b>HTTP 200</b>, and the returned JWT
 * carried the dead branch's {@code branch_id}. The Branches screen's own deactivate dialog promises
 * the opposite in as many words — "nobody can take an order or start a till there".
 *
 * <h3>Fail CLOSED, unlike {@link PlatformCredentialClient}</h3>
 *
 * <p>That client turns an outage into "no match" because a tenant cashier's login has nothing to do
 * with the control plane, and failing the other way would convert one service's incident into a
 * total one. The trade here runs the other way and costs almost nothing:
 *
 * <ul>
 *   <li>The only thing this gates is <b>changing</b> branch. A caller who cannot switch keeps the
 *       branch they are already on, keeps their token, and keeps working. Nobody is logged out and
 *       no existing session degrades.</li>
 *   <li>The list of branches the switcher offers is {@code GET /api/v1/branches/mine} — also
 *       user-service. When this call cannot be made, the SPA has no list to choose from either, so
 *       failing closed removes a choice the user could not have made.</li>
 *   <li>Failing open would mean an outage silently restores exactly the defect this class exists to
 *       close, which is how a control becomes present-but-inert.</li>
 * </ul>
 *
 * <p>So {@link #isLiveAndActive} returns {@code false} for "unreachable", "timed out", "5xx",
 * "403 from a rotated secret" and "malformed body" alike, and logs each at WARN naming the branch.
 * The one case it does <b>not</b> conflate is 404, which user-service returns for a soft-deleted
 * branch — that is a real answer meaning "no such live branch", and it is the same {@code false}.
 */
@Component
public class BranchLivenessClient {

    private static final Logger log = LoggerFactory.getLogger(BranchLivenessClient.class);

    /** Matches {@code UserInternalServiceFilter.HEADER} in user-service. */
    private static final String INTERNAL_HEADER = "X-Internal-Service";

    /**
     * {@code /internal/users/**} carries no JWT, so nothing populates the RLS GUC on the far side
     * from a token. {@code branches} is FORCE ROW LEVEL SECURITY on {@code app.current_tenant_id};
     * without this header the lookup matches zero rows — which user-service renders as 404 and this
     * class would read as "deactivated". Every switch would then be refused. It is required, and it
     * is checked before the call is made.
     */
    private static final String TENANT_HEADER = "X-Tenant-Id";

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
    private static final Duration CALL_TIMEOUT = Duration.ofSeconds(3);

    private final RestClient restClient;
    private final String internalSecret;

    /**
     * <b>Builds its own {@link RestClient}</b>, the same way {@link PlatformCredentialClient} does
     * and for the same recorded reason: auth-service has no {@code RestClient.Builder} bean, and
     * autowiring one made the whole application context fail to start.
     *
     * @param baseUri user-service's origin. A direct origin, not {@code lb://user-service} —
     *                auth-service has no {@code @LoadBalanced} builder, exactly as documented for
     *                the platform-admin URI beside it in {@code application.yml}.
     */
    public BranchLivenessClient(
            @Value("${restaurantos.user-service.uri:http://localhost:8082}") String baseUri,
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String internalSecret) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT);
        factory.setReadTimeout(CALL_TIMEOUT);
        this.restClient = RestClient.builder()
            .baseUrl(baseUri.replaceAll("/+$", ""))
            .requestFactory(factory)
            .build();
        this.internalSecret = internalSecret;
    }

    /**
     * @return {@code true} only when user-service returns a branch row that is present, not
     *         soft-deleted and {@code is_active}. Every other outcome — including an outage — is
     *         {@code false}. Never throws.
     */
    public boolean isLiveAndActive(UUID tenantId, UUID branchId) {
        if (tenantId == null || branchId == null) {
            log.warn("Branch liveness asked with tenantId={} branchId={}; refusing", tenantId, branchId);
            return false;
        }
        try {
            Map<?, ?> branch = restClient.get()
                .uri("/internal/users/branches/{branchId}", branchId)
                .header(INTERNAL_HEADER, internalSecret)
                .header(TENANT_HEADER, tenantId.toString())
                .retrieve()
                .body(Map.class);

            if (branch == null) {
                log.warn("Branch liveness for {} returned an empty body; refusing", branchId);
                return false;
            }
            // BranchInternalController serialises BranchEntity itself, so these are Jackson's names
            // for the Lombok getters isActive()/isDeleted() — "active" and "deleted", NOT the field
            // spellings. Verified against the running service rather than inferred:
            //   GET /internal/users/branches/{id} -> {"active": false, "deleted": false, ...}
            // A missing "active" key is treated as absent authority, not as true.
            boolean active = Boolean.TRUE.equals(branch.get("active"));
            boolean deleted = Boolean.TRUE.equals(branch.get("deleted")) || branch.get("deletedAt") != null;
            if (!active || deleted) {
                log.info("Branch {} is not a live active branch (active={}, deleted={})",
                    branchId, active, deleted);
                return false;
            }
            return true;
        } catch (RuntimeException e) {
            // Deliberately broad, and deliberately false. See the class javadoc: a switch that
            // cannot be verified is a switch that does not happen.
            log.warn("Branch liveness check for {} failed ({}); refusing the switch", branchId, e.toString());
            return false;
        }
    }
}
