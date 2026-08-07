package io.restaurantos.shared.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.restaurantos.shared.api.GlobalExceptionHandler;
import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.DefaultOpaClient;
import io.restaurantos.shared.authz.OpaClient;
import io.restaurantos.shared.event.EventEnvelopeReader;
import io.restaurantos.shared.event.DomainEventPublisher;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.OutboxRelay;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.feature.FeatureFlagAspect;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.feature.PlatformAdminFeatureResolver;
import io.restaurantos.shared.feature.RedisFeatureFlagService;
import io.restaurantos.shared.feature.TenantFeatureResolver;
import org.springframework.beans.factory.ObjectProvider;
import io.restaurantos.shared.idempotency.DefaultIdempotencyService;
import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.*;
import jakarta.persistence.EntityManager;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.client.RestClient;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Opt-in auto-configuration loaded by every service importing shared-lib.
 * Registered in META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports.
 *
 * Security beans (JwtAuthenticationFilter, JwksKeyProvider) are NOT wired here:
 * they are assembled in Phase 2 (auth-service) per resolved decision #6.
 * Security beans are guarded with @ConditionalOnProperty default OFF.
 */
@AutoConfiguration
@EnableJpaAuditing(auditorAwareRef = "tenantContextAuditorAware")
@EnableScheduling
public class SharedAutoConfiguration implements WebMvcConfigurer {

    // ── Tenant ──────────────────────────────────────────────────────────────

    @Bean
    public TenantContext tenantContext() {
        return new ThreadLocalTenantContext();
    }

    @Bean
    public TenantContextAuditorAware tenantContextAuditorAware(TenantContext tc) {
        return new TenantContextAuditorAware(tc);
    }

    @Bean
    public TenantFilterInterceptor tenantFilterInterceptor(EntityManager em, TenantContext tc) {
        return new TenantFilterInterceptor(em, tc);
    }

    @Bean
    public TenantAwareMessageProcessor tenantAwareMessageProcessor(TenantContext tc, EntityManager em) {
        return new TenantAwareMessageProcessor(tc, em);
    }

    @Bean
    public TenantTaskDecorator tenantTaskDecorator(TenantContext tc) {
        return new TenantTaskDecorator(tc);
    }

    /**
     * Typed, tolerant envelope parsing for {@code @RabbitListener}s, with poison messages routed
     * to the DLQ instead of acked-and-dropped. See {@link EventEnvelopeReader} for why this is a
     * shared bean rather than a per-consumer try/catch.
     */
    @Bean
    public EventEnvelopeReader eventEnvelopeReader(
            @Qualifier("eventObjectMapper") ObjectMapper eventObjectMapper) {
        return new EventEnvelopeReader(eventObjectMapper);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // TenantFilterInterceptor will be added by the service's own @Configuration
        // that @Autowires TenantFilterInterceptor from this auto-config.
    }

    // ── Shared ObjectMapper ─────────────────────────────────────────────────

    @Bean
    @Primary
    public ObjectMapper sharedObjectMapper() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    /**
     * Event-consumption ObjectMapper — a TOLERANT READER for the RabbitMQ event bus. Identical to
     * {@link #sharedObjectMapper()} but with {@code FAIL_ON_UNKNOWN_PROPERTIES} DISABLED, so a
     * consumer whose payload record is a SUBSET of (or lags) the producer's payload ignores
     * unknown/additive fields instead of throwing and silently dropping every message — the class of
     * bug that had ORDER_CLOSED failing on the producer's {@code orderNo} field. Kept SEPARATE from
     * the {@link Primary} mapper on purpose: REST {@code @RequestBody} deserialization stays STRICT
     * (a mistyped API field still 400s). Inject in {@code @RabbitListener} consumers via
     * {@code @Qualifier("eventObjectMapper")}. This does NOT hide breaking changes (renames/type
     * changes) — those still surface, and are caught by the consumer contract/parity ITs.
     */
    @Bean("eventObjectMapper")
    public ObjectMapper eventObjectMapper() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    // ── API / Exception handling ─────────────────────────────────────────────

    @Bean
    public GlobalExceptionHandler globalExceptionHandler() {
        return new GlobalExceptionHandler();
    }

    // ── Feature flags ────────────────────────────────────────────────────────

    /**
     * Source of truth for tenant feature flags. Only registered when the service knows where
     * platform-admin lives; without it {@link RedisFeatureFlagService} falls back to fail-closed.
     */
    @Bean
    @ConditionalOnProperty("restaurantos.platform-admin.uri")
    public TenantFeatureResolver tenantFeatureResolver(
            @Value("${restaurantos.platform-admin.uri}") String platformAdminUri,
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String internalSecret) {
        return new PlatformAdminFeatureResolver(platformAdminUri, internalSecret);
    }

    @Bean
    public FeatureFlagService featureFlagService(
            StringRedisTemplate redis,
            @Value("${restaurantos.feature-flags.cache-ttl-seconds:300}") long ttl,
            ObjectProvider<TenantFeatureResolver> resolver) {
        return new RedisFeatureFlagService(redis, ttl, resolver.getIfAvailable());
    }

    @Bean
    public FeatureFlagAspect featureFlagAspect(FeatureFlagService ffs, TenantContext tc) {
        return new FeatureFlagAspect(ffs, tc);
    }

    // ── OPA (optional in dev — disabled when OPA_URL unset) ──────────────────

    /**
     * The 2-second connect and read budget for every OPA call in the platform.
     *
     * <p>It lives here rather than in a per-service {@code @Configuration} because the alternative
     * was measured and found wanting: authorization-service set this budget in its own
     * {@code OpaConfig}, and pos, inventory and kitchen — which resolve the bean below — had
     * <b>no timeouts at all</b>. {@link DefaultOpaClient} is fail-closed on any exception, so those
     * three denied correctly when OPA <em>refused</em> a connection; a hung OPA is the case with no
     * exception to catch, and an unbounded {@code RestClient} waits for it forever, holding a
     * Tomcat worker per request until the pool is exhausted.
     *
     * <p>Fail-closed therefore has two halves, and only one of them was implemented: deny on error,
     * and <em>bound the time before that error occurs</em>. A policy engine that never answers must
     * be treated as a policy engine that answered "no".
     */
    private static final Duration OPA_TIMEOUT = Duration.ofSeconds(2);

    @Bean
    @ConditionalOnProperty(name = "restaurantos.opa.url", matchIfMissing = false)
    public OpaClient opaClient(@Value("${restaurantos.opa.url}") String opaUrl) {
        return new DefaultOpaClient(opaRestClient(opaUrl));
    }

    /**
     * The {@link AuthorizationService} every direct-OPA service needs, wired once.
     *
     * <p>Each service used to declare this itself, in its own {@code SecurityConfig} — four
     * hand-copied definitions of a two-line bean. That is the mechanism by which enforcement comes
     * to differ between processes: a copy is only identical on the day it is made.
     * {@code @ConditionalOnMissingBean} keeps any service that still declares its own working
     * unchanged, so this is additive.
     */
    @Bean
    @ConditionalOnProperty(name = "restaurantos.opa.url", matchIfMissing = false)
    @ConditionalOnMissingBean(AuthorizationService.class)
    public AuthorizationService authorizationService(OpaClient opaClient) {
        return new AuthorizationService(opaClient);
    }

    /** A {@link RestClient} that cannot be built without the timeout budget applied. */
    private static RestClient opaRestClient(String opaUrl) {
        HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(OPA_TIMEOUT)
            .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(OPA_TIMEOUT);
        return RestClient.builder()
            .baseUrl(opaUrl)
            .requestFactory(factory)
            .build();
    }

    // ── Idempotency ──────────────────────────────────────────────────────────

    @Bean
    public IdempotencyService idempotencyService(IdempotencyKeyRepository repo) {
        return new DefaultIdempotencyService(repo);
    }

    // ── Transactional outbox ─────────────────────────────────────────────────

    /**
     * The service's own name is bound here, once, so no publish call site can get it wrong.
     *
     * <p>{@code spring.application.name} has no default on purpose: every one of the 16 services
     * sets it, and a service that does not is a misconfiguration that should fail at startup rather
     * than publish events the audit trail cannot attribute. See {@link DomainEventPublisher} for the
     * measured consequence of the hardcoded {@code "shared-lib"} this replaces.
     */
    @Bean
    public EventPublisher domainEventPublisher(OutboxRepository repo,
                                               TenantContext tc,
                                               ObjectMapper sharedObjectMapper,
                                               @Value("${spring.application.name}") String serviceName) {
        return new DomainEventPublisher(repo, tc, sharedObjectMapper, serviceName);
    }

    @Bean
    public OutboxRelay outboxRelay(OutboxRepository repo, RabbitTemplate rabbitTemplate) {
        return new OutboxRelay(repo, rabbitTemplate);
    }
}
