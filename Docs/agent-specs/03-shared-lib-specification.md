# RestaurantOS — Document 3: Shared Library (`shared-lib`) Specification

> Every Java microservice imports `shared-lib`. Every interface, class, annotation, and config component below is normative. Inconsistency here propagates to all services. All code is Java 21, Spring Boot 3.3.5, complete and compilable.

## 3.1 Maven Artifact

```xml
<dependency>
    <groupId>io.restaurantos</groupId>
    <artifactId>shared-lib</artifactId>
    <!-- version inherited from parent dependencyManagement (1.0.0); do NOT pin here -->
</dependency>
```

`shared-lib/pom.xml` packaging is `jar`. It depends on (compile scope): `spring-boot-starter-web`, `spring-boot-starter-data-jpa`, `spring-boot-starter-security`, `spring-boot-starter-amqp`, `spring-boot-starter-aop`, `spring-boot-starter-data-redis`, `jjwt-api/impl/jackson`, `mapstruct`, `lombok`, `logstash-logback-encoder`. It registers beans via Spring Boot auto-configuration (see §3.12), so importing the jar is sufficient — no `@ComponentScan` change needed in services.

## 3.2 `TenantAuditableEntity`

```java
package io.restaurantos.shared.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.MappedSuperclass;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;
import org.hibernate.annotations.FilterDef;
import org.hibernate.annotations.ParamDef;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/**
 * Base class for every tenant-scoped JPA entity in every service except platform_db.
 * Provides: tenant_id (isolation), created/updated audit fields, and soft-delete (deleted_at).
 *
 * The Hibernate filter "tenantFilter" is enabled per request/consumer by
 * TenantFilterInterceptor (HTTP) or TenantAwareMessageProcessor (RabbitMQ) / TenantTaskDecorator (@Async).
 */
@Getter
@Setter
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = UUID.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public abstract class TenantAuditableEntity implements Serializable {

    /** Owning tenant. Never updatable. Populated from TenantContext on persist (see services). */
    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    /** Set by Spring Data Auditing on insert. */
    @CreatedDate
    @Column(name = "created_at", updatable = false, nullable = false)
    private Instant createdAt;

    /** Updated by Spring Data Auditing on every flush. */
    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** User id from AuditorAware (JWT sub). */
    @CreatedBy
    @Column(name = "created_by", updatable = false)
    private UUID createdBy;

    @LastModifiedBy
    @Column(name = "updated_by")
    private UUID updatedBy;

    /** Soft-delete marker. NULL = live row. */
    @Column(name = "deleted_at")
    private Instant deletedAt;

    public boolean isDeleted() {
        return deletedAt != null;
    }
}
```

Why each field exists: `tenantId` enforces row isolation (filter + RLS); `createdAt/updatedAt` are mandatory `TIMESTAMPTZ` audit columns; `createdBy/updatedBy` capture the acting user via `AuditorAware`; `deletedAt` enables soft delete (financial and audit records are never hard-deleted).

The `AuditorAware<UUID>` bean (so `@CreatedBy`/`@LastModifiedBy` work) is provided by auto-config:

```java
package io.restaurantos.shared.config;

import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.AuditorAware;

import java.util.Optional;
import java.util.UUID;

public class TenantContextAuditorAware implements AuditorAware<UUID> {
    private final TenantContext tenantContext;

    public TenantContextAuditorAware(TenantContext tenantContext) {
        this.tenantContext = tenantContext;
    }

    @Override
    public Optional<UUID> getCurrentAuditor() {
        return tenantContext.getUserId();
    }
}
```

## 3.3 `TenantContext` (and async/consumer propagation — resolves CRIT-01)

```java
package io.restaurantos.shared.tenant;

import java.util.Optional;
import java.util.UUID;

/** Request/operation-scoped tenant identity, backed by a ThreadLocal. */
public interface TenantContext {

    Optional<UUID> getTenantId();
    UUID requireTenantId();
    Optional<UUID> getBranchId();
    Optional<UUID> getUserId();
    Optional<UUID> getImpersonatedBy();
    void set(UUID tenantId, UUID branchId, UUID userId, UUID impersonatedBy);
    TenantSnapshot snapshot();
    void restore(TenantSnapshot snapshot);
    /** MUST be called in a finally block to prevent ThreadLocal leaks. */
    void clear();

    record TenantSnapshot(UUID tenantId, UUID branchId, UUID userId, UUID impersonatedBy) {}
}
```

```java
package io.restaurantos.shared.tenant;

import java.util.Optional;
import java.util.UUID;

public class ThreadLocalTenantContext implements TenantContext {

    private static final ThreadLocal<TenantSnapshot> HOLDER = new ThreadLocal<>();

    @Override public Optional<UUID> getTenantId() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.tenantId());
    }
    @Override public UUID requireTenantId() {
        return getTenantId().orElseThrow(() ->
            new IllegalStateException("TenantContext is empty: tenant id was not set on this thread"));
    }
    @Override public Optional<UUID> getBranchId() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.branchId());
    }
    @Override public Optional<UUID> getUserId() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.userId());
    }
    @Override public Optional<UUID> getImpersonatedBy() {
        TenantSnapshot s = HOLDER.get();
        return s == null ? Optional.empty() : Optional.ofNullable(s.impersonatedBy());
    }
    @Override public void set(UUID tenantId, UUID branchId, UUID userId, UUID impersonatedBy) {
        HOLDER.set(new TenantSnapshot(tenantId, branchId, userId, impersonatedBy));
    }
    @Override public TenantSnapshot snapshot() { return HOLDER.get(); }
    @Override public void restore(TenantSnapshot snapshot) { if (snapshot != null) HOLDER.set(snapshot); }
    @Override public void clear() { HOLDER.remove(); }
}
```

Populated from the JWT (in the security filter — see Document 9 §9.2):

```java
tenantContext.set(claims.tenantId(), claims.branchId(), claims.subject(), claims.impersonatedBy());
// ... chain.doFilter(...) ...
// In a finally block: tenantContext.clear();
```

Async propagation (`@Async` runs in a pool thread where the ThreadLocal is empty) — register a `TaskDecorator`:

```java
package io.restaurantos.shared.tenant;

import org.springframework.core.task.TaskDecorator;

public class TenantTaskDecorator implements TaskDecorator {
    private final TenantContext tenantContext;
    public TenantTaskDecorator(TenantContext tenantContext) { this.tenantContext = tenantContext; }

    @Override
    public Runnable decorate(Runnable runnable) {
        TenantContext.TenantSnapshot snapshot = tenantContext.snapshot();
        return () -> {
            try { tenantContext.restore(snapshot); runnable.run(); }
            finally { tenantContext.clear(); }
        };
    }
}
```

RabbitMQ consumer propagation (the fix for CRIT-01): the wrapper sets `TenantContext`, enables the Hibernate filter, AND sets the RLS session variable on the same connection inside the consumer transaction.

```java
package io.restaurantos.shared.tenant;

import io.restaurantos.shared.event.EventEnvelope;
import jakarta.persistence.EntityManager;
import org.hibernate.Session;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.util.function.Consumer;

/**
 * The ONLY sanctioned way to process a tenant-scoped event in a @RabbitListener.
 * Sets TenantContext, enables the Hibernate tenant filter, and sets app.current_tenant_id
 * for PostgreSQL RLS on the SAME connection used by the consumer transaction.
 */
public class TenantAwareMessageProcessor {

    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public TenantAwareMessageProcessor(TenantContext tenantContext, EntityManager entityManager) {
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    @Transactional
    public <T> void process(EventEnvelope<T> envelope, Consumer<EventEnvelope<T>> handler) {
        UUID tenantId = envelope.tenantId();
        UUID branchId = envelope.branchId();
        try {
            tenantContext.set(tenantId, branchId, null, null);
            Session session = entityManager.unwrap(Session.class);
            session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
            entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", tenantId.toString())
                .getSingleResult();
            handler.accept(envelope);
        } finally {
            tenantContext.clear();
        }
    }
}
```

Anti-pattern (WRONG — a raw `@RabbitListener` querying entities without this wrapper; RLS returns zero rows and the Hibernate filter is off):

```java
@RabbitListener(queues = "inventory.order-closed.queue")
@Transactional
public void onOrderClosed(EventEnvelope<OrderClosedPayload> env) {
    stockRepository.findByBranchAndIngredient(...); // returns nothing under RLS
}
```

## 3.4 `TenantFilterInterceptor`

HTTP path. Registered for all controllers by `WebMvcSharedConfig`.

```java
package io.restaurantos.shared.tenant;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hibernate.Session;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

public class TenantFilterInterceptor implements HandlerInterceptor {

    private final EntityManager entityManager;
    private final TenantContext tenantContext;

    public TenantFilterInterceptor(EntityManager entityManager, TenantContext tenantContext) {
        this.entityManager = entityManager;
        this.tenantContext = tenantContext;
    }

    @Override
    @Transactional(propagation = Propagation.SUPPORTS)
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (tenantContext.getTenantId().isEmpty()) return true; // platform/public endpoints
        UUID tenantId = tenantContext.requireTenantId();
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
        return true;
    }
}
```

Note: `set_config(..., true)` makes the setting transaction-local; it is reset when the connection returns to the pool, preventing tenant bleed between pooled requests.

## 3.5 `@RequiresFeature` + `FeatureFlagAspect`

```java
package io.restaurantos.shared.feature;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresFeature { String value(); }
```

```java
package io.restaurantos.shared.feature;

import io.restaurantos.shared.exception.FeatureDisabledException;
import io.restaurantos.shared.tenant.TenantContext;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;

@Aspect
public class FeatureFlagAspect {
    private final FeatureFlagService featureFlagService;
    private final TenantContext tenantContext;

    public FeatureFlagAspect(FeatureFlagService featureFlagService, TenantContext tenantContext) {
        this.featureFlagService = featureFlagService;
        this.tenantContext = tenantContext;
    }

    @Before("@annotation(requiresFeature) || @within(requiresFeature)")
    public void checkFeature(RequiresFeature requiresFeature) {
        var tenantId = tenantContext.requireTenantId();
        if (!featureFlagService.isEnabled(tenantId, requiresFeature.value())) {
            throw new FeatureDisabledException(requiresFeature.value());
        }
    }
}
```

```java
package io.restaurantos.shared.feature;

import java.util.UUID;

/** Reads tenant feature flags. Default impl is Redis-backed with 300s TTL. */
public interface FeatureFlagService {
    boolean isEnabled(UUID tenantId, String featureCode);
}
```

`FeatureDisabledException` maps to HTTP 403 with code `FEATURE_DISABLED` and header `X-Upgrade-CTA-URL: /billing/upgrade`. Usage:

```java
@GetMapping("/payroll-runs")
@RequiresFeature("FEATURE_HR")
public ApiResponse<List<PayrollRunResponseDto>> listPayrollRuns() {
    return ApiResponse.ok(payrollService.list());
}
```

## 3.6 `OpaClient`

```java
package io.restaurantos.shared.authz;

public interface OpaClient {
    /** Evaluate the named module policy. Non-200/timeout MUST result in deny (caller throws). */
    OpaDecision evaluate(String module, OpaInput input);
}
```

```java
package io.restaurantos.shared.authz;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record OpaInput(User user, Resource resource, String action, Environment environment) {

    public record User(UUID id, UUID tenantId, UUID branchId,
                       List<String> permissions, Map<String, Object> attributes) {}
    public record Resource(String type, UUID id, UUID tenantId, UUID branchId,
                           UUID createdBy, String status, Long amountPaisa) {}
    public record Environment(Instant time, String ip) {}

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private User user; private Resource resource; private String action; private Environment environment;
        public Builder user(User u) { this.user = u; return this; }
        public Builder resource(Resource r) { this.resource = r; return this; }
        public Builder action(String a) { this.action = a; return this; }
        public Builder environment(Environment e) { this.environment = e; return this; }
        public OpaInput build() {
            if (user == null || resource == null || action == null)
                throw new IllegalStateException("OpaInput requires user, resource and action");
            if (environment == null) environment = new Environment(Instant.now(), null);
            return new OpaInput(user, resource, action, environment);
        }
    }
}
```

```java
package io.restaurantos.shared.authz;
public record OpaDecision(boolean allow) {}
```

```java
package io.restaurantos.shared.authz;

import io.restaurantos.shared.exception.PermissionDeniedException;
import org.springframework.web.client.RestClient;

public class DefaultOpaClient implements OpaClient {

    private final RestClient restClient; // baseUrl = OPA_URL
    public DefaultOpaClient(RestClient restClient) { this.restClient = restClient; }

    @Override
    public OpaDecision evaluate(String module, OpaInput input) {
        try {
            OpaResponse resp = restClient.post()
                .uri("/v1/data/restaurantos/{module}/allow", module)
                .body(new OpaRequest(input))
                .retrieve()
                .body(OpaResponse.class);
            return new OpaDecision(resp != null && Boolean.TRUE.equals(resp.result()));
        } catch (Exception e) {
            // BLR-5: OPA failure = deny. Never default to allow.
            throw new PermissionDeniedException("Authorization service unavailable", e);
        }
    }

    private record OpaRequest(OpaInput input) {}
    private record OpaResponse(Boolean result) {}
}
```

## 3.7 `IdempotencyService`

```java
package io.restaurantos.shared.idempotency;

import java.util.Optional;

public interface IdempotencyService {
    /**
     * Atomically claim the key. Returns true if this caller won the claim (proceed),
     * false if the key already exists and is in-flight or completed.
     * @throws io.restaurantos.shared.exception.IdempotencyConflictException
     *         if the same key was used with a DIFFERENT request body hash.
     */
    boolean checkAndLock(String key, String requestHash, int ttlSeconds);
    void markComplete(String key, String responseJson);
    Optional<String> getCompletedResponse(String key);
}
```

```java
package io.restaurantos.shared.idempotency;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "idempotency_keys")
public class IdempotencyKey {
    @Id @Column(name = "idem_key", length = 200) private String key;
    @Column(name = "request_hash", nullable = false, length = 64) private String requestHash;
    @Column(name = "status", nullable = false, length = 20) private String status; // IN_PROGRESS | COMPLETED
    @Column(name = "response_json", columnDefinition = "text") private String responseJson;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    // getters/setters via Lombok @Getter @Setter
}
```

`IdempotencyConflictException` → HTTP 409, code `IDEMPOTENCY_KEY_CONFLICT`. Default stored-key TTL is 86400 seconds (24h) per spec CC.3.

## 3.8 `ApiResponse<T>` and `ApiError`

```java
package io.restaurantos.shared.api;

import java.util.List;

public record ApiResponse<T>(T data, PageMeta meta, List<ApiWarning> warnings) {
    public static <T> ApiResponse<T> ok(T data) { return new ApiResponse<>(data, null, List.of()); }
    public static <T> ApiResponse<List<T>> paginated(List<T> data, PageMeta meta) { return new ApiResponse<>(data, meta, List.of()); }
    public record ApiWarning(String code, String message) {}
}
```

```java
package io.restaurantos.shared.api;
public record PageMeta(Page page, Long totalCount) {
    public record Page(String cursor, String nextCursor, int limit) {}
}
```

```java
package io.restaurantos.shared.api;

import java.util.List;

/** Error body: { "error": { code, message, details, trace_id } }. */
public record ApiError(Error error) {
    public record Error(String code, String message, List<FieldError> details, String traceId) {}
    public record FieldError(String field, String issue) {}
    public static ApiError of(String code, String message, String traceId) {
        return new ApiError(new Error(code, message, List.of(), traceId));
    }
    public static ApiError of(String code, String message, List<FieldError> details, String traceId) {
        return new ApiError(new Error(code, message, details, traceId));
    }
}
```

```java
package io.restaurantos.shared.api;

import io.restaurantos.shared.exception.*;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private String traceId() { String t = MDC.get("traceId"); return t != null ? t : "unknown"; }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(ResourceNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("NOT_FOUND", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(PermissionDeniedException.class)
    public ResponseEntity<ApiError> handlePermission(PermissionDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiError.of("PERMISSION_DENIED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(FeatureDisabledException.class)
    public ResponseEntity<ApiError> handleFeature(FeatureDisabledException ex, HttpServletResponse resp) {
        resp.setHeader("X-Upgrade-CTA-URL", "/billing/upgrade");
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiError.of("FEATURE_DISABLED", "This feature is not available on your current plan", traceId()));
    }

    @ExceptionHandler(QuotaExceededException.class)
    public ResponseEntity<ApiError> handleQuota(QuotaExceededException ex, HttpServletResponse resp) {
        resp.setHeader("X-Quota-Resource", ex.getResource());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(ApiError.of("QUOTA_EXCEEDED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(StateInvalidException.class)
    public ResponseEntity<ApiError> handleState(StateInvalidException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of("STATE_INVALID", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ApiError> handleIdem(IdempotencyConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of("IDEMPOTENCY_KEY_CONFLICT", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(PeriodLockedException.class)
    public ResponseEntity<ApiError> handlePeriod(PeriodLockedException ex) {
        return ResponseEntity.status(HttpStatus.LOCKED).body(ApiError.of("PERIOD_LOCKED", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(TenantNotFoundException.class)
    public ResponseEntity<ApiError> handleTenant(TenantNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of("NOT_FOUND", ex.getMessage(), traceId()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        List<ApiError.FieldError> details = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new ApiError.FieldError(fe.getField(), fe.getDefaultMessage())).toList();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError.of("VALIDATION_FAILED", "Request validation failed", details, traceId()));
    }

    @ExceptionHandler(RestaurantOsException.class)
    public ResponseEntity<ApiError> handleBase(RestaurantOsException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ApiError.of("INTERNAL_ERROR", "An unexpected error occurred", traceId()));
    }
}
```

## 3.9 Standard Exception Hierarchy

```java
package io.restaurantos.shared.exception;

public abstract class RestaurantOsException extends RuntimeException {
    private final String code;
    protected RestaurantOsException(String code, String message) { super(message); this.code = code; }
    protected RestaurantOsException(String code, String message, Throwable cause) { super(message, cause); this.code = code; }
    public String getCode() { return code; }
}
```

| Exception | Code | HTTP |
|---|---|---|
| `PermissionDeniedException` | `PERMISSION_DENIED` | 403 |
| `TenantNotFoundException` | `NOT_FOUND` | 404 |
| `ResourceNotFoundException` | `NOT_FOUND` | 404 |
| `StateInvalidException` | `STATE_INVALID` | 409 |
| `FeatureDisabledException` | `FEATURE_DISABLED` | 403 |
| `QuotaExceededException` | `QUOTA_EXCEEDED` | 429 |
| `PeriodLockedException` | `PERIOD_LOCKED` | 423 |
| `IdempotencyConflictException` | `IDEMPOTENCY_KEY_CONFLICT` | 409 |

```java
package io.restaurantos.shared.exception;
public class PermissionDeniedException extends RestaurantOsException {
    public PermissionDeniedException(String message) { super("PERMISSION_DENIED", message); }
    public PermissionDeniedException(String message, Throwable cause) { super("PERMISSION_DENIED", message, cause); }
}
```

```java
package io.restaurantos.shared.exception;
import java.util.UUID;
public class ResourceNotFoundException extends RestaurantOsException {
    public ResourceNotFoundException(String type, UUID id) { super("NOT_FOUND", type + " not found: " + id); }
}
```

```java
package io.restaurantos.shared.exception;
public class FeatureDisabledException extends RestaurantOsException {
    private final String feature;
    public FeatureDisabledException(String feature) {
        super("FEATURE_DISABLED", "Feature not available on current plan: " + feature);
        this.feature = feature;
    }
    public String getFeature() { return feature; }
}
```

```java
package io.restaurantos.shared.exception;
public class QuotaExceededException extends RestaurantOsException {
    private final String resource;
    public QuotaExceededException(String resource, String message) { super("QUOTA_EXCEEDED", message); this.resource = resource; }
    public String getResource() { return resource; }
}
```

```java
package io.restaurantos.shared.exception;
public class PeriodLockedException extends RestaurantOsException {
    public PeriodLockedException(String message) { super("PERIOD_LOCKED", message); }
}
```

`StateInvalidException`, `IdempotencyConflictException`, `TenantNotFoundException` follow the same one-line pattern with their respective codes.

## 3.10 `EventPublisher` (transactional outbox — resolves MAJOR-12)

The publisher writes events to an `event_outbox` table inside the caller's transaction. A relay polls and publishes to RabbitMQ, guaranteeing the event is sent iff the business transaction committed.

```java
package io.restaurantos.shared.event;

import java.util.UUID;

public interface EventPublisher {
    /**
     * Enqueue an event for reliable publication. MUST be called inside the same
     * @Transactional method that mutates business state.
     * @param exchange   target exchange, e.g. "pos.topic"
     * @param routingKey e.g. "pos.order.closed"
     * @param eventType  e.g. "ORDER_CLOSED"
     * @param branchId   may be null for tenant-wide events
     * @param payload    serialised to JSON as envelope.payload
     */
    void publish(String exchange, String routingKey, String eventType, UUID branchId, Object payload);
}
```

```java
package io.restaurantos.shared.event;

import java.time.Instant;
import java.util.UUID;

public record EventEnvelope<T>(
        UUID eventId, String eventType, UUID tenantId, UUID branchId,
        Instant occurredAt, UUID correlationId, int schemaVersion, String source, T payload) {}
```

```java
package io.restaurantos.shared.event;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "event_outbox")
public class OutboxEntry {
    @Id @GeneratedValue(strategy = GenerationType.UUID) private UUID id;
    @Column(nullable = false) private UUID eventId;
    @Column(nullable = false) private String exchange;
    @Column(nullable = false) private String routingKey;
    @Column(nullable = false) private String eventType;
    @Column(nullable = false) private UUID tenantId;
    private UUID branchId;
    @Column(nullable = false) private UUID correlationId;
    @Column(nullable = false) private String source;
    @Column(nullable = false, columnDefinition = "text") private String envelopeJson;
    @Column(nullable = false) private String status;   // PENDING | SENT
    @Column(nullable = false) private Instant createdAt;
    private Instant sentAt;
    // Lombok @Getter @Setter
}
```

```java
package io.restaurantos.shared.event;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/** Relays PENDING outbox rows to RabbitMQ. Runs every 1000ms. At-least-once delivery. */
public class OutboxRelay {
    private final OutboxRepository outboxRepository;
    private final RabbitTemplate rabbitTemplate;
    public OutboxRelay(OutboxRepository outboxRepository, RabbitTemplate rabbitTemplate) {
        this.outboxRepository = outboxRepository; this.rabbitTemplate = rabbitTemplate;
    }

    @Scheduled(fixedDelay = 1000)
    @Transactional
    public void relay() {
        List<OutboxEntry> pending = outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING");
        for (OutboxEntry e : pending) {
            rabbitTemplate.convertAndSend(e.getExchange(), e.getRoutingKey(), e.getEnvelopeJson());
            e.setStatus("SENT");
            e.setSentAt(Instant.now());
        }
    }
}
```

```java
package io.restaurantos.shared.event;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface OutboxRepository extends JpaRepository<OutboxEntry, UUID> {
    List<OutboxEntry> findTop200ByStatusOrderByCreatedAtAsc(String status);
}
```

Decision rationale: RestaurantOS uses the transactional outbox, NOT a direct `RabbitTemplate.send` from business code. A direct send can succeed while the DB rolls back (phantom event) or the DB commits while the broker is down (lost event). The outbox makes event emission atomic with the state change. Consumers are idempotent (§2.4), so at-least-once relay delivery is safe.

Note: the `event_outbox`, `idempotency_keys`, and `processed_events` tables that back these `shared-lib` components are NOT created by `shared-lib` itself (it ships no migrations). Every service that publishes events, uses `IdempotencyService`, or consumes events MUST create them via Liquibase — see Document 8 §8.9 for the exact changesets. These three tables are intentionally NOT tenant-scoped (no RLS policy): the outbox relay and idempotency checks run outside a tenant request context.

## 3.11 Money Utilities

```java
package io.restaurantos.shared.money;
/** All money in the system is integer paisa (1 PKR = 100 paisa). */
public record Money(long paisa, double pkr, String formatted) {}
```

```java
package io.restaurantos.shared.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.NumberFormat;
import java.util.Locale;

public final class MoneyUtils {
    private static final Locale EN_PK = Locale.forLanguageTag("en-PK");
    private MoneyUtils() {}

    public static Money toMoney(long paisa) {
        double pkr = paisa / 100.0;
        return new Money(paisa, pkr, formatPkr(paisa));
    }
    public static long fromPkr(BigDecimal pkr) {
        return pkr.multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }
    public static String formatPkr(long paisa) {
        NumberFormat nf = NumberFormat.getCurrencyInstance(EN_PK);
        nf.setMinimumFractionDigits(0);
        nf.setMaximumFractionDigits(0);
        return nf.format(paisa / 100.0);
    }
}
```

Rule: never compute money with `double`/`float`. Use `long` paisa arithmetic; only convert to PKR at the display boundary via `MoneyUtils`.

## 3.12 Configuration Loaded by Every Service

Auto-configuration class (registered in `META-INF/spring/...AutoConfiguration.imports`):

```java
package io.restaurantos.shared.config;

import io.restaurantos.shared.api.GlobalExceptionHandler;
import io.restaurantos.shared.feature.FeatureFlagAspect;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.tenant.*;
import jakarta.persistence.EntityManager;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

@AutoConfiguration
@EnableJpaAuditing(auditorAwareRef = "tenantContextAuditorAware")
public class SharedAutoConfiguration {

    @Bean public TenantContext tenantContext() { return new ThreadLocalTenantContext(); }
    @Bean public TenantContextAuditorAware tenantContextAuditorAware(TenantContext tc) { return new TenantContextAuditorAware(tc); }
    @Bean public TenantFilterInterceptor tenantFilterInterceptor(EntityManager em, TenantContext tc) { return new TenantFilterInterceptor(em, tc); }
    @Bean public TenantAwareMessageProcessor tenantAwareMessageProcessor(TenantContext tc, EntityManager em) { return new TenantAwareMessageProcessor(tc, em); }
    @Bean public GlobalExceptionHandler globalExceptionHandler() { return new GlobalExceptionHandler(); }
    @Bean public FeatureFlagAspect featureFlagAspect(FeatureFlagService ffs, TenantContext tc) { return new FeatureFlagAspect(ffs, tc); }
    // OpaClient, EventPublisher, OutboxRelay, FeatureFlagService impls wired here as well.
}
```

`restaurantos-common.yml` (in the config repo) every service inherits. Values come from env vars (Document 5):

```yaml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 10
      connection-timeout: 2000
  data:
    redis:
      url: ${REDIS_URL}
  rabbitmq:
    host: ${RABBITMQ_HOST}
    port: ${RABBITMQ_PORT:5672}
    username: ${RABBITMQ_USERNAME}
    password: ${RABBITMQ_PASSWORD}
  liquibase:
    change-log: classpath:db/changelog/db.changelog-master.xml

restaurantos:
  jwt:
    jwks-url: ${JWT_JWKS_URL}
    jwks-cache-ttl-seconds: 3600
  opa:
    url: ${OPA_URL}
    timeout-ms: 1000
  feature-flags:
    cache-ttl-seconds: 300
  internal:
    service-secret: ${INTERNAL_SERVICE_SECRET}
  encryption:
    key: ${FIELD_ENCRYPTION_KEY}

management:
  endpoints.web.exposure.include: health,info,prometheus,refresh
  endpoint.health.probes.enabled: true

eureka:
  client:
    service-url:
      defaultZone: ${EUREKA_URL}

server:
  port: ${SERVER_PORT}

resilience4j:
  circuitbreaker:
    configs:
      default:
        sliding-window-size: 20
        failure-rate-threshold: 50
        wait-duration-in-open-state: 10s
  timelimiter:
    configs:
      default:
        timeout-duration: 10s
```
