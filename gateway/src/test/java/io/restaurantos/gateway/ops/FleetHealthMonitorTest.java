package io.restaurantos.gateway.ops;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cloud.client.DefaultServiceInstance;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.ReactiveDiscoveryClient;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What the operator health screen reports, measured rather than assumed.
 *
 * <h3>Why every assertion here is about a service that is NOT up</h3>
 *
 * A fleet monitor that reports UP for everything is trivially "working" on a healthy machine, and
 * that is the version of this feature that would have shipped and then been useless on the one
 * night it mattered. The three cases below are the three ways the audit's fleet was actually
 * broken:
 *
 * <ul>
 *   <li>the process is gone and nothing answers the port — connection refused;</li>
 *   <li>the process is alive and wedged — the port accepts but the response never comes, which is
 *       the long-standing "services wedge while /actuator/health still returns 200" concern and the
 *       reason the probe carries a hard timeout rather than waiting;</li>
 *   <li>the service deregistered, so discovery advertises nothing at all.</li>
 * </ul>
 *
 * <p>Eureka's own {@code status} field is deliberately never consulted by the code under test, and
 * this class does not supply one — a lease says a service was alive up to 90 seconds ago, which is
 * exactly the window in which someone is standing at a dead till.
 */
class FleetHealthMonitorTest {

    private MockWebServer upstream;

    @BeforeEach
    void startUpstream() throws IOException {
        upstream = new MockWebServer();
        upstream.start();
    }

    @AfterEach
    void stopUpstream() {
        try {
            upstream.shutdown();
        } catch (IOException | IllegalStateException e) {
            // The wedged-service case deliberately leaves a slow response in flight, and
            // MockWebServer's shutdown can time out waiting for its own dispatcher queue. That is a
            // property of the harness, not of the code under test — the assertions have already
            // run by this point — so it must not turn a green test red.
        }
    }

    @Test
    void serviceAnsweringUp_isReportedUp_withALastReachableTime() {
        upstream.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"status\":\"UP\"}"));
        Instant before = Instant.now();

        ServiceHealth health = probeOne(instanceAt(upstream.getPort()));

        assertThat(health.state()).isEqualTo(ServiceHealth.FleetState.UP);
        assertThat(health.lastReachableAt()).isNotNull();
        assertThat(health.lastReachableAt()).isAfterOrEqualTo(before.minusSeconds(1));
        assertThat(health.paths()).containsExactly("/api/v1/pos/**");
    }

    @Test
    void serviceReportingItselfDown_isDegraded_notUp() {
        upstream.enqueue(new MockResponse()
                .setResponseCode(503)
                .setHeader("Content-Type", "application/json")
                .setBody("{\"status\":\"DOWN\"}"));

        ServiceHealth health = probeOne(instanceAt(upstream.getPort()));

        // A 503 body is an error status to WebClient, so this lands on the failure branch — which
        // is the correct OUTCOME either way: the one thing that must never happen is UP.
        assertThat(health.state()).isNotEqualTo(ServiceHealth.FleetState.UP);
        assertThat(health.detail()).isNotBlank();
    }

    @Test
    void deadPort_isReportedDown_andSaysTheProcessLooksStopped() throws IOException {
        int deadPort = upstream.getPort();
        upstream.shutdown();

        ServiceHealth health = probeOne(instanceAt(deadPort));

        assertThat(health.state()).isEqualTo(ServiceHealth.FleetState.DOWN);
        assertThat(health.detail()).contains("stopped");
        // Never seen in this monitor's lifetime, and it says exactly that rather than inventing one.
        assertThat(health.lastReachableAt()).isNull();
    }

    @Test
    void wedgedService_thatNeverAnswers_isDown_notUp() {
        // The port accepts the connection and the response never arrives. A monitor that merely
        // checked "is something listening" — or that waited without a bound — would call this UP
        // and hang the health screen respectively.
        upstream.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"status\":\"UP\"}")
                // Comfortably longer than PROBE_TIMEOUT (2s) and short enough that MockWebServer's
                // own teardown is not left holding it for the rest of the suite.
                .setBodyDelay(4, java.util.concurrent.TimeUnit.SECONDS));

        ServiceHealth health = probeOne(instanceAt(upstream.getPort()));

        assertThat(health.state()).isEqualTo(ServiceHealth.FleetState.DOWN);
        assertThat(health.detail()).contains("not responding");
    }

    @Test
    void serviceWithNoRegisteredInstance_isDown_notOmitted() {
        // Omitting it would be the worst possible failure: a health screen that silently drops the
        // row for a service that has deregistered shows a complete-looking green fleet with a hole
        // in it, and an operator would read the missing till as their own mistake.
        FleetHealthMonitor monitor = monitorWith(name -> Flux.empty());

        ServiceHealth health = monitor.probeAll().block().services().get(0);

        assertThat(health.name()).isEqualTo("pos-service");
        assertThat(health.state()).isEqualTo(ServiceHealth.FleetState.DOWN);
        assertThat(health.detail()).contains("Not registered");
        assertThat(health.instanceCount()).isZero();
    }

    @Test
    void aSnapshotIsRetainedForTheEndpointToServe() {
        upstream.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"status\":\"UP\"}"));
        FleetHealthMonitor monitor = monitorWith(name -> Flux.just(instanceAt(upstream.getPort())));

        // Before any sweep the snapshot exists but says it has not looked yet — never an empty
        // fleet dressed as a healthy one.
        assertThat(monitor.current().checkedAt()).isNull();
        assertThat(monitor.current().services()).isEmpty();

        monitor.sweep();

        assertThat(monitor.current().checkedAt()).isNotNull();
        assertThat(monitor.current().services()).hasSize(1);
    }

    // ── harness ────────────────────────────────────────────────────────────────

    private ServiceHealth probeOne(ServiceInstance instance) {
        return monitorWith(name -> Flux.just(instance)).probeAll().block().services().get(0);
    }

    private static ServiceInstance instanceAt(int port) {
        return new DefaultServiceInstance("pos-service-1", "pos-service", "127.0.0.1", port, false);
    }

    /** A catalogue of exactly one routed service, and a discovery client the test controls. */
    private FleetHealthMonitor monitorWith(java.util.function.Function<String, Flux<ServiceInstance>> instances) {
        FleetCatalogue catalogue = new FleetCatalogue(null) {
            @Override
            public Mono<Map<String, List<String>>> servicesWithPaths() {
                return Mono.just(Map.of("pos-service", List.of("/api/v1/pos/**")));
            }
        };
        ReactiveDiscoveryClient discovery = new ReactiveDiscoveryClient() {
            @Override
            public String description() {
                return "test";
            }

            @Override
            public Flux<ServiceInstance> getInstances(String serviceId) {
                return instances.apply(serviceId);
            }

            @Override
            public Flux<String> getServices() {
                return Flux.just("pos-service");
            }
        };
        return new FleetHealthMonitor(catalogue, provider(discovery), WebClient.builder());
    }

    private static ObjectProvider<ReactiveDiscoveryClient> provider(ReactiveDiscoveryClient client) {
        return new ObjectProvider<>() {
            @Override
            public ReactiveDiscoveryClient getObject() {
                return client;
            }

            @Override
            public ReactiveDiscoveryClient getObject(Object... args) {
                return client;
            }

            @Override
            public ReactiveDiscoveryClient getIfAvailable() {
                return client;
            }

            @Override
            public ReactiveDiscoveryClient getIfUnique() {
                return client;
            }

            @Override
            public void forEach(Consumer<? super ReactiveDiscoveryClient> action) {
                action.accept(client);
            }
        };
    }
}
