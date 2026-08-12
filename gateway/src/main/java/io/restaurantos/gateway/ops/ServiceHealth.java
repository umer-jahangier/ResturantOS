package io.restaurantos.gateway.ops;

import java.time.Instant;
import java.util.List;

/**
 * One upstream service, as the operator health screen sees it.
 *
 * @param name            the discovery name the gateway routes to, e.g. {@code pos-service}
 * @param paths           the gateway path prefixes this service serves, e.g. {@code /api/v1/pos/**}.
 *                        Read straight off the route table so the screen cannot claim a service
 *                        carries traffic it does not.
 * @param state           {@link FleetState}
 * @param detail          one short sentence naming what the probe actually observed. Never a stack
 *                        trace and never a bare status line — this is read by a restaurant manager
 *                        at 8pm, not by whoever wrote the service.
 * @param lastReachableAt the last moment this gateway got a healthy answer out of the service, or
 *                        {@code null} if it has not answered once since this gateway started. Null
 *                        is rendered as exactly that, never as "never" — the gateway genuinely does
 *                        not know what happened before it booted, and saying otherwise is the kind
 *                        of confident wrong answer this whole screen exists to stop.
 * @param instanceCount   how many instances discovery is currently advertising
 */
public record ServiceHealth(
        String name,
        List<String> paths,
        FleetState state,
        String detail,
        Instant lastReachableAt,
        int instanceCount) {

    public enum FleetState {
        /** Answered {@code /actuator/health} inside the probe budget with an aggregate status of UP. */
        UP,
        /** Answered, but did not say UP — it is running and reporting a problem of its own. */
        DEGRADED,
        /** Did not answer inside the probe budget, refused the connection, or is not registered. */
        DOWN
    }
}
