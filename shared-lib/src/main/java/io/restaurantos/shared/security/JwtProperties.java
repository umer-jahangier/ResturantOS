package io.restaurantos.shared.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Bound to restaurantos.jwt.* in application config.
 * The base64-encoded PEM for the RSA public key is produced by generate-keys.sh (01-03).
 */
@ConfigurationProperties(prefix = "restaurantos.jwt")
public class JwtProperties {
    private String jwksUrl;
    private long jwksCacheTtlSeconds = 3600;
    /** Base64-encoded RSA public key PEM (optional; used for local/test mode without JWKS endpoint). */
    private String publicKeyBase64;

    public String getJwksUrl() { return jwksUrl; }
    public void setJwksUrl(String jwksUrl) { this.jwksUrl = jwksUrl; }
    public long getJwksCacheTtlSeconds() { return jwksCacheTtlSeconds; }
    public void setJwksCacheTtlSeconds(long jwksCacheTtlSeconds) { this.jwksCacheTtlSeconds = jwksCacheTtlSeconds; }
    public String getPublicKeyBase64() { return publicKeyBase64; }
    public void setPublicKeyBase64(String publicKeyBase64) { this.publicKeyBase64 = publicKeyBase64; }
}
