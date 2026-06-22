package io.restaurantos.shared.idempotency;

import io.restaurantos.shared.exception.IdempotencyConflictException;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
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
    public boolean checkAndLock(String key, String requestHash, int ttlSeconds) {
        Optional<IdempotencyKey> existing = repository.findById(key);
        if (existing.isPresent()) {
            IdempotencyKey ik = existing.get();
            if (!ik.getRequestHash().equals(requestHash)) {
                throw new IdempotencyConflictException(
                    "Idempotency key '" + key + "' was already used with a different request");
            }
            // Same key + same hash: already in-flight or completed
            return false;
        }
        IdempotencyKey ik = new IdempotencyKey();
        ik.setKey(key);
        ik.setRequestHash(requestHash);
        ik.setStatus("IN_PROGRESS");
        ik.setCreatedAt(Instant.now());
        ik.setExpiresAt(Instant.now().plusSeconds(ttlSeconds));
        repository.save(ik);
        return true;
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
