package io.restaurantos.shared.authz;

public interface OpaClient {
    /** Evaluate the named module policy. Non-200/timeout MUST result in deny (caller throws). */
    OpaDecision evaluate(String module, OpaInput input);
}
