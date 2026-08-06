package io.restaurantos.auth.service;

import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.stereotype.Service;

import java.security.interfaces.RSAPrivateKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

@Service
public class JwtSigningService {

    /** Value of the {@code token_type} claim on a control-plane (tenant-less) token. */
    public static final String PLATFORM_TOKEN_TYPE = "platform";

    private final RSAPrivateKey privateKey;
    private final AuthJwtProperties jwtProperties;

    public JwtSigningService(RSAPrivateKey privateKey, AuthJwtProperties jwtProperties) {
        this.privateKey = privateKey;
        this.jwtProperties = jwtProperties;
    }

    public String signAccessToken(JwtClaims claims) {
        Instant now = Instant.now();
        Instant expiry = now.plusSeconds(jwtProperties.getAccessTtlSeconds());
        return Jwts.builder()
            .header().keyId(jwtProperties.getPublicKeyId()).and()
            .id(UUID.randomUUID().toString())
            .subject(claims.subject().toString())
            .claim("tenant_id", claims.tenantId().toString())
            .claim("branch_id", claims.branchId().toString())
            .claim("roles", claims.roles())
            .claim("permissions", claims.permissions())
            .claim("attributes", claims.attributes())
            // Step-up marker. True ONLY when this login verified a TOTP code
            // (AuthServiceImpl.enforceTotpStepUp). Downstream money-moving endpoints — payroll
            // approval, accounting-period close — read this via the gateway-injected
            // X-TOTP-Verified header, so it must never be settable by the caller.
            .claim("totp_verified", claims.totpVerified())
            .issuedAt(Date.from(now))
            .expiration(Date.from(expiry))
            .signWith(privateKey, Jwts.SIG.RS256)
            .compact();
    }

    /**
     * Mints a short-lived service JWT for server-initiated internal calls (Doc 4 §4.1).
     * Subject is the service name; roles contain INTERNAL_SERVICE.
     * Used by platform-admin provisioning saga when calling auth/user/finance without a user JWT.
     */
    public String signServiceToken(String service, Duration ttl) {
        Instant now = Instant.now();
        Instant expiry = now.plus(ttl);
        return Jwts.builder()
            .header().keyId(jwtProperties.getPublicKeyId()).and()
            .id(UUID.randomUUID().toString())
            .subject(service)
            .claim("roles", List.of("INTERNAL_SERVICE"))
            .issuedAt(Date.from(now))
            .expiration(Date.from(expiry))
            .signWith(privateKey, Jwts.SIG.RS256)
            .compact();
    }

    /**
     * Mints a platform (control-plane) access token: an identity with NO tenant (PLATFORM-01).
     *
     * <p>Why this cannot reuse {@link #signAccessToken}: that method dereferences
     * {@code claims.tenantId()} and {@code claims.branchId()} unguarded, and a platform user is by
     * definition tenant-less — it lives in {@code platform_db.platform_users}, not in any tenant's
     * {@code users} table. Attempting to mint a SuperAdmin token through the tenant signer NPEs.
     * That is one of the three independent causes of audit blocker B1.
     *
     * <p>The tenant and branch claims are OMITTED rather than emitted as nulls. Both readers of
     * those keys ({@code JwtGlobalFilter.parseUuid}, {@code JwtAuthenticationFilter}) treat an
     * absent key as "no tenant"; a null-valued key would be a second state meaning the same thing,
     * which every future reader would have to keep getting right.
     *
     * <p>{@code roles} and {@code permissions} both carry the role. The roles claim is the correct
     * home for it and — since the authority union landed in {@code JwtAuthenticationFilter} —
     * sufficient on its own to satisfy {@code hasAuthority('SUPER_ADMIN')}. It is repeated in
     * permissions so a platform token also works against any service still running an older
     * shared-lib, and because no dotted permission code may be invented here: PermissionCatalogClosureTest
     * scans {@code @PreAuthorize} expressions and would demand a tenant-RBAC catalog row for one.
     *
     * @param platformUserId {@code platform_users.id} — the subject
     * @param platformRole   one of SUPER_ADMIN / SUPPORT / BILLING; validated by the caller
     *                       ({@link PlatformTokenService}), never here
     */
    public String signPlatformToken(UUID platformUserId, String platformRole, Duration ttl) {
        Instant now = Instant.now();
        Instant expiry = now.plus(ttl);
        return Jwts.builder()
            .header().keyId(jwtProperties.getPublicKeyId()).and()
            .id(UUID.randomUUID().toString())
            .subject(platformUserId.toString())
            .claim("roles", List.of(platformRole))
            .claim("permissions", List.of(platformRole))
            // Marks the token's audience as the control plane rather than a tenant. Consumers may
            // use it to refuse a platform token on a tenant-scoped surface; nothing may use it to
            // GRANT anything, which is what roles/permissions are for.
            .claim("token_type", PLATFORM_TOKEN_TYPE)
            // Explicit and false: platform_users has no TOTP column yet (a known gap recorded in
            // 13-CONTEXT), so no platform login can have stepped up. Stated rather than omitted so
            // the fail-closed default is a decision on the record, not an accident of absence.
            .claim("totp_verified", false)
            .issuedAt(Date.from(now))
            .expiration(Date.from(expiry))
            .signWith(privateKey, Jwts.SIG.RS256)
            .compact();
    }

    /**
     * Mints an impersonation JWT for a SuperAdmin session (PLATFORM-05).
     * The token carries all target-user claims plus the `impersonated_by` claim (SuperAdmin id).
     * TTL is set at issuance and is NOT refreshable (RESEARCH Pitfall 7 — 30-min hard expiry).
     */
    public String signImpersonationToken(JwtClaims targetClaims, UUID impersonatedBy, Duration ttl) {
        Instant now = Instant.now();
        Instant expiry = now.plus(ttl);
        return Jwts.builder()
            .header().keyId(jwtProperties.getPublicKeyId()).and()
            .id(UUID.randomUUID().toString())
            .subject(targetClaims.subject().toString())
            .claim("tenant_id", targetClaims.tenantId().toString())
            .claim("branch_id", targetClaims.branchId() != null ? targetClaims.branchId().toString() : null)
            .claim("roles", targetClaims.roles())
            .claim("permissions", targetClaims.permissions())
            .claim("attributes", targetClaims.attributes())
            // Never inherited from the impersonated user: the SuperAdmin driving this session did
            // not present the target's second factor, so an impersonation token can carry every
            // permission the target has and still not approve payroll or close a period.
            .claim("totp_verified", false)
            .claim("impersonated_by", impersonatedBy.toString())
            .issuedAt(Date.from(now))
            .expiration(Date.from(expiry))
            .signWith(privateKey, Jwts.SIG.RS256)
            .compact();
    }
}
