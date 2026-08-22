package io.restaurantos.platform.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.platform.dto.SystemHealthDtos.ComponentHealth;
import io.restaurantos.platform.dto.SystemHealthDtos.HealthState;
import io.restaurantos.platform.dto.SystemHealthDtos.InstanceHealth;
import io.restaurantos.platform.dto.SystemHealthDtos.MigrationState;
import io.restaurantos.platform.dto.SystemHealthDtos.ServiceHealth;
import io.restaurantos.platform.dto.SystemHealthDtos.SystemHealthResponse;
import io.restaurantos.platform.dto.SystemHealthDtos.UncollectedMetric;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.DiscoveryClient;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * The platform status surface: service registry, per-service actuator health, database, cache,
 * broker, and the one migration state that can take the whole deploy down.
 *
 * <h2>Why this exists here rather than reusing the gateway's fleet health</h2>
 *
 * <p>{@code GET /api/v1/ops/health} on the gateway already does the per-service half of this, and
 * does it well — it derives the service list from the gateway's own route table so a service cannot
 * be silently omitted, and it reports actual reachability rather than {@code eureka
 * instance.getStatus()}, on the grounds that a registry entry is not evidence a process answers.
 * <b>A platform SuperAdmin token cannot read it.</b> {@code OpsTokenAuthorizer} requires the
 * {@code ops.health.view} permission, and a platform token carries exactly one authority,
 * {@code SUPER_ADMIN}, and no {@code tenant_id} claim at all.
 *
 * <p>Widening that gate is a one-file change to the GATEWAY's own authorizer, which is a security
 * change to the security component and belongs in a review of its own — not slipped in as a side
 * effect of an analytics plan. So this service builds its own view, from the registry it is already
 * a client of, and the two can be reconciled deliberately later. The difference is stated rather
 * than hidden: this list comes from Eureka registrations, the gateway's comes from its route table,
 * and a service that registers but is not routed appears here and not there.
 *
 * <h2>Nothing here defaults to healthy</h2>
 *
 * <p>Every path that cannot establish a fact produces {@code UNKNOWN} or {@code UNREACHABLE}. That
 * includes the case where there is no {@link DiscoveryClient} bean at all (Eureka disabled, as it is
 * in the test profile): the registry component reports UNKNOWN with the reason, and the service
 * list is empty rather than being quietly rendered as "no services are down".
 */
@Service
public class SystemHealthService {

    private static final Logger log = LoggerFactory.getLogger(SystemHealthService.class);

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The four tables reporting-service refuses to boot without. Named so the tile can say which. */
    private static final List<String> CLICKHOUSE_FACT_TABLES = List.of(
            "sales_order_facts", "sales_item_facts", "purchase_tax_facts", "till_session_facts");

    private final ObjectProvider<DiscoveryClient> discoveryClientProvider;
    private final ObjectProvider<org.springframework.amqp.rabbit.connection.ConnectionFactory> rabbitProvider;
    private final JdbcTemplate jdbcTemplate;
    private final StringRedisTemplate redis;
    private final long probeTimeoutMs;
    private final String reportingServiceId;
    private final HttpClient http;

    public SystemHealthService(
            ObjectProvider<DiscoveryClient> discoveryClientProvider,
            ObjectProvider<org.springframework.amqp.rabbit.connection.ConnectionFactory> rabbitProvider,
            JdbcTemplate jdbcTemplate,
            StringRedisTemplate redis,
            @Value("${restaurantos.health.probe-timeout-ms:2000}") long probeTimeoutMs,
            @Value("${restaurantos.health.reporting-service-id:reporting-service}") String reportingServiceId) {
        this.discoveryClientProvider = discoveryClientProvider;
        this.rabbitProvider = rabbitProvider;
        this.jdbcTemplate = jdbcTemplate;
        this.redis = redis;
        this.probeTimeoutMs = probeTimeoutMs;
        this.reportingServiceId = reportingServiceId;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(probeTimeoutMs))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    public SystemHealthResponse health() {
        Instant checkedAt = Instant.now();

        DiscoveryClient discovery = discoveryClientProvider.getIfAvailable();
        ComponentHealth registry;
        List<ServiceHealth> services;

        if (discovery == null) {
            registry = new ComponentHealth("eureka", "REGISTRY", HealthState.UNKNOWN,
                    "no DiscoveryClient is configured in this service, so the registry cannot be "
                        + "consulted. This is the state when eureka.client.enabled=false");
            services = List.of();
        } else {
            try {
                List<String> serviceIds = new ArrayList<>(discovery.getServices());
                serviceIds.sort(Comparator.naturalOrder());
                registry = new ComponentHealth("eureka", "REGISTRY", HealthState.UP,
                        serviceIds.size() + " service(s) registered. A registration is not evidence "
                            + "a process answers — each one below was probed");
                services = probeAll(discovery, serviceIds);
            } catch (Exception ex) {
                log.warn("[health] registry unavailable ({})", ex.toString());
                registry = new ComponentHealth("eureka", "REGISTRY", HealthState.UNKNOWN,
                        "the registry did not answer (" + ex.getClass().getSimpleName() + "): the "
                            + "service list below is empty because it is UNKNOWN, not because "
                            + "nothing is running");
                services = List.of();
            }
        }

        List<ComponentHealth> infrastructure = List.of(platformDb(), redisCache(), broker());
        List<MigrationState> migrations = List.of(liquibaseState(), clickHouseFactTables(services));

        return new SystemHealthResponse(
                checkedAt,
                overall(registry, services, infrastructure, migrations),
                registry,
                services,
                infrastructure,
                migrations,
                notCollected());
    }

    // ── services ──────────────────────────────────────────────────────────────

    /**
     * Probes every registered instance of every registered service, concurrently.
     *
     * <p>Concurrently because a status page is opened during an incident, and an incident is
     * precisely when several services are timing out: sequential probes at a 2s timeout across
     * fifteen services is half a minute of an operator staring at a spinner. Each probe carries its
     * own timeout, so one dead instance cannot hold the page.
     */
    private List<ServiceHealth> probeAll(DiscoveryClient discovery, List<String> serviceIds) {
        List<CompletableFuture<ServiceHealth>> futures = new ArrayList<>();
        for (String serviceId : serviceIds) {
            futures.add(CompletableFuture.supplyAsync(() -> probeService(discovery, serviceId)));
        }
        List<ServiceHealth> results = new ArrayList<>();
        for (CompletableFuture<ServiceHealth> future : futures) {
            try {
                results.add(future.join());
            } catch (Exception ex) {
                log.warn("[health] a service probe failed to complete ({})", ex.toString());
            }
        }
        return List.copyOf(results);
    }

    private ServiceHealth probeService(DiscoveryClient discovery, String serviceId) {
        List<ServiceInstance> instances;
        try {
            instances = discovery.getInstances(serviceId);
        } catch (Exception ex) {
            return new ServiceHealth(serviceId, HealthState.UNKNOWN, 0, 0, 0, 0, List.of(),
                    "the registry could not list instances (" + ex.getClass().getSimpleName() + ")");
        }

        if (instances == null || instances.isEmpty()) {
            return new ServiceHealth(serviceId, HealthState.UNKNOWN, 0, 0, 0, 0, List.of(),
                    "registered under this name but with no instances — nothing to probe. Not the "
                        + "same as DOWN, and deliberately not rendered as UP");
        }

        List<InstanceHealth> probed = new ArrayList<>();
        List<CompletableFuture<InstanceHealth>> futures = new ArrayList<>();
        for (ServiceInstance instance : instances) {
            futures.add(CompletableFuture.supplyAsync(() -> probeInstance(instance)));
        }
        for (CompletableFuture<InstanceHealth> future : futures) {
            probed.add(future.join());
        }

        int up = (int) probed.stream().filter(i -> i.state() == HealthState.UP).count();
        int down = (int) probed.stream().filter(i -> i.state() == HealthState.DOWN).count();
        int unreachable = (int) probed.stream().filter(i -> i.state() == HealthState.UNREACHABLE).count();

        HealthState state;
        String detail;
        if (down > 0) {
            state = HealthState.DOWN;
            detail = down + " of " + probed.size() + " instance(s) reported themselves DOWN";
        } else if (up > 0 && unreachable == 0) {
            state = HealthState.UP;
            detail = up + " of " + probed.size() + " instance(s) answered UP";
        } else if (up > 0) {
            // Some answered, some did not. Not healthy, and not conclusively broken either.
            state = HealthState.UNREACHABLE;
            detail = up + " instance(s) answered UP and " + unreachable + " did not answer at all";
        } else if (unreachable > 0) {
            state = HealthState.UNREACHABLE;
            detail = "no registered instance answered within " + probeTimeoutMs + "ms";
        } else {
            state = HealthState.UNKNOWN;
            detail = "no instance produced a readable health document";
        }

        return new ServiceHealth(serviceId, state, probed.size(), up, down, unreachable,
                List.copyOf(probed), detail);
    }

    /**
     * One {@code GET /actuator/health}.
     *
     * <p>{@code /actuator/health/**} is {@code permitAll()} on every service in this fleet, so no
     * credential is attached and none is needed. A 200 whose {@code status} is UP is the only thing
     * that produces UP here; a non-2xx, an unparseable body, or a body with no {@code status} field
     * is UNKNOWN rather than DOWN, because "I could not read the answer" is not "the answer was no".
     */
    private InstanceHealth probeInstance(ServiceInstance instance) {
        URI uri = instance.getUri().resolve("/actuator/health");
        String instanceId = instance.getInstanceId() == null
                ? instance.getHost() + ":" + instance.getPort()
                : instance.getInstanceId();
        long started = System.nanoTime();
        try {
            HttpResponse<String> response = http.send(
                    HttpRequest.newBuilder(uri)
                            .timeout(Duration.ofMillis(probeTimeoutMs))
                            .GET()
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            long elapsedMs = (System.nanoTime() - started) / 1_000_000;

            Optional<String> status = readStatus(response.body());
            if (status.isEmpty()) {
                return new InstanceHealth(instanceId, uri.toString(), HealthState.UNKNOWN,
                        "HTTP " + response.statusCode() + " with no readable 'status' field",
                        elapsedMs);
            }
            String value = status.get();
            HealthState state = switch (value) {
                case "UP" -> HealthState.UP;
                case "DOWN", "OUT_OF_SERVICE" -> HealthState.DOWN;
                default -> HealthState.UNKNOWN;
            };
            return new InstanceHealth(instanceId, uri.toString(), state,
                    "actuator reported " + value, elapsedMs);
        } catch (java.net.http.HttpTimeoutException ex) {
            return new InstanceHealth(instanceId, uri.toString(), HealthState.UNREACHABLE,
                    "no response within " + probeTimeoutMs + "ms", null);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return new InstanceHealth(instanceId, uri.toString(), HealthState.UNKNOWN,
                    "the probe was interrupted before it completed", null);
        } catch (Exception ex) {
            return new InstanceHealth(instanceId, uri.toString(), HealthState.UNREACHABLE,
                    ex.getClass().getSimpleName()
                        + (ex.getMessage() == null ? "" : ": " + ex.getMessage()), null);
        }
    }

    /** Spring Boot's health document is {@code {"status":"UP", "components":{...}}}. */
    private static Optional<String> readStatus(String body) {
        if (body == null || body.isBlank()) {
            return Optional.empty();
        }
        try {
            JsonNode node = MAPPER.readTree(body);
            JsonNode status = node.get("status");
            return status == null || !status.isTextual() ? Optional.empty() : Optional.of(status.asText());
        } catch (Exception ex) {
            return Optional.empty();
        }
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    private ComponentHealth platformDb() {
        try {
            Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            if (one == null || one != 1) {
                return new ComponentHealth("platform_db", "DATABASE", HealthState.UNKNOWN,
                        "the connectivity probe returned an unexpected value");
            }
            return new ComponentHealth("platform_db", "DATABASE", HealthState.UP,
                    "SELECT 1 succeeded on the service's own datasource");
        } catch (Exception ex) {
            return new ComponentHealth("platform_db", "DATABASE", HealthState.DOWN,
                    "the datasource refused a trivial query (" + ex.getClass().getSimpleName() + ")");
        }
    }

    private ComponentHealth redisCache() {
        try {
            String pong = redis.execute((org.springframework.data.redis.core.RedisCallback<String>)
                    connection -> connection.ping());
            return new ComponentHealth("redis", "CACHE", HealthState.UP,
                    "PING answered " + pong + ". Feature-flag and NLQ-quota keys are read from here");
        } catch (Exception ex) {
            return new ComponentHealth("redis", "CACHE", HealthState.DOWN,
                    "PING failed (" + ex.getClass().getSimpleName() + "). Feature-flag cache "
                        + "invalidation and the NLQ quota counter depend on this");
        }
    }

    /**
     * Broker reachability, and only that.
     *
     * <p>It opens a connection and closes it. It does NOT report queue depth, DLQ depth or consumer
     * lag, because nothing in this product collects any of those — there is no RabbitMQ management
     * client in any service. Those appear in {@code notCollected} rather than as an empty chart.
     */
    private ComponentHealth broker() {
        var factory = rabbitProvider.getIfAvailable();
        if (factory == null) {
            return new ComponentHealth("rabbitmq", "BROKER", HealthState.UNKNOWN,
                    "no AMQP connection factory is configured in this service");
        }
        try (var connection = factory.createConnection()) {
            boolean open = connection.isOpen();
            return new ComponentHealth("rabbitmq", "BROKER",
                    open ? HealthState.UP : HealthState.DOWN,
                    open ? "a connection was opened successfully. Reachability only — queue and DLQ "
                            + "depth are not collected anywhere in this product"
                         : "the connection opened and immediately reported closed");
        } catch (Exception ex) {
            return new ComponentHealth("rabbitmq", "BROKER", HealthState.DOWN,
                    "could not open a connection (" + ex.getClass().getSimpleName() + "). The "
                        + "transactional outbox relay publishes through this");
        }
    }

    // ── migration state ───────────────────────────────────────────────────────

    private MigrationState liquibaseState() {
        try {
            Long applied = jdbcTemplate.queryForObject(
                    "SELECT count(*) FROM databasechangelog", Long.class);
            return new MigrationState("platform_db.liquibase", HealthState.UP,
                    "read directly from platform_db.databasechangelog",
                    applied + " changeset(s) applied");
        } catch (Exception ex) {
            return new MigrationState("platform_db.liquibase", HealthState.UNKNOWN,
                    "the changelog table could not be read",
                    "SELECT on databasechangelog failed (" + ex.getClass().getSimpleName()
                        + "). This is not evidence migrations are missing");
        }
    }

    /**
     * The ClickHouse fact tables — the migration state that can take a whole deploy down.
     *
     * <p>reporting-service's {@code ClickHouseSchemaGuard} refuses to finish {@code @PostConstruct}
     * unless all four fact tables exist in the configured ClickHouse database. A reporting-service
     * instance that is serving is therefore evidence the tables existed when it booted. That is a
     * real inference and it is a bounded one, so the {@code basis} field says so explicitly rather
     * than letting a green tick imply a direct check.
     *
     * <p>The converse does NOT hold and is not claimed. reporting-service being unreachable is
     * consistent with a missing fact table AND with a dozen unrelated causes, and this service holds
     * no ClickHouse driver with which to settle it. So that case is UNKNOWN, which is the whole
     * point of the state existing.
     */
    private MigrationState clickHouseFactTables(List<ServiceHealth> services) {
        Optional<ServiceHealth> reporting = services.stream()
                .filter(s -> reportingServiceId.equalsIgnoreCase(s.serviceId()))
                .findFirst();

        String names = String.join(", ", CLICKHOUSE_FACT_TABLES);

        if (reporting.isEmpty()) {
            return new MigrationState("clickhouse.analytics_fact_tables", HealthState.UNKNOWN,
                    "inferred from reporting-service, which is not visible in the registry",
                    "reporting-service is not registered, so its boot-time guard has told us "
                        + "nothing. This service has no ClickHouse driver and cannot check "
                        + names + " directly");
        }

        ServiceHealth health = reporting.get();
        if (health.state() == HealthState.UP) {
            return new MigrationState("clickhouse.analytics_fact_tables", HealthState.UP,
                    "INFERRED, not measured: reporting-service refuses to finish startup unless "
                        + names + " all exist (ClickHouseSchemaGuard), so a serving instance is "
                        + "evidence they were present at its boot",
                    health.instancesUp() + " reporting-service instance(s) are serving");
        }

        return new MigrationState("clickhouse.analytics_fact_tables", HealthState.UNKNOWN,
                "inferred from reporting-service, which is currently " + health.state(),
                "reporting-service is not answering. A missing fact table is ONE cause of that and "
                    + "there are others; this service holds no ClickHouse driver, so it cannot "
                    + "distinguish them. Reported as unknown rather than as a schema failure");
    }

    // ── what nobody collects ──────────────────────────────────────────────────

    private static List<UncollectedMetric> notCollected() {
        return List.of(
                new UncollectedMetric("queue_depth",
                        "no RabbitMQ management client exists in any service, so no queue depth is "
                            + "read anywhere in this product"),
                new UncollectedMetric("dlq_depth",
                        "same: the dead-letter exchange and its queues are declared in "
                            + "deploy/init/rabbitmq-definitions.template.json, but nothing reads "
                            + "their depth"),
                new UncollectedMetric("consumer_lag",
                        "no consumer offset or lag metric is published by any listener"),
                new UncollectedMetric("connection_pool_saturation",
                        "HikariCP exposes pool gauges to each service's own /actuator/prometheus, "
                            + "but nothing aggregates them across the fleet"),
                new UncollectedMetric("clickhouse_ingest_lag",
                        "the ETL writes facts but records no watermark, so how far behind ingest is "
                            + "cannot be computed"),
                new UncollectedMetric("per_service_error_rate",
                        "Prometheus scrape targets exist on every service; no Prometheus query "
                            + "client exists in any of them"));
    }

    // ── aggregation ───────────────────────────────────────────────────────────

    /**
     * The one summary number, computed so that ignorance can never produce green.
     *
     * <p>Any DOWN or UNREACHABLE anywhere makes the platform DOWN. Otherwise any UNKNOWN makes it
     * UNKNOWN. Only an all-UP fleet is UP. A three-state roll-up is blunt on purpose: an operator
     * reading one word at the top of a status page should never have to ask whether the word was
     * hedged.
     */
    private static HealthState overall(ComponentHealth registry,
                                       List<ServiceHealth> services,
                                       List<ComponentHealth> infrastructure,
                                       List<MigrationState> migrations) {
        List<HealthState> states = new ArrayList<>();
        states.add(registry.state());
        services.forEach(s -> states.add(s.state()));
        infrastructure.forEach(c -> states.add(c.state()));
        migrations.forEach(m -> states.add(m.state()));

        if (states.stream().anyMatch(s -> s == HealthState.DOWN || s == HealthState.UNREACHABLE)) {
            return HealthState.DOWN;
        }
        if (states.stream().anyMatch(s -> s == HealthState.UNKNOWN)) {
            return HealthState.UNKNOWN;
        }
        return HealthState.UP;
    }
}
