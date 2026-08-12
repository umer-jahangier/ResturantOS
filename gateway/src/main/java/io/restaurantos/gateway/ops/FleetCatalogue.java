package io.restaurantos.gateway.ops;

import org.springframework.cloud.gateway.route.RouteDefinition;
import org.springframework.cloud.gateway.route.RouteDefinitionLocator;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * WHICH services the operator health screen is expected to list, derived from the gateway's own
 * route table rather than from a hand-kept list.
 *
 * <h3>Why the route table and not a constant</h3>
 *
 * A hand-kept list is the exact shape this repository keeps being bitten by: something structurally
 * present that nothing keeps true. Add a service, forget the list, and the health screen reports a
 * green fleet with a hole in it — a screen whose failure mode is "silently omits the thing that is
 * down" is worse than no screen. The route table cannot drift, because a service the gateway does
 * not route to carries no user traffic and is therefore not part of "is the product working".
 *
 * <p>This is also why {@code notification-service} does not appear: it is an empty POM module with
 * no source, no route and no port. The 2026-08-12 register counted it among "6 of 16 services down"
 * and it has never been a service at all.
 *
 * <p>Only {@code lb://} routes count. A route pinned to a literal {@code http://host:port} (the
 * {@code AUTH_SERVICE_URI} escape hatch used in some test profiles) has no discovery name to probe
 * and is skipped rather than guessed at.
 */
@Component
public class FleetCatalogue {

    private final RouteDefinitionLocator routeDefinitionLocator;

    public FleetCatalogue(RouteDefinitionLocator routeDefinitionLocator) {
        this.routeDefinitionLocator = routeDefinitionLocator;
    }

    /**
     * Discovery name → the path prefixes it serves, in route-declaration order.
     *
     * <p>Several routes can share one service (auth-service serves {@code /api/v1/auth/**},
     * {@code /.well-known/**} and the role catalogue) — they are merged, because the operator is
     * asking about a PROCESS, and one process being down is one fact, not three.
     */
    public Mono<Map<String, List<String>>> servicesWithPaths() {
        return routeDefinitionLocator.getRouteDefinitions()
                .collectList()
                .map(this::index);
    }

    private Map<String, List<String>> index(List<RouteDefinition> definitions) {
        Map<String, List<String>> byService = new LinkedHashMap<>();
        for (RouteDefinition definition : definitions) {
            String serviceName = discoveryName(definition.getUri());
            if (serviceName == null) {
                continue;
            }
            List<String> paths = byService.computeIfAbsent(serviceName, k -> new ArrayList<>());
            for (String path : pathPredicates(definition)) {
                if (!paths.contains(path)) {
                    paths.add(path);
                }
            }
        }
        return byService;
    }

    /** {@code lb://pos-service} → {@code pos-service}; anything else → null. */
    static String discoveryName(URI uri) {
        if (uri == null || !"lb".equalsIgnoreCase(uri.getScheme())) {
            return null;
        }
        String host = uri.getHost();
        return host == null || host.isBlank() ? null : host.toLowerCase();
    }

    /**
     * The {@code Path=} predicate's patterns, split on commas the way Spring Cloud Gateway itself
     * splits a multi-pattern shorthand.
     *
     * <p>Best-effort by design: the paths are a LABEL on the health row ("this is the till"), not
     * the identity of the row. A predicate form this cannot read costs a caption, never a service.
     */
    private static List<String> pathPredicates(RouteDefinition definition) {
        List<String> patterns = new ArrayList<>();
        definition.getPredicates().stream()
                .filter(p -> "Path".equalsIgnoreCase(p.getName()))
                .flatMap(p -> p.getArgs().values().stream())
                .filter(v -> v != null && !v.isBlank())
                .forEach(v -> {
                    for (String part : v.split(",")) {
                        String trimmed = part.trim();
                        if (!trimmed.isEmpty()) {
                            patterns.add(trimmed);
                        }
                    }
                });
        return patterns;
    }
}
