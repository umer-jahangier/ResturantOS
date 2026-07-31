package io.restaurantos.gateway;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Config-drift gate for the gateway's resilience4j wiring.
 *
 * <p>Four routes ({@code purchasing-route}, {@code pos-route}, {@code kitchen-route},
 * {@code inventory-route}) shipped naming a {@code CircuitBreaker} filter instance that was never
 * declared under {@code resilience4j.circuitbreaker.instances}. Each one silently ran on
 * resilience4j's built-in defaults, and the observed symptom, reproduced twice, was a persistent
 * 503 after any upstream restart — upstream healthy on its own port, one UP instance in Eureka —
 * until the gateway process itself was restarted.
 *
 * <p>This test reads {@code application.yml} as a plain file: no Spring context, no container, no
 * socket. It asserts every route-referenced circuit-breaker name is declared, so this class of
 * drift fails the build instead of surfacing as a production incident.
 */
class GatewayResilienceConfigTest {

    private static final Path CONFIG_PATH = Path.of("src/main/resources/application.yml");

    @SuppressWarnings("unchecked")
    private Map<String, Object> loadConfig() throws IOException {
        try (InputStream in = Files.newInputStream(CONFIG_PATH)) {
            return new Yaml().load(in);
        }
    }

    @SuppressWarnings("unchecked")
    private Set<String> collectRouteCircuitBreakerNames(Map<String, Object> config) {
        Map<String, Object> spring = (Map<String, Object>) config.get("spring");
        Map<String, Object> cloud = (Map<String, Object>) spring.get("cloud");
        Map<String, Object> gateway = (Map<String, Object>) cloud.get("gateway");
        Map<String, Object> server = (Map<String, Object>) gateway.get("server");
        Map<String, Object> webflux = (Map<String, Object>) server.get("webflux");

        Set<String> names = new LinkedHashSet<>();

        List<Map<String, Object>> routes = (List<Map<String, Object>>) webflux.get("routes");
        for (Map<String, Object> route : routes) {
            collectCircuitBreakerNamesFromFilters((List<Object>) route.get("filters"), names);
        }

        List<Object> defaultFilters = (List<Object>) webflux.get("default-filters");
        collectCircuitBreakerNamesFromFilters(defaultFilters, names);

        return names;
    }

    @SuppressWarnings("unchecked")
    private void collectCircuitBreakerNamesFromFilters(List<Object> filters, Set<String> out) {
        if (filters == null) {
            return;
        }
        for (Object rawFilter : filters) {
            // Gateway filters may use the shorthand string form (e.g.
            // "DedupeResponseHeader=..."), which is not a Map — skip those; only the
            // map form ("name: CircuitBreaker" + "args: {...}") is used for CircuitBreaker.
            if (!(rawFilter instanceof Map)) {
                continue;
            }
            Map<String, Object> filter = (Map<String, Object>) rawFilter;
            if ("CircuitBreaker".equals(filter.get("name"))) {
                Map<String, Object> args = (Map<String, Object>) filter.get("args");
                Object name = args == null ? null : args.get("name");
                if (name != null) {
                    out.add(name.toString());
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> declaredCircuitBreakerInstances(Map<String, Object> config) {
        Map<String, Object> resilience4j = (Map<String, Object>) config.get("resilience4j");
        Map<String, Object> circuitbreaker = (Map<String, Object>) resilience4j.get("circuitbreaker");
        return (Map<String, Object>) circuitbreaker.get("instances");
    }

    @Test
    void everyRouteCircuitBreakerHasADeclaredInstance() throws IOException {
        Map<String, Object> config = loadConfig();
        Set<String> routeBreakerNames = collectRouteCircuitBreakerNames(config);
        Set<String> declaredNames = declaredCircuitBreakerInstances(config).keySet();

        assertThat(routeBreakerNames)
                .as("route-referenced CircuitBreaker instance names must be discoverable"
                        + " (an empty result means the YAML walk found nothing, which must fail,"
                        + " not silently pass)")
                .isNotEmpty();

        assertThat(routeBreakerNames)
                .as("every route-referenced CircuitBreaker instance must be declared under"
                        + " resilience4j.circuitbreaker.instances")
                .isSubsetOf(declaredNames);
    }

    @Test
    void theFourRoutesThisPhaseDependsOnAreDeclared() throws IOException {
        Map<String, Object> config = loadConfig();
        Set<String> declaredNames = declaredCircuitBreakerInstances(config).keySet();

        assertThat(declaredNames)
                .as("the four instances this phase's inventory/purchasing routes depend on")
                .contains(
                        "inventoryCircuitBreaker",
                        "purchasingCircuitBreaker",
                        "posCircuitBreaker",
                        "kitchenCircuitBreaker");
    }

    @Test
    @SuppressWarnings("unchecked")
    void newInstancesCarryAnExplicitOpenStateWindow() throws IOException {
        Map<String, Object> config = loadConfig();
        Map<String, Object> instances = declaredCircuitBreakerInstances(config);

        Object referenceWaitDuration =
                ((Map<String, Object>) instances.get("financeCircuitBreaker"))
                        .get("waitDurationInOpenState");
        assertThat(referenceWaitDuration).isNotNull();

        for (String name : List.of(
                "purchasingCircuitBreaker",
                "posCircuitBreaker",
                "kitchenCircuitBreaker",
                "inventoryCircuitBreaker")) {
            Map<String, Object> instance = (Map<String, Object>) instances.get(name);
            assertThat(instance).as("instance %s must be declared", name).isNotNull();
            assertThat(instance.get("waitDurationInOpenState"))
                    .as("%s must carry an explicit open-state window matching the pre-existing"
                            + " instances, not an empty stanza that re-inherits defaults", name)
                    .isEqualTo(referenceWaitDuration);
        }
    }
}
