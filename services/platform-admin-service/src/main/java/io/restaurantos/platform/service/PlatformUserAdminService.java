package io.restaurantos.platform.service;

import io.restaurantos.platform.client.AuthInternalClient;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Platform-tier administration of a TENANT's users (13-13, D-16). Today that is one operation:
 * resetting a password for a tenant that has locked itself out.
 *
 * <h2>Why the platform tier needs this at all</h2>
 *
 * <p>13-09 (D-31) resolved that self-service forgot-password ships disabled — nothing consumes
 * {@code PASSWORD_RESET_REQUESTED} because {@code notification-service} has no source files — so
 * the only way back into an account is an administrator. When the account in question is the
 * tenant's OWNER, or the tenant's only remaining administrator, there is nobody inside the tenant
 * who can do it: the role ceiling correctly refuses a lesser role resetting a greater one, which is
 * the whole point of it. Without a platform-tier reset a tenant that loses its owner's password
 * loses the tenant.
 *
 * <h2>What that costs, stated rather than glossed</h2>
 *
 * <p><b>A SuperAdmin can take over any account in any tenant</b> (T-13-13-F, disposition:
 * accept). That is a deliberate support capability and it is not compensated by a check — no check
 * would be honest, because the operator legitimately needs it. It is compensated by evidence and by
 * narrowness:
 *
 * <ul>
 *   <li>auth-service emits {@code ADMIN_PASSWORD_RESET} naming the acting platform user, the target,
 *       the tier and a required reason — the durable trail, in the tenant's own outbox;</li>
 *   <li>the acting id comes from the {@code sub} of an RS256-verified control-plane token and is
 *       never read from a body or a header;</li>
 *   <li>the route is behind the class-level {@code SUPER_ADMIN} gate and the gateway's
 *       platform rate limit, and a platform token is short-lived and not refreshable (13-05);</li>
 *   <li>the target's forced-change flag is set, so the operator's temporary password stops working
 *       the moment the tenant's own person uses it.</li>
 * </ul>
 *
 * <p>The tenant is resolved here before delegating, so a well-formed but unknown tenant id is a 404
 * from this service rather than an upstream call that quietly resets nothing.
 */
@Service
public class PlatformUserAdminService {

    private static final Logger log = LoggerFactory.getLogger(PlatformUserAdminService.class);

    /**
     * The tier discriminator auth-service reads to decide whether the role ceiling applies. A
     * constant, asserted by this service; there is no request path that can influence it.
     */
    private static final String PLATFORM_TIER = "PLATFORM";

    private final AuthInternalClient authInternalClient;
    private final TenantRepository tenantRepository;

    public PlatformUserAdminService(AuthInternalClient authInternalClient,
                                    TenantRepository tenantRepository) {
        this.authInternalClient = authInternalClient;
        this.tenantRepository = tenantRepository;
    }

    /**
     * Reset a tenant user's password as a platform operator.
     *
     * @param actingPlatformUserId the {@code platform_users.id} from the verified control-plane
     *                             token — never a body field, never a header
     * @return the one-time temporary password, to be delivered out of band
     */
    public AuthInternalClient.AdminResetData reset(UUID tenantId, UUID targetUserId,
                                                   UUID actingPlatformUserId, String reason) {
        if (!tenantRepository.existsById(tenantId)) {
            throw new ResourceNotFoundException("Tenant not found: " + tenantId);
        }
        // Logged at INFO because a platform operator taking over a tenant account is an event an
        // operator wants to see without querying the outbox. The temporary password is NOT here and
        // must never be: this line and the audit event are the two records of the reset, and
        // neither may carry the credential.
        log.info("[platform-admin] password reset by platform user {} on tenant {} user {} — reason: {}",
            actingPlatformUserId, tenantId, targetUserId, reason);
        return authInternalClient.resetUserPassword(targetUserId, tenantId, actingPlatformUserId,
            new AuthInternalClient.AdminResetRequest(PLATFORM_TIER, reason)).data();
    }
}
