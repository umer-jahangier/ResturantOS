package io.restaurantos.gateway;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Config-drift gate for the two biometric-device routes.
 *
 * <h2>The thing this pins, and why it was wrong</h2>
 *
 * <p>Both device routes tripped their circuit breaker on {@code 503} only, while the HR API route
 * immediately above them tripped on {@code 500} and {@code 503}. That difference was correct while it
 * lasted: until phase 25, a 500 on these routes was overwhelmingly an <em>authentication refusal</em>
 * — {@code DeviceAuthException} resolved through the shared advice's catch-all — so tripping on it
 * would have taken a whole branch's terminals offline the first time an installer mistyped a serial.
 *
 * <p>A refusal is now a 401. So a 500 here is a genuine fault, and not tripping on it means a broken
 * hr-service absorbs a poll every three to eight seconds from every terminal on the platform instead
 * of failing fast. Opening the breaker is safe on this path specifically because an ADMS device
 * buffers locally when the server is unreachable and replays on reconnect — which is only harmless
 * because ingestion is idempotent on (device, device user, timestamp).
 *
 * <h2>Structure, not text</h2>
 *
 * <p>Asserted against the parsed configuration tree — the route's filter list, the filter's
 * {@code args} map, the status list as a list of numbers — rather than by searching the file for a
 * string. A comment mentioning 500, or a 500 belonging to the route above, would satisfy a text
 * search and satisfies nothing here. This follows {@link GatewayResilienceConfigTest}, the house
 * pattern for gateway config gates: no Spring context, no container, no socket.
 */
class DeviceRouteConfigTest {

    private static final Path CONFIG_PATH = Path.of("src/main/resources/application.yml");

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> routes() throws IOException {
        try (InputStream in = Files.newInputStream(CONFIG_PATH)) {
            Map<String, Object> config = new Yaml().load(in);
            Map<String, Object> spring = (Map<String, Object>) config.get("spring");
            Map<String, Object> cloud = (Map<String, Object>) spring.get("cloud");
            Map<String, Object> gateway = (Map<String, Object>) cloud.get("gateway");
            Map<String, Object> server = (Map<String, Object>) gateway.get("server");
            Map<String, Object> webflux = (Map<String, Object>) server.get("webflux");
            return (List<Map<String, Object>>) webflux.get("routes");
        }
    }

    private Map<String, Object> route(String id) throws IOException {
        return routes().stream()
                .filter(r -> id.equals(r.get("id")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No route with id " + id));
    }

    @SuppressWarnings("unchecked")
    private Optional<Map<String, Object>> filterArgs(Map<String, Object> route, String filterName) {
        List<Object> filters = (List<Object>) route.get("filters");
        if (filters == null) {
            return Optional.empty();
        }
        for (Object f : filters) {
            if (f instanceof Map<?, ?> m && filterName.equals(m.get("name"))) {
                return Optional.ofNullable((Map<String, Object>) m.get("args"));
            }
        }
        return Optional.empty();
    }

    @SuppressWarnings("unchecked")
    private List<Object> predicates(Map<String, Object> route) {
        return (List<Object>) route.get("predicates");
    }

    // ---------------------------------------------------------------- the fix

    @SuppressWarnings("unchecked")
    @Test
    void bothDeviceRoutesTripTheBreakerOnAServerErrorAsWellAsOnUnavailability() throws IOException {
        for (String id : List.of("hr-iclock-route", "hr-attendance-ingest-route")) {
            Map<String, Object> args = filterArgs(route(id), "CircuitBreaker")
                    .orElseThrow(() -> new AssertionError(id + " has no CircuitBreaker filter"));

            assertThat((List<Object>) args.get("statusCodes"))
                    .as("%s must fail fast on a genuine fault, now that a refusal is a 401", id)
                    .containsExactlyInAnyOrder((Object) 500, (Object) 503);
        }
    }

    @Test
    void theDeviceRoutesMatchTheSameBreakerInstanceAsTheRestOfHr() throws IOException {
        for (String id : List.of("hr-iclock-route", "hr-attendance-ingest-route")) {
            Map<String, Object> args = filterArgs(route(id), "CircuitBreaker").orElseThrow();
            assertThat(args.get("name")).isEqualTo("hrCircuitBreaker");
            assertThat(args.get("fallbackUri")).isEqualTo("forward:/fallback/service-unavailable");
        }
    }

    // ---------------------------------------------------------------- what must not drift

    @Test
    void theDevicePathsAreStillRoutedToHrService() throws IOException {
        assertThat(predicates(route("hr-iclock-route"))).containsExactly("Path=/iclock/**");
        assertThat(route("hr-iclock-route").get("uri")).isEqualTo("lb://hr-service");

        assertThat(predicates(route("hr-attendance-ingest-route")))
                .containsExactly("Path=/internal/attendance/ingest");
        assertThat(route("hr-attendance-ingest-route").get("uri")).isEqualTo("lb://hr-service");
    }

    /**
     * Pinned, not endorsed. The resolver reads the serial from the {@code SN} query parameter, which
     * the JSON bridge route does not carry — so on that route it degrades to one shared bucket for
     * every tenant. That defect is {@code AdmsRegistrationDefectsIT.theBridgeRouteSharesOneRateLimit
     * BucketAcrossEveryTenant} and belongs to plan 25-08, which owns {@code RateLimitConfig}. This
     * test asserts only that the limiter is present and wired, so that 25-08 changes the resolver
     * rather than accidentally losing the limiter.
     */
    @Test
    void bothDeviceRoutesStillCarryThePerDeviceRateLimiter() throws IOException {
        for (String id : List.of("hr-iclock-route", "hr-attendance-ingest-route")) {
            Map<String, Object> args = filterArgs(route(id), "RequestRateLimiter")
                    .orElseThrow(() -> new AssertionError(id + " has no RequestRateLimiter filter"));
            assertThat(args.get("key-resolver")).isEqualTo("#{@deviceKeyResolver}");
        }
    }
}
