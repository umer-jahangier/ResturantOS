package io.restaurantos.auth.service;

import io.restaurantos.auth.exception.InvalidPlatformRoleException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

/**
 * Mints control-plane access tokens for platform users (PLATFORM-01).
 *
 * <h3>Why this service authenticates nothing</h3>
 * <p>It does not read {@code platform_db}, does not load a {@code platform_users} row, and does not
 * verify a password. It signs what platform-admin-service asserts over the internal channel.
 *
 * <p>That split is deliberate and is PLATFORM-07: <b>only platform-admin-service connects to
 * platform_db.</b> Giving auth-service a second datasource onto the control plane to save one
 * internal hop would put the platform user table behind two services' migrations, two connection
 * pools and two sets of RLS assumptions. Instead the trust boundary is a single shared secret on
 * {@code /internal/auth/**}, gated by {@code InternalServiceFilter}'s constant-time check, and the
 * RSA private key stays in the one service that already holds it.
 *
 * <p>The consequence to keep in view: anyone who can present the internal secret can mint a
 * SUPER_ADMIN token. That is the same authority the secret already confers through
 * {@code /internal/auth/service-token} and {@code /internal/auth/users/{id}/impersonate}, so this
 * endpoint widens no boundary — but it does mean the secret must never be reachable from the public
 * gateway, which is why no route maps {@code /internal/auth/**}.
 */
@Service
public class PlatformTokenService {

    /**
     * The only roles a platform user can hold — the three values permitted by
     * {@code chk_platform_users_role} (010-create-platform-tables.xml:108-109). Validated here so
     * a role that could not exist in the database also cannot exist in a signed token.
     */
    static final Set<String> ALLOWED_PLATFORM_ROLES = Set.of("SUPER_ADMIN", "SUPPORT", "BILLING");

    private final JwtSigningService jwtSigningService;
    private final long ttlSeconds;

    public PlatformTokenService(
            JwtSigningService jwtSigningService,
            @Value("${restaurantos.auth.platform-token-ttl-seconds:900}") long ttlSeconds) {
        this.jwtSigningService = jwtSigningService;
        this.ttlSeconds = ttlSeconds;
    }

    /**
     * @return a signed, tenant-less platform token and the seconds until it expires
     * @throws InvalidPlatformRoleException if {@code platformRole} is not one of the three
     *         permitted values — thrown BEFORE the signer is called, so an unknown role never
     *         produces bytes that look like a credential
     */
    public PlatformTokenResult mint(UUID platformUserId, String platformRole) {
        if (platformUserId == null) {
            throw new IllegalArgumentException("platformUserId is required");
        }
        if (platformRole == null || !ALLOWED_PLATFORM_ROLES.contains(platformRole)) {
            throw new InvalidPlatformRoleException(platformRole);
        }
        String token = jwtSigningService.signPlatformToken(
                platformUserId, platformRole, Duration.ofSeconds(ttlSeconds));
        return new PlatformTokenResult(token, ttlSeconds, JwtSigningService.PLATFORM_TOKEN_TYPE);
    }

    public record PlatformTokenResult(String token, long expiresIn, String tokenType) {}
}
