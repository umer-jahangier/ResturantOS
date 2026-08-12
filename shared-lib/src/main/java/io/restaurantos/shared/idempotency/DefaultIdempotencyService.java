package io.restaurantos.shared.idempotency;

import io.restaurantos.shared.exception.IdempotencyConflictException;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;

/**
 * JPA-backed idempotency service storing keys in the idempotency_keys table.
 * Default TTL is 86400 seconds (24h) per spec CC.3 (LIB-06).
 */
public class DefaultIdempotencyService implements IdempotencyService {

    private final IdempotencyKeyRepository repository;

    public DefaultIdempotencyService(IdempotencyKeyRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public boolean checkAndLock(String key, String requestPayload, int ttlSeconds) {
        String fingerprint = fingerprint(requestPayload);
        Optional<IdempotencyKey> existing = repository.findById(key);
        if (existing.isPresent()) {
            IdempotencyKey ik = existing.get();
            if (!ik.getRequestHash().equals(fingerprint)) {
                throw new IdempotencyConflictException(
                    "Idempotency key '" + key + "' was already used with a different request");
            }
            // Same key + same payload: already in-flight or completed
            return false;
        }
        IdempotencyKey ik = new IdempotencyKey();
        ik.setKey(key);
        ik.setRequestHash(fingerprint);
        ik.setStatus("IN_PROGRESS");
        ik.setCreatedAt(Instant.now());
        ik.setExpiresAt(Instant.now().plusSeconds(ttlSeconds));
        repository.save(ik);
        return true;
    }

    /**
     * SHA-256 of the caller's request payload, hex-encoded — always exactly 64 characters,
     * which is the width {@code idempotency_keys.request_hash VARCHAR(64)} was sized for.
     *
     * <p>The column and the parameter were both named for a hash, but nothing hashed: whatever
     * the caller passed was stored verbatim. Most callers pass unbounded free text — a void or
     * refund reason is {@code @Size(max = 500)} and comes straight from the operator — so any
     * ordinary explanatory sentence overflowed the column, aborting the INSERT with Postgres
     * {@code 22001} and failing the whole void. Digesting here rather than trusting each caller
     * to do it is what makes the width correct-by-construction for every present and future
     * call site.
     *
     * <p>A digest is also the right shape for the job. The value exists only to detect a key
     * replayed with a materially different request, so it needs equality, not readability —
     * and storing an operator's verbatim note in an infrastructure table was incidental data
     * spread on top of the truncation bug.
     */
    private static String fingerprint(String requestPayload) {
        String payload = requestPayload == null ? "" : requestPayload;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // Every conformant JVM ships SHA-256. Failing loudly beats degrading to a weaker
            // digest, which would change stored fingerprints and break replay matching silently.
            throw new IllegalStateException("SHA-256 unavailable for idempotency fingerprinting", e);
        }
    }

    @Override
    @Transactional
    public void markComplete(String key, String responseJson) {
        repository.findById(key).ifPresent(ik -> {
            ik.setStatus("COMPLETED");
            ik.setResponseJson(responseJson);
            repository.save(ik);
        });
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> getCompletedResponse(String key) {
        return repository.findById(key)
            .filter(ik -> "COMPLETED".equals(ik.getStatus()))
            .map(IdempotencyKey::getResponseJson);
    }
}
