package io.restaurantos.shared.security;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import org.springframework.web.client.RestClient;

import java.security.PublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

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

    /** Guards the fetch. Deliberately NOT the object monitor — see {@link #refresh()}. */
    private final ReentrantLock refreshLock = new ReentrantLock();

    /**
     * The longest a request thread will wait for another thread's in-flight refresh.
     *
     * <p>Bounded on purpose: an unbounded wait is how one slow JWKS endpoint took an entire
     * service down while its health check stayed green.
     */
    private static final Duration REFRESH_TIMEOUT = Duration.ofSeconds(2);

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

    /**
     * Refreshes the key cache, holding NO lock across the network call.
     *
     * <h2>Why this is not {@code synchronized}</h2>
     *
     * It used to be. A {@code synchronized} method performing a blocking HTTP call is a
     * process-wide stop: the first thread in takes the monitor and parks on the socket, and every
     * subsequent request that needs to validate a JWT queues behind it. If the JWKS endpoint never
     * answers, the queue never drains.
     *
     * <p>That is the defect behind the service wedge seen repeatedly during phase 13 on
     * auth-service, user-service, finance-service and pos-service: {@code /actuator/health} kept
     * answering in single-digit milliseconds while EVERY other path — including paths that do not
     * exist — hung forever, with a fresh Tomcat thread parking per request at ~0.04ms CPU. Health
     * does not validate a JWT, so it never touched this monitor. Nothing else could avoid it.
     *
     * <p>It also explains why the wedge spread between services: auth-service serves the JWKS
     * document, so once IT stalled, every other service's next refresh stalled too. A liveness
     * probe on {@code /actuator/health} would never have restarted any of them.
     *
     * <h2>The three properties that replace the monitor</h2>
     *
     * <ol>
     *   <li><b>The fetch happens outside any lock.</b> A slow endpoint can no longer block a thread
     *       that is not itself fetching.</li>
     *   <li><b>Exactly one thread fetches at a time</b>, via {@code tryLock} — no thundering herd on
     *       a cold cache. A thread that cannot take the lock does not queue: it returns and uses
     *       whatever the cache already holds. A stale-but-valid key is enormously better than a
     *       hung request thread.</li>
     *   <li><b>The wait is bounded.</b> Even the fetching thread gives up at
     *       {@link #REFRESH_TIMEOUT}, so a hung endpoint costs one request, not the process.</li>
     * </ol>
     *
     * <p><b>The injected {@link RestClient} must still carry its own connect and read timeouts.</b>
     * This method bounds how long the CALLER waits, not how long the socket is held open; without a
     * client timeout the fetching thread leaks. That is enforced at the construction sites and
     * asserted by {@code JwksKeyProviderTimeoutTest}.
     */
    private void refresh() {
        if (jwksUrl == null || restClient == null) return; // pre-seeded test mode
        if (!Instant.now().isAfter(lastFetch.plus(TTL)) && !cache.isEmpty()) return;

        boolean acquired;
        try {
            acquired = refreshLock.tryLock(REFRESH_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return; // serve from cache; never park a request thread on an interrupt
        }
        if (!acquired) {
            // Another thread is already refreshing. Do not queue behind it — that is precisely the
            // pile-up this method exists to prevent. getKey() will fail cleanly if the kid is
            // genuinely absent from the cache.
            return;
        }
        try {
            // Re-check: the holder may have refreshed while we waited for the lock.
            if (!Instant.now().isAfter(lastFetch.plus(TTL)) && !cache.isEmpty()) return;

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
            // Deliberately NOT rethrown when a usable cache exists. Throwing here turned a
            // transient JWKS blip into a total authentication outage, even for keys already held.
            if (cache.isEmpty()) {
                throw new IllegalStateException("Failed to fetch JWKS from " + jwksUrl, e);
            }
        } finally {
            refreshLock.unlock();
        }
    }
}
