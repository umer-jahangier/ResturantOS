package io.restaurantos.auth.service;

import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.config.AuthJwtProperties;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.stereotype.Service;

import java.security.interfaces.RSAPrivateKey;
import java.time.Instant;
import java.util.Date;

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
}
