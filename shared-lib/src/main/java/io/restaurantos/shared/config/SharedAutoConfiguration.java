package io.restaurantos.shared.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.restaurantos.shared.api.GlobalExceptionHandler;
import io.restaurantos.shared.authz.DefaultOpaClient;
import io.restaurantos.shared.authz.OpaClient;
import io.restaurantos.shared.event.DomainEventPublisher;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.OutboxRelay;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.feature.FeatureFlagAspect;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.feature.RedisFeatureFlagService;
import io.restaurantos.shared.idempotency.DefaultIdempotencyService;
import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.*;
import jakarta.persistence.EntityManager;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.data.redis.core.StringRedisTemplate;
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

    // ── API / Exception handling ─────────────────────────────────────────────

    @Bean
    public GlobalExceptionHandler globalExceptionHandler() {
        return new GlobalExceptionHandler();
    }

    // ── Feature flags ────────────────────────────────────────────────────────

    @Bean
    public FeatureFlagService featureFlagService(
            StringRedisTemplate redis,
            @Value("${restaurantos.feature-flags.cache-ttl-seconds:300}") long ttl) {
        return new RedisFeatureFlagService(redis, ttl);
    }

    @Bean
    public FeatureFlagAspect featureFlagAspect(FeatureFlagService ffs, TenantContext tc) {
        return new FeatureFlagAspect(ffs, tc);
    }

    // ── OPA (optional in dev — disabled when OPA_URL unset) ──────────────────

    @Bean
    @ConditionalOnProperty(name = "restaurantos.opa.url", matchIfMissing = false)
    public OpaClient opaClient(@Value("${restaurantos.opa.url}") String opaUrl) {
        RestClient restClient = RestClient.builder().baseUrl(opaUrl).build();
        return new DefaultOpaClient(restClient);
    }

    // ── Idempotency ──────────────────────────────────────────────────────────

    @Bean
    public IdempotencyService idempotencyService(IdempotencyKeyRepository repo) {
        return new DefaultIdempotencyService(repo);
    }

    // ── Transactional outbox ─────────────────────────────────────────────────

    @Bean
    public EventPublisher domainEventPublisher(OutboxRepository repo,
                                               TenantContext tc,
                                               ObjectMapper sharedObjectMapper) {
        return new DomainEventPublisher(repo, tc, sharedObjectMapper);
    }

    @Bean
    public OutboxRelay outboxRelay(OutboxRepository repo, RabbitTemplate rabbitTemplate) {
        return new OutboxRelay(repo, rabbitTemplate);
    }
}
