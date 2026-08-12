package io.restaurantos.shared.idempotency;

import java.util.Optional;

public interface IdempotencyService {
    /**
     * Atomically claim the key. Returns true if this caller won the claim (proceed),
     * false if the key already exists and is in-flight or completed.
     *
     * @param requestPayload RAW request material identifying this request — a reason string,
     *        an order id, a concatenation of the fields that make the request what it is.
     *        Pass it verbatim and unbounded; the implementation digests it before storage, so
     *        callers must NOT pre-hash and must not truncate to fit the column.
     * @throws io.restaurantos.shared.exception.IdempotencyConflictException
     *         if the same key was used with a DIFFERENT request payload.
     */
    boolean checkAndLock(String key, String requestPayload, int ttlSeconds);
    void markComplete(String key, String responseJson);
    Optional<String> getCompletedResponse(String key);
}
