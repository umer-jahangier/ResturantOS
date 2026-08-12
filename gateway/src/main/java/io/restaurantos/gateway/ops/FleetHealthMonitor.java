package io.restaurantos.gateway.ops;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.ReactiveDiscoveryClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Actively probes every routed upstream on a fixed cadence and keeps the last answer.
 *
 * <h3>Why it probes rather than reading discovery's opinion</h3>
 *
 * Eureka is a LEASE registry, not a health monitor. A service that is killed without a clean
 * shutdown keeps its {@code UP} lease until it expires — up to 90 seconds with the default
 * 30s renewal — and Eureka's self-preservation mode can hold it far longer than that. A health
 * screen built on {@code instance.getStatus()} would therefore have shown the exact fleet the
 * 2026-08-12 audit was looking at ("6 of 16 absent from ps") as entirely green for a minute and a
 * half, which is precisely the window in which a manager is standing at a dead till asking what is
 * wrong. Discovery is used here for ONE thing — where the service lives — and its status field is
 * deliberately ignored.
 *
 * <h3>Why /actuator/health and not /actuator/health/readiness</h3>
 *
 * The readiness GROUP defaults to {@code readinessState} alone: an in-process availability flag
 * that stays UP while the database is unreachable. The ungrouped endpoint aggregates every
 * indicator the service registered — db, broker, disk — so it is the stricter of the two, and the
 * one that answers the question an operator is actually asking. This is the substance of the
 * long-standing "services wedge while /actuator/health still returns 200" concern: a wedged JVM
 * whose HTTP threads are exhausted cannot answer inside {@link #PROBE_TIMEOUT} either, and is
 * reported DOWN with the reason spelled out, rather than green because a port is still bound.
 *
 * <h3>Why the probe loop is decoupled from the request</h3>
 *
 * The endpoint serves whatever this loop last wrote. Probing per request would make the health
 * screen an amplifier — one unauthenticated GET becoming fifteen outbound calls — and would let a
 * refresh-happy browser add load to a fleet that is already struggling. The cost of the loop is
 * fixed and knowable: {@code services × 1 request / PROBE_INTERVAL}.
 */
@Component
public class FleetHealthMonitor {

    private static final Logger log = LoggerFactory.getLogger(FleetHealthMonitor.class);

    /**
     * How long a service gets to answer before it is DOWN.
     *
     * <p>Two seconds is a very long time for an actuator endpoint that touches a local connection
     * pool, and a very short time to keep a manager waiting. A service that cannot answer this in
     * two seconds cannot serve a till either, so calling it UP would be a lie of a different shape.
     */
    static final Duration PROBE_TIMEOUT = Duration.ofSeconds(2);

    /** Cadence of the probe loop, in ms. The screen polls faster than this and simply re-reads. */
    static final long PROBE_INTERVAL_MS = 5_000L;

    private final FleetCatalogue catalogue;
    private final ObjectProvider<ReactiveDiscoveryClient> discoveryClients;
    private final WebClient probeClient;

    /**
     * Last moment each service answered UP. Survives a DOWN→UP→DOWN cycle, which is the whole
     * point — "last reachable 06:12, it is now 06:31" is the sentence that tells an operator
     * whether they are looking at a blip or an outage.
     */
    private final Map<String, Instant> lastReachableAt = new ConcurrentHashMap<>();

    private final AtomicReference<FleetSnapshot> snapshot =
            new AtomicReference<>(new FleetSnapshot(null, List.of()));

    public FleetHealthMonitor(FleetCatalogue catalogue,
                              ObjectProvider<ReactiveDiscoveryClient> discoveryClients,
                              WebClient.Builder webClientBuilder) {
        this.catalogue = catalogue;
        this.discoveryClients = discoveryClients;
        this.probeClient = webClientBuilder.build();
    }

    /** The last completed sweep. Never null; {@code checkedAt} is null until the first one lands. */
    public FleetSnapshot current() {
        return snapshot.get();
    }

    @Scheduled(initialDelay = 0, fixedDelay = PROBE_INTERVAL_MS)
    public void sweep() {
        try {
            probeAll().block(PROBE_TIMEOUT.plusSeconds(3));
        } catch (RuntimeException e) {
            // A sweep that throws must not kill the scheduler thread and silently stop the screen
            // updating — a health monitor that has quietly stopped monitoring is the worst
            // possible version of this feature.
            log.warn("Fleet health sweep failed: {}", e.toString());
        }
    }

    Mono<FleetSnapshot> probeAll() {
        return catalogue.servicesWithPaths()
                .flatMap(services -> Flux.fromIterable(services.entrySet())
                        .flatMap(entry -> probeService(entry.getKey(), entry.getValue()))
                        .collectList())
                .map(results -> {
                    List<ServiceHealth> sorted = new ArrayList<>(results);
                    sorted.sort(Comparator.comparing(ServiceHealth::name));
                    FleetSnapshot next = new FleetSnapshot(Instant.now(), List.copyOf(sorted));
                    snapshot.set(next);
                    return next;
                });
    }

    private Mono<ServiceHealth> probeService(String name, List<String> paths) {
        ReactiveDiscoveryClient discovery = discoveryClients.getIfAvailable();
        if (discovery == null) {
            return Mono.just(down(name, paths, 0,
                    "This gateway has no service registry to look it up in."));
        }
        return discovery.getInstances(name)
                .collectList()
                .flatMap(instances -> {
                    if (instances.isEmpty()) {
                        return Mono.just(down(name, paths, 0,
                                "Not registered — nothing is currently advertising this service."));
                    }
                    // One instance is probed, not all of them: the question this screen answers is
                    // "can the product reach it", and the load balancer will pick an instance the
                    // same way. Reporting per-instance detail is a different screen.
                    ServiceInstance instance = instances.get(0);
                    return probeInstance(name, paths, instances.size(), instance);
                })
                .onErrorResume(e -> Mono.just(down(name, paths, 0,
                        "Could not be looked up in the service registry.")));
    }

    private Mono<ServiceHealth> probeInstance(String name, List<String> paths, int instanceCount,
                                              ServiceInstance instance) {
        String url = instance.getUri().toString().replaceAll("/+$", "") + "/actuator/health";
        return probeClient.get()
                .uri(url)
                .retrieve()
                .bodyToMono(HealthBody.class)
                .timeout(PROBE_TIMEOUT)
                .map(body -> {
                    if ("UP".equalsIgnoreCase(body.status())) {
                        Instant now = Instant.now();
                        lastReachableAt.put(name, now);
                        return new ServiceHealth(name, paths, ServiceHealth.FleetState.UP,
                                "Answering normally.", now, instanceCount);
                    }
                    return new ServiceHealth(name, paths, ServiceHealth.FleetState.DEGRADED,
                            "Running, but reporting itself as " + body.status()
                                    + " — usually its database or message broker.",
                            lastReachableAt.get(name), instanceCount);
                })
                .onErrorResume(e -> Mono.just(new ServiceHealth(
                        name, paths, ServiceHealth.FleetState.DOWN,
                        describeProbeFailure(e), lastReachableAt.get(name), instanceCount)));
    }

    /**
     * The probe failure, in a sentence a restaurant manager can act on.
     *
     * <p>Never the exception's own message: {@code Connection refused: /127.0.0.1:8084} tells the
     * reader nothing they can use and everything an attacker can.
     */
    private static String describeProbeFailure(Throwable e) {
        if (e instanceof java.util.concurrent.TimeoutException
                || e.getCause() instanceof java.util.concurrent.TimeoutException) {
            return "Did not answer within " + PROBE_TIMEOUT.toSeconds()
                    + " seconds — it is running but not responding.";
        }
        return "Not answering — the process appears to be stopped.";
    }

    private ServiceHealth down(String name, List<String> paths, int instanceCount, String detail) {
        return new ServiceHealth(name, paths, ServiceHealth.FleetState.DOWN, detail,
                lastReachableAt.get(name), instanceCount);
    }

    /**
     * The subset of an actuator health body this needs. {@code show-details} is {@code never} on
     * every service, so {@code status} is genuinely all that is on the wire — a richer type here
     * would be documenting a response nobody sends.
     */
    record HealthBody(String status) {
    }

    /**
     * @param checkedAt when the last sweep completed, or null if none has completed yet
     * @param services  every routed upstream, sorted by name
     */
    public record FleetSnapshot(Instant checkedAt, List<ServiceHealth> services) {
    }
}
