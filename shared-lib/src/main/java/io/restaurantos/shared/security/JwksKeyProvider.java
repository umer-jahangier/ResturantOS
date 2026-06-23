package io.restaurantos.shared.security;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import org.springframework.web.client.RestClient;

import java.security.PublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fetches the JWKS once at startup and refreshes every 3600s. Keyed by 'kid'.
 * Uses nimbus-jose-jwt JWKSet.parse() to parse JSON → PublicKey (RSA).
 * Loaded from JwtProperties (base64 PEM → JWKS URL at startup).
 */
public class JwksKeyProvider {

    private final String jwksUrl;
    private final RestClient restClient;
    private final Map<String, PublicKey> cache = new ConcurrentHashMap<>();
    private volatile Instant lastFetch = Instant.EPOCH;
    private static final Duration TTL = Duration.ofSeconds(3600);

    public JwksKeyProvider(String jwksUrl, RestClient restClient) {
        this.jwksUrl = jwksUrl;
        this.restClient = restClient;
    }

    /** Constructor for test harness: pre-seed a known public key with a given kid. */
    public JwksKeyProvider(String kid, PublicKey key) {
        this.jwksUrl = null;
        this.restClient = null;
        this.cache.put(kid, key);
        this.lastFetch = Instant.MAX;
    }

    public PublicKey getKey(String kid) {
        if (jwksUrl != null && (Instant.now().isAfter(lastFetch.plus(TTL)) || !cache.containsKey(kid))) {
            refresh();
        }
        PublicKey key = cache.get(kid);
        if (key == null) throw new IllegalStateException("Unknown JWT kid: " + kid);
        return key;
    }

    private synchronized void refresh() {
        if (jwksUrl == null || restClient == null) return; // pre-seeded test mode
        if (!Instant.now().isAfter(lastFetch.plus(TTL)) && !cache.isEmpty()) return;
        try {
            String jwksJson = restClient.get().uri(jwksUrl).retrieve().body(String.class);
            JWKSet jwkSet = JWKSet.parse(jwksJson);
            jwkSet.getKeys().forEach(jwk -> {
                try {
                    if (jwk instanceof RSAKey rsaKey) {
                        cache.put(jwk.getKeyID(), rsaKey.toPublicKey());
                    }
                } catch (Exception ignored) {}
            });
            lastFetch = Instant.now();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to fetch JWKS from " + jwksUrl, e);
        }
    }
}
