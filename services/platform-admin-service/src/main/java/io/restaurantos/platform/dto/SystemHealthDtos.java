package io.restaurantos.platform.dto;

import java.time.Instant;
import java.util.List;

/**
 * The platform status surface.
 *
 * <h2>The one rule</h2>
 *
 * <p><b>Anything this service cannot truthfully determine renders as {@link HealthState#UNKNOWN},
 * never as green.</b> A status page's whole job is to be believed during an incident, and the
 * fastest way to lose that is one tile that shows UP because nobody checked. So there is no
 * default-healthy path anywhere in this contract: a probe that times out is
 * {@link HealthState#UNREACHABLE}, a registry that cannot be consulted is
 * {@link HealthState#UNKNOWN}, and a metric nobody collects is stated as uncollected rather than
 * omitted.
 *
 * <h2>Why UNREACHABLE is separate from DOWN</h2>
 *
 * <p>DOWN means the process answered and said it was unhealthy — a real, self-reported fact.
 * UNREACHABLE means nothing answered, which is consistent with the process being dead AND with a
 * network partition, a wrong registry entry, or this service being the one that is isolated.
 * Collapsing them loses the difference between "that service is broken" and "I cannot see that
 * service", and those call for different actions at 3am.
 */
public final class SystemHealthDtos {

    private SystemHealthDtos() {}

    /**
     * @see SystemHealthDtos for why UNREACHABLE and UNKNOWN are not the same state, and why neither
     *      is ever rendered as healthy.
     */
    public enum HealthState {
        /** Answered, and said it was healthy. */
        UP,
        /** Answered, and said it was not. */
        DOWN,
        /** Nothing answered within the probe timeout. Not proof of death, and not proof of health. */
        UNREACHABLE,
        /** Not determinable at all — nothing to probe, or the means of probing is unavailable. */
        UNKNOWN
    }

    /**
     * One instance of one service.
     *
     * @param uri            the actuator URI actually probed, so an operator can repeat the check by
     *                       hand. A status page that will not say what it asked is one you cannot
     *                       argue with.
     * @param responseTimeMs null when nothing answered.
     */
    public record InstanceHealth(
            String instanceId,
            String uri,
            HealthState state,
            String detail,
            Long responseTimeMs
    ) {}

    /**
     * One service, aggregated over its registered instances.
     *
     * @param state UP only when at least one instance answered UP and none answered DOWN;
     *              DOWN when any instance self-reported DOWN; UNREACHABLE when instances are
     *              registered and none answered; UNKNOWN when none are registered — a registration
     *              is not evidence a process answers, and its absence is not evidence of death
     *              either.
     */
    public record ServiceHealth(
            String serviceId,
            HealthState state,
            int instancesRegistered,
            int instancesUp,
            int instancesDown,
            int instancesUnreachable,
            List<InstanceHealth> instances,
            String detail
    ) {}

    /**
     * A non-service dependency — the platform database, the cache, the broker.
     *
     * @param kind DATABASE, CACHE, BROKER, REGISTRY. Grouping is the console's, not this service's.
     */
    public record ComponentHealth(
            String name,
            String kind,
            HealthState state,
            String detail
    ) {}

    /**
     * A migration or schema precondition that can take a deployment down.
     *
     * @param basis how the state was established. Load-bearing: the ClickHouse fact tables are
     *              INFERRED from reporting-service booting rather than observed directly, because
     *              this service holds no ClickHouse driver. A tile that shows a green tick without
     *              saying that has claimed a measurement it did not make.
     */
    public record MigrationState(
            String name,
            HealthState state,
            String basis,
            String detail
    ) {}

    /**
     * A metric an operator would reasonably expect on a status page and which this platform does
     * not collect anywhere.
     *
     * <p>Present in the payload deliberately. An omitted tile reads as an oversight and invites the
     * next author to add it with fabricated data; a tile that says "queue depth is not collected —
     * no RabbitMQ management client exists in any service" is a status page telling the truth about
     * its own limits. A DLQ chart that is not actually reading a DLQ is worse than no chart.
     */
    public record UncollectedMetric(String name, String reason) {}

    /**
     * @param overall UP only when every determinable component is UP and nothing is UNKNOWN. Any
     *                DOWN or UNREACHABLE makes it DOWN; anything indeterminate makes it UNKNOWN.
     *                There is no arithmetic here that can produce green out of ignorance.
     */
    public record SystemHealthResponse(
            Instant checkedAt,
            HealthState overall,
            ComponentHealth registry,
            List<ServiceHealth> services,
            List<ComponentHealth> infrastructure,
            List<MigrationState> migrations,
            List<UncollectedMetric> notCollected
    ) {}
}
