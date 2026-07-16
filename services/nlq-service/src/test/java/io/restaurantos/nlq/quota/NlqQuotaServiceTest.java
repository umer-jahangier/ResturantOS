package io.restaurantos.nlq.quota;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link NlqQuotaService} against a real Redis (Testcontainers) — the
 * INCR/DECRBY/expire semantics being asserted are exactly the kind of thing a mocked
 * {@code ValueOperations} would fake incorrectly, so this uses a real (if lightweight, throwaway)
 * Redis rather than Mockito stubs.
 */
class NlqQuotaServiceTest {

    private static final long MONTHLY_LIMIT = 3;
    private static final long HOURLY_LIMIT = 2;

    @BeforeAll
    static void startContainer() {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
    }

    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    static {
        REDIS.start();
    }

    @AfterAll
    static void stopContainer() {
        REDIS.stop();
    }

    private NlqQuotaService newService() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration(
                REDIS.getHost(), REDIS.getMappedPort(6379));
        LettuceConnectionFactory factory = new LettuceConnectionFactory(config);
        factory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(factory);
        template.afterPropertiesSet();
        return new NlqQuotaService(template, MONTHLY_LIMIT, HOURLY_LIMIT);
    }

    /**
     * Points at a port nothing is listening on — every Redis call fails immediately.
     * Auto-reconnect disabled and timeouts kept short so the failure is fast and the test doesn't
     * leave background reconnect threads spamming logs after the assertion runs.
     */
    private NlqQuotaService newUnreachableService() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration("127.0.0.1", 1);
        ClientOptions clientOptions = ClientOptions.builder()
                .autoReconnect(false)
                .socketOptions(SocketOptions.builder().connectTimeout(Duration.ofMillis(300)).build())
                .build();
        LettuceClientConfiguration clientConfig = LettuceClientConfiguration.builder()
                .clientOptions(clientOptions)
                .commandTimeout(Duration.ofMillis(500))
                .build();
        LettuceConnectionFactory factory = new LettuceConnectionFactory(config, clientConfig);
        factory.setValidateConnection(false);
        factory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(factory);
        template.afterPropertiesSet();
        return new NlqQuotaService(template, MONTHLY_LIMIT, HOURLY_LIMIT);
    }

    @Test
    void underLimits_reservesAndIncrementsTheExactGatewayKey() {
        NlqQuotaService service = newService();
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        service.reserve(tenantId, userId);

        // THIS IS THE GATEWAY SEAM: gateway/.../FeatureFlagGlobalFilter.java:147 reads exactly
        // "nlq_quota:" + tenantId + ":monthly_count" — assert the writer's key matches verbatim.
        assertThat(service.monthlyKey(tenantId)).isEqualTo("nlq_quota:" + tenantId + ":monthly_count");
        assertThat(service.hourlyKey(tenantId, userId))
                .isEqualTo("nlq_quota:" + tenantId + ":" + userId + ":hourly_count");
    }

    @Test
    void atMonthlyLimit_throwsAndRollsBackToExactlyTheLimit() {
        NlqQuotaService service = newService();
        UUID tenantId = UUID.randomUUID();

        // Exhaust the monthly limit with distinct users so hourly never trips first.
        for (int i = 0; i < MONTHLY_LIMIT; i++) {
            service.reserve(tenantId, UUID.randomUUID());
        }

        assertThatThrownBy(() -> service.reserve(tenantId, UUID.randomUUID()))
                .isInstanceOf(QuotaExceededException.class)
                .satisfies(ex -> assertThat(((QuotaExceededException) ex).quota())
                        .isEqualTo(QuotaExceededException.Quota.MONTHLY_TENANT));

        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration(
                REDIS.getHost(), REDIS.getMappedPort(6379));
        LettuceConnectionFactory factory = new LettuceConnectionFactory(config);
        factory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(factory);
        template.afterPropertiesSet();
        String counter = template.opsForValue().get(service.monthlyKey(tenantId));
        assertThat(counter).isEqualTo(String.valueOf(MONTHLY_LIMIT));
    }

    @Test
    void atHourlyUserLimit_throwsNamingTheHourlyQuota() {
        NlqQuotaService service = newService();
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        for (int i = 0; i < HOURLY_LIMIT; i++) {
            service.reserve(tenantId, userId);
        }

        assertThatThrownBy(() -> service.reserve(tenantId, userId))
                .isInstanceOf(QuotaExceededException.class)
                .satisfies(ex -> assertThat(((QuotaExceededException) ex).quota())
                        .isEqualTo(QuotaExceededException.Quota.HOURLY_USER));
    }

    @Test
    void rollback_restoresBothCountersToTheirPreReservationValue() {
        NlqQuotaService service = newService();
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        service.reserve(tenantId, userId);
        service.rollback(tenantId, userId);

        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration(
                REDIS.getHost(), REDIS.getMappedPort(6379));
        LettuceConnectionFactory factory = new LettuceConnectionFactory(config);
        factory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(factory);
        template.afterPropertiesSet();

        assertThat(template.opsForValue().get(service.monthlyKey(tenantId))).isEqualTo("0");
        assertThat(template.opsForValue().get(service.hourlyKey(tenantId, userId))).isEqualTo("0");

        // And the tenant/user can reserve up to the limit again afterwards.
        for (int i = 0; i < HOURLY_LIMIT; i++) {
            service.reserve(tenantId, userId);
        }
        assertThatThrownBy(() -> service.reserve(tenantId, userId))
                .isInstanceOf(QuotaExceededException.class);
    }

    @Test
    void redisUnavailable_failsClosed_doesNotAllowThrough() {
        NlqQuotaService service = newUnreachableService();

        assertThatThrownBy(() -> service.reserve(UUID.randomUUID(), UUID.randomUUID()))
                .isInstanceOf(QuotaServiceUnavailableException.class);
    }
}
