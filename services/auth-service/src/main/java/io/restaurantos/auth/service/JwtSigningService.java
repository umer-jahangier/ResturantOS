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
            .claim("impersonated_by", impersonatedBy.toString())
            .issuedAt(Date.from(now))
            .expiration(Date.from(expiry))
            .signWith(privateKey, Jwts.SIG.RS256)
            .compact();
    }
}
