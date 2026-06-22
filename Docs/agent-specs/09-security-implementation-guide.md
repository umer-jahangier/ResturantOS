# RestaurantOS — Document 9: Security Implementation Guide

> Concrete implementation patterns for auth and authorisation. Agents MUST NOT invent their own JWT filter, OPA integration, or tenant filter — use these patterns. All code is Java 21 / Spring Security 6 / Spring Boot 3.3.5.

## 9.1 Spring Security Filter Chain

Stateless API: no sessions, no login redirects. 401/403 are returned as JSON `ApiError` bodies. Filter order: CORS → JWT validation → tenant context → (OPA is invoked in service code, not as a global filter).

```java
package io.restaurantos.shared.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter) { this.jwtAuthenticationFilter = jwtAuthenticationFilter; }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/actuator/prometheus", "/.well-known/jwks.json").permitAll()
                .requestMatchers("/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/reset-password/**").permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, res, e) -> writeError(res, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED"))
                .accessDeniedHandler((req, res, e) -> writeError(res, HttpStatus.FORBIDDEN, "PERMISSION_DENIED")));
        return http.build();
    }

    private void writeError(jakarta.servlet.http.HttpServletResponse res, HttpStatus status, String code) throws java.io.IOException {
        res.setStatus(status.value());
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"" + code + "\"}}");
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(List.of("https://*.restaurantos.io", "http://localhost:3000"));
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key", "If-Match", "X-Request-Id"));
        config.setExposedHeaders(List.of("X-Upgrade-CTA-URL", "X-Quota-Resource", "X-Quota-Warning"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", config);
        return src;
    }
}
```

The `TenantFilterInterceptor` (HTTP tenant filter + RLS) is registered as a Spring MVC interceptor, after the JWT filter has populated `TenantContext`.

## 9.2 JWT Validation Filter

Verifies RS256 signature against the Auth Service JWKS (cached at startup, 1-hour TTL), checks expiry, builds the `Authentication`, and populates `TenantContext` + MDC. Cleared in `finally`.

```java
package io.restaurantos.shared.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.security.PublicKey;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwksKeyProvider keyProvider;
    private final TenantContext tenantContext;

    public JwtAuthenticationFilter(JwksKeyProvider keyProvider, TenantContext tenantContext) {
        this.keyProvider = keyProvider;
        this.tenantContext = tenantContext;
    }

    @Override
    @SuppressWarnings("unchecked")
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            chain.doFilter(request, response);
            return;
        }
        String token = header.substring(7);
        try {
            String kid = JwtClaims.peekKid(token);
            PublicKey publicKey = keyProvider.getKey(kid);

            Jws<Claims> jws = Jwts.parser().verifyWith(publicKey).build().parseSignedClaims(token);
            Claims c = jws.getPayload();

            UUID userId = UUID.fromString(c.getSubject());
            UUID tenantId = c.get("tenant_id") != null ? UUID.fromString(c.get("tenant_id", String.class)) : null;
            UUID branchId = c.get("branch_id") != null ? UUID.fromString(c.get("branch_id", String.class)) : null;
            UUID impersonatedBy = c.get("impersonated_by") != null ? UUID.fromString(c.get("impersonated_by", String.class)) : null;
            List<String> roles = c.get("roles", List.class);
            List<String> permissions = c.get("permissions", List.class);
            Map<String, Object> attributes = c.get("attributes", Map.class);

            var authorities = permissions == null ? List.<SimpleGrantedAuthority>of()
                : permissions.stream().map(SimpleGrantedAuthority::new).toList();
            var authentication = new UsernamePasswordAuthenticationToken(
                new JwtClaims(userId, tenantId, branchId, roles, permissions, attributes, impersonatedBy), null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);

            tenantContext.set(tenantId, branchId, userId, impersonatedBy);
            if (tenantId != null) MDC.put("tenantId", tenantId.toString());
            String traceId = request.getHeader("X-Request-Id");
            MDC.put("traceId", traceId != null ? traceId : UUID.randomUUID().toString());

            chain.doFilter(request, response);
        } catch (Exception e) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":{\"code\":\"UNAUTHENTICATED\",\"message\":\"Invalid token\"}}");
        } finally {
            tenantContext.clear();
            MDC.clear();
        }
    }
}
```

```java
package io.restaurantos.shared.security;

import java.security.PublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Fetches the JWKS once at startup and refreshes every 3600s. Keyed by 'kid'. */
public class JwksKeyProvider {

    private final String jwksUrl;
    private final org.springframework.web.client.RestClient restClient;
    private final Map<String, PublicKey> cache = new ConcurrentHashMap<>();
    private volatile Instant lastFetch = Instant.EPOCH;
    private static final Duration TTL = Duration.ofSeconds(3600);

    public JwksKeyProvider(String jwksUrl, org.springframework.web.client.RestClient restClient) {
        this.jwksUrl = jwksUrl; this.restClient = restClient;
    }

    public PublicKey getKey(String kid) {
        if (Instant.now().isAfter(lastFetch.plus(TTL)) || !cache.containsKey(kid)) refresh();
        PublicKey key = cache.get(kid);
        if (key == null) throw new IllegalStateException("Unknown JWT kid: " + kid);
        return key;
    }

    private synchronized void refresh() {
        // Parse {"keys":[{"kid":...,"n":...,"e":...}]} into PublicKeys (use nimbus-jose-jwt JWKSet.load in prod).
        lastFetch = Instant.now();
    }
}
```

```java
package io.restaurantos.shared.security;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record JwtClaims(UUID subject, UUID tenantId, UUID branchId,
                        List<String> roles, List<String> permissions,
                        Map<String, Object> attributes, UUID impersonatedBy) {
    public static String peekKid(String token) {
        String headerJson = new String(java.util.Base64.getUrlDecoder().decode(token.substring(0, token.indexOf('.'))));
        int i = headerJson.indexOf("\"kid\":\"") + 7;
        return headerJson.substring(i, headerJson.indexOf('"', i));
    }
}
```

## 9.3 Tenant Context Propagation

The HTTP interceptor enables the Hibernate filter and sets the RLS session variable:

```java
package io.restaurantos.shared.tenant;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hibernate.Session;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

public class TenantFilterInterceptor implements HandlerInterceptor {
    private final EntityManager entityManager;
    private final TenantContext tenantContext;
    public TenantFilterInterceptor(EntityManager em, TenantContext tc) { this.entityManager = em; this.tenantContext = tc; }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (tenantContext.getTenantId().isEmpty()) return true;
        UUID tenantId = tenantContext.requireTenantId();
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString()).getSingleResult();
        return true;
    }
}
```

Async propagation (`@Async`):

```java
package io.restaurantos.shared.tenant;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskDecorator;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
public class AsyncTenantConfig {
    @Bean
    public TaskDecorator tenantTaskDecorator(TenantContext tc) {
        return runnable -> {
            TenantContext.TenantSnapshot snap = tc.snapshot();
            return () -> { try { tc.restore(snap); runnable.run(); } finally { tc.clear(); } };
        };
    }
    @Bean
    public ThreadPoolTaskExecutor taskExecutor(TaskDecorator tenantTaskDecorator) {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setTaskDecorator(tenantTaskDecorator);
        ex.setCorePoolSize(4); ex.setMaxPoolSize(16); ex.initialize();
        return ex;
    }
}
```

RabbitMQ consumers — the standard pattern (CRIT-01 fix). The consumer never queries entities directly; it delegates to `TenantAwareMessageProcessor`:

```java
package io.restaurantos.inventory.event.listener;

import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import lombok.RequiredArgsConstructor;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class OrderClosedEventListener {
    private final TenantAwareMessageProcessor processor;
    private final DepletionService depletionService;

    @RabbitListener(queues = "inventory.order-closed.queue")
    public void onOrderClosed(EventEnvelope<OrderClosedPayload> envelope) {
        processor.process(envelope, env -> depletionService.deplete(env.payload(), env.eventId()));
    }
}
```

```java
package io.restaurantos.shared.tenant;

import io.restaurantos.shared.event.EventEnvelope;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.hibernate.Session;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
public class TenantAwareMessageProcessor {
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    @Transactional
    public <T> void process(EventEnvelope<T> envelope, Consumer<EventEnvelope<T>> handler) {
        UUID tenantId = envelope.tenantId();
        try {
            tenantContext.set(tenantId, envelope.branchId(), null, null);
            Session session = entityManager.unwrap(Session.class);
            session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
            entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", tenantId.toString()).getSingleResult();
            handler.accept(envelope);
        } finally {
            tenantContext.clear();
        }
    }
}
```

## 9.4 OPA Integration Pattern

`AuthorizationService` builds the OPA input, calls OPA, and denies on any failure (BLR-5). Branch isolation is enforced in every policy (resolves MAJOR-11).

```java
package io.restaurantos.shared.authz;

import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.Instant;

@Service
@RequiredArgsConstructor
public class AuthorizationService {
    private final OpaClient opaClient;

    public void authorize(String module, String action, OpaInput.Resource resource) {
        JwtClaims claims = (JwtClaims) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        OpaInput input = OpaInput.builder()
            .user(new OpaInput.User(claims.subject(), claims.tenantId(), claims.branchId(), claims.permissions(), claims.attributes()))
            .resource(resource)
            .action(action)
            .environment(new OpaInput.Environment(Instant.now(), null))
            .build();
        if (!opaClient.evaluate(module, input).allow()) {
            throw new PermissionDeniedException("Not permitted: " + module + "." + action);
        }
    }
}
```

Standard Rego structure. `policies/restaurantos/common.rego`:

```rego
package restaurantos.common

same_tenant_and_branch(input) {
    input.resource.tenant_id == input.user.tenant_id
    input.resource.branch_id == input.user.branch_id
}

same_tenant(input) {
    input.resource.tenant_id == input.user.tenant_id
}

has_permission(input, perm) {
    input.user.permissions[_] == perm
}
```

`policies/restaurantos/pos.rego`:

```rego
package restaurantos.pos

import data.restaurantos.common

default allow = false

allow {
    common.has_permission(input, "pos.order.void.own")
    input.resource.created_by == input.user.id
    input.resource.status == "OPEN"
    common.same_tenant_and_branch(input)
}

allow {
    common.has_permission(input, "pos.order.void.any")
    common.same_tenant_and_branch(input)
}
```

`policies/restaurantos/finance.rego` (WITH branch isolation — the MAJOR-11 fix; tenant-wide actions are an explicit exception):

```rego
package restaurantos.finance

import data.restaurantos.common

default allow = false

allow {
    input.action == "approve"
    common.has_permission(input, "finance.expense.approve")
    common.same_tenant_and_branch(input)
    input.resource.amount_paisa <= input.user.attributes.approval_limit_paisa
}

allow {
    input.action == "close_period"
    common.has_permission(input, "finance.period.close")
    common.same_tenant(input)
}
```

## 9.5 Field-Level Encryption

AES-256-GCM, key from Vault via `FIELD_ENCRYPTION_KEY`, with a JPA `AttributeConverter`:

```java
package io.restaurantos.shared.security;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.Base64;

public class EncryptionService {
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_BITS = 128;
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public EncryptionService(String base64Key) { this.key = new SecretKeySpec(Base64.getDecoder().decode(base64Key), "AES"); }

    public byte[] encrypt(String plaintext) {
        if (plaintext == null) return null;
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct).array();
        } catch (Exception e) { throw new IllegalStateException("Encryption failed", e); }
    }

    public String decrypt(byte[] ciphertext) {
        if (ciphertext == null) return null;
        try {
            ByteBuffer bb = ByteBuffer.wrap(ciphertext);
            byte[] iv = new byte[GCM_IV_LENGTH];
            bb.get(iv);
            byte[] ct = new byte[bb.remaining()];
            bb.get(ct);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(ct), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("Decryption failed", e); }
    }
}
```

```java
package io.restaurantos.shared.security;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class EncryptedStringConverter implements AttributeConverter<String, byte[]> {
    private static EncryptionService encryptionService;
    public static void init(EncryptionService svc) { encryptionService = svc; }
    @Override public byte[] convertToDatabaseColumn(String attribute) { return encryptionService.encrypt(attribute); }
    @Override public String convertToEntityAttribute(byte[] dbData) { return encryptionService.decrypt(dbData); }
}
```

Usage:

```java
@Convert(converter = EncryptedStringConverter.class)
@Column(name = "cnic", columnDefinition = "bytea")
private String cnic;
```

Fields requiring this (spec CC.1): `users.totp_secret` (Auth), `employees.cnic` (HR), `employees.bank_account_no` (HR), `vendors.bank_account_no` (Purchasing).

## 9.6 Rate Limiting Configuration

Spring Cloud Gateway Redis token-bucket. Auth route: 100 req/min/IP; general API: 600 req/min/IP.

`gateway/src/main/resources/application.yml`:

```yaml
spring:
  cloud:
    gateway:
      default-filters:
        - name: RequestRateLimiter
          args:
            redis-rate-limiter.replenishRate: 10
            redis-rate-limiter.burstCapacity: 600
            key-resolver: "#{@ipKeyResolver}"
      routes:
        - id: auth-route
          uri: lb://auth-service
          predicates:
            - Path=/api/v1/auth/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 2
                redis-rate-limiter.burstCapacity: 100
                key-resolver: "#{@ipKeyResolver}"
        - id: pos-route
          uri: lb://pos-service
          predicates:
            - Path=/api/v1/pos/**, /api/v1/orders/**
```

```java
package io.restaurantos.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Mono;

@Configuration
public class RateLimitConfig {
    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> {
            String xff = exchange.getRequest().getHeaders().getFirst("X-Forwarded-For");
            String ip = xff != null ? xff.split(",")[0].trim()
                : exchange.getRequest().getRemoteAddress().getAddress().getHostAddress();
            return Mono.just(ip);
        };
    }
}
```
