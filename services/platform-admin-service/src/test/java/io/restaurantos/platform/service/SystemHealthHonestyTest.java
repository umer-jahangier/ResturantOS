package io.restaurantos.platform.service;

import io.restaurantos.platform.dto.SystemHealthDtos.ComponentHealth;
import io.restaurantos.platform.dto.SystemHealthDtos.HealthState;
import io.restaurantos.platform.dto.SystemHealthDtos.MigrationState;
import io.restaurantos.platform.dto.SystemHealthDtos.SystemHealthResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.connection.Connection;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.DiscoveryClient;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.URI;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The status surface's one rule: <b>nothing it cannot determine may render as healthy.</b>
 *
 * <p>Every test here drives a case where the truthful answer is "I do not know", and asserts that
 * the response says so. The failure this guards against is not a crash — it is a status page that
 * quietly shows green during an incident because a probe path defaulted to optimism, which is the
 * one bug that makes every other tile on the page worthless.
 *
 * <p>No containers. The probes are HTTP and JDBC calls behind interfaces, and the decisions being
 * asserted are this service's, not PostgreSQL's.
 */
class SystemHealthHonestyTest {

    @SuppressWarnings("unchecked")
    private static <T> ObjectProvider<T> providerOf(T value) {
        ObjectProvider<T> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(value);
        return provider;
    }

    private static JdbcTemplate healthyJdbc() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(eq("SELECT 1"), eq(Integer.class))).thenReturn(1);
        when(jdbc.queryForObject(eq("SELECT count(*) FROM databasechangelog"), eq(Long.class)))
                .thenReturn(11L);
        return jdbc;
    }

    private static StringRedisTemplate healthyRedis() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        doReturn("PONG").when(redis).execute(any(RedisCallback.class));
        return redis;
    }

    private static ConnectionFactory healthyBroker() {
        ConnectionFactory factory = mock(ConnectionFactory.class);
        Connection connection = mock(Connection.class);
        when(connection.isOpen()).thenReturn(true);
        when(factory.createConnection()).thenReturn(connection);
        return factory;
    }

    private static SystemHealthService service(DiscoveryClient discovery,
                                               ConnectionFactory broker,
                                               JdbcTemplate jdbc,
                                               StringRedisTemplate redis) {
        return new SystemHealthService(
                providerOf(discovery), providerOf(broker), jdbc, redis, 200L, "reporting-service");
    }

    @Test
    @DisplayName("with no registry to consult, the registry is UNKNOWN and the platform is not UP")
    void noDiscoveryClientIsUnknownRatherThanHealthy() {
        SystemHealthResponse health = service(null, healthyBroker(), healthyJdbc(), healthyRedis())
                .health();

        assertThat(health.registry().state())
                .as("""
                    There is no DiscoveryClient bean at all — eureka.client.enabled=false. The \
                    tempting reading is "no services are reported down, so the fleet is fine". It \
                    is the opposite: nothing was asked, so nothing is known.""")
                .isEqualTo(HealthState.UNKNOWN);

        assertThat(health.services())
                .as("an empty list because the registry is UNKNOWN, not because nothing is running")
                .isEmpty();

        assertThat(health.overall())
                .as("""
                    The summary must never be produced out of ignorance. Every determinable \
                    component here is healthy, and the answer is still not UP, because the fleet \
                    itself was never observed.""")
                .isNotEqualTo(HealthState.UP);
    }

    @Test
    @DisplayName("reporting-service absent makes the ClickHouse fact tables UNKNOWN, never green")
    void clickHouseStateIsUnknownWhenReportingServiceIsNotVisible() {
        DiscoveryClient discovery = mock(DiscoveryClient.class);
        when(discovery.getServices()).thenReturn(List.of("auth-service"));
        when(discovery.getInstances("auth-service")).thenReturn(List.of());

        SystemHealthResponse health =
                service(discovery, healthyBroker(), healthyJdbc(), healthyRedis()).health();

        MigrationState clickhouse = migration(health, "clickhouse.analytics_fact_tables");

        assertThat(clickhouse.state())
                .as("""
                    reporting-service refuses to boot without its four fact tables, so a SERVING \
                    instance is evidence they exist. The converse does not hold at all: not seeing \
                    reporting-service is consistent with a missing table AND with a dozen \
                    unrelated causes, and this service holds no ClickHouse driver to settle it.""")
                .isEqualTo(HealthState.UNKNOWN);

        assertThat(clickhouse.basis())
                .as("the tile must say how the state was established, since it is an inference")
                .isNotBlank();
        assertThat(clickhouse.detail())
                .as("the four table names belong in the detail, so an operator knows what to check")
                .contains("sales_order_facts");
    }

    @Test
    @DisplayName("a registered service with no instances is UNKNOWN, not UP and not DOWN")
    void registeredWithoutInstancesIsUnknown() {
        DiscoveryClient discovery = mock(DiscoveryClient.class);
        when(discovery.getServices()).thenReturn(List.of("kitchen-service"));
        when(discovery.getInstances("kitchen-service")).thenReturn(List.of());

        SystemHealthResponse health =
                service(discovery, healthyBroker(), healthyJdbc(), healthyRedis()).health();

        assertThat(health.services()).hasSize(1);
        assertThat(health.services().get(0).state())
                .as("a registration is not evidence a process answers, and its absence is not "
                    + "evidence of death — there was simply nothing to probe")
                .isEqualTo(HealthState.UNKNOWN);
        assertThat(health.services().get(0).instancesRegistered()).isZero();
    }

    @Test
    @DisplayName("an instance that cannot be reached is UNREACHABLE — distinct from a self-reported DOWN")
    void unreachableInstanceIsNotConflatedWithDown() {
        ServiceInstance instance = mock(ServiceInstance.class);
        // Port 1 is reserved and nothing listens on it, so the probe fails fast without a network
        // dependency the test suite would otherwise have to own.
        when(instance.getUri()).thenReturn(URI.create("http://127.0.0.1:1"));
        when(instance.getInstanceId()).thenReturn("pos-service:1");

        DiscoveryClient discovery = mock(DiscoveryClient.class);
        when(discovery.getServices()).thenReturn(List.of("pos-service"));
        when(discovery.getInstances("pos-service")).thenReturn(List.of(instance));

        SystemHealthResponse health =
                service(discovery, healthyBroker(), healthyJdbc(), healthyRedis()).health();

        var pos = health.services().get(0);
        assertThat(pos.state())
                .as("""
                    DOWN means the process answered and said it was unhealthy. UNREACHABLE means \
                    nothing answered — consistent with a dead process AND with a partition, a \
                    stale registry entry, or this service being the isolated one. They call for \
                    different actions at 3am.""")
                .isEqualTo(HealthState.UNREACHABLE);
        assertThat(pos.instancesUnreachable()).isEqualTo(1);
        assertThat(pos.instancesDown()).isZero();
        assertThat(pos.instances().get(0).uri())
                .as("a status page that will not say what it asked is one you cannot argue with")
                .contains("/actuator/health");
        assertThat(health.overall()).isEqualTo(HealthState.DOWN);
    }

    @Test
    @DisplayName("a database that refuses a trivial query is DOWN, and it is the platform's own")
    void databaseFailureIsReportedAsDown() {
        JdbcTemplate broken = mock(JdbcTemplate.class);
        when(broken.queryForObject(eq("SELECT 1"), eq(Integer.class)))
                .thenThrow(new IllegalStateException("pool exhausted"));
        when(broken.queryForObject(eq("SELECT count(*) FROM databasechangelog"), eq(Long.class)))
                .thenThrow(new IllegalStateException("pool exhausted"));

        SystemHealthResponse health = service(null, healthyBroker(), broken, healthyRedis()).health();

        assertThat(component(health, "platform_db").state()).isEqualTo(HealthState.DOWN);
        assertThat(migration(health, "platform_db.liquibase").state())
                .as("""
                    The changelog could not be READ. That is not evidence migrations are missing, \
                    and reporting a schema failure here would send an operator to investigate the \
                    wrong thing during a connection-pool incident.""")
                .isEqualTo(HealthState.UNKNOWN);
    }

    @Test
    @DisplayName("a broker that refuses a connection is DOWN — and depth metrics stay uncollected")
    void brokerFailureIsDownAndQueueDepthIsNeverInvented() {
        ConnectionFactory broken = mock(ConnectionFactory.class);
        doThrow(new IllegalStateException("connection refused")).when(broken).createConnection();

        SystemHealthResponse health = service(null, broken, healthyJdbc(), healthyRedis()).health();

        assertThat(component(health, "rabbitmq").state()).isEqualTo(HealthState.DOWN);

        assertThat(health.notCollected().stream().map(m -> m.name()).toList())
                .as("""
                    A DLQ chart that is not actually reading a DLQ is worse than no chart. There \
                    is no RabbitMQ management client in any service in this product, so depth and \
                    lag are named as uncollected rather than drawn from nothing.""")
                .contains("queue_depth", "dlq_depth", "consumer_lag", "clickhouse_ingest_lag");
        assertThat(health.notCollected()).allSatisfy(metric ->
                assertThat(metric.reason()).isNotBlank());
    }

    private static ComponentHealth component(SystemHealthResponse health, String name) {
        return health.infrastructure().stream()
                .filter(c -> c.name().equals(name))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no component named " + name));
    }

    private static MigrationState migration(SystemHealthResponse health, String name) {
        return health.migrations().stream()
                .filter(m -> m.name().equals(name))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no migration state named " + name));
    }
}
