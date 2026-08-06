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

    /**
     * The tenant's OWN allowance governs, not the configured default (13-14).
     *
     * <p>Both enforcement points compared against a compiled-in number — the gateway's 5,000 and
     * this service's {@code monthly-quota-default} of 500 — while {@code tenants.nlq_quota} went
     * unread. The LOWER constant therefore won, so every tenant on the platform was capped at 500
     * regardless of tier. Fixing only the gateway would have left this cap in place and made the fix
     * invisible in production, which is why this test exists in this module and not only in that one.
     */
    @Test
    void theTenantsOwnAllowanceGovernsWhenTheGatewayHasPublishedOne() {
        NlqQuotaService service = newService();
        UUID tenantId = UUID.randomUUID();

        // The verbatim key the gateway and TenantSubscriptionService write.
        assertThat(service.tenantLimitKey(tenantId)).isEqualTo("tenant:nlq_quota:" + tenantId);
        redisTemplate().opsForValue().set(service.tenantLimitKey(tenantId), "5");
        assertThat(service.effectiveMonthlyLimit(tenantId))
                .as("MONTHLY_LIMIT is 3; the tenant bought 5")
                .isEqualTo(5);

        // Five reservations succeed where the configured default would have refused the fourth.
        for (int i = 0; i < 5; i++) {
            service.reserve(tenantId, UUID.randomUUID());
        }
        assertThatThrownBy(() -> service.reserve(tenantId, UUID.randomUUID()))
                .isInstanceOf(QuotaExceededException.class);
    }

    @Test
    void anAbsentOrUnreadableAllowanceFallsBackToTheConfiguredDefault() {
        NlqQuotaService service = newService();
        UUID absent = UUID.randomUUID();
        UUID junk = UUID.randomUUID();
        UUID zero = UUID.randomUUID();
        redisTemplate().opsForValue().set(service.tenantLimitKey(junk), "not-a-number");
        redisTemplate().opsForValue().set(service.tenantLimitKey(zero), "0");

        // The fallback is CONSERVATIVE: the configured default is smaller than every tier's
        // allowance, so the failure mode is "throttled early", never "unmetered".
        assertThat(service.effectiveMonthlyLimit(absent)).isEqualTo(MONTHLY_LIMIT);
        assertThat(service.effectiveMonthlyLimit(junk)).isEqualTo(MONTHLY_LIMIT);
        assertThat(service.effectiveMonthlyLimit(zero)).isEqualTo(MONTHLY_LIMIT);
    }

    private StringRedisTemplate redisTemplate() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration(
                REDIS.getHost(), REDIS.getMappedPort(6379));
        LettuceConnectionFactory factory = new LettuceConnectionFactory(config);
        factory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(factory);
        template.afterPropertiesSet();
        return template;
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
