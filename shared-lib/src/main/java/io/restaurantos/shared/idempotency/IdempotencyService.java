package io.restaurantos.shared.idempotency;

import java.util.Optional;

public interface IdempotencyService {
    /**
     * Atomically claim the key. Returns true if this caller won the claim (proceed),
     * false if the key already exists and is in-flight or completed.
     * @throws io.restaurantos.shared.exception.IdempotencyConflictException
     *         if the same key was used with a DIFFERENT request body hash.
     */
    boolean checkAndLock(String key, String requestHash, int ttlSeconds);
    void markComplete(String key, String responseJson);
    Optional<String> getCompletedResponse(String key);
}
