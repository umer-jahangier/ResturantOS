# Phase 5: Cross-Cutting Services (Notifications, Audit, Files) — Research

**Researched:** 2026-06-26
**Domain:** Spring Boot event-consumer services + MinIO object storage + append-only audit trail
**Confidence:** HIGH

---

## Summary

Phase 5 scaffolds three services that have been absent in the repo but whose infrastructure (RabbitMQ topology, shared-lib outbox/idempotency, MinIO in docker-compose, DB credentials) is already in place. The work is three distinct but structurally similar Spring Boot services, each consuming events from RabbitMQ and writing to its own Postgres database, with one service additionally integrating MinIO.

The standard approach follows the identical scaffold pattern established by `platform-admin-service` (the most complete reference service in the repo): parent POM inheritance, `shared-lib` import, Liquibase XML changesets, `TenantAwareMessageProcessor` for event consumers, `processed_events` for consumer dedup, and `FeignSharedConfig` for any inter-service calls.

**Primary recommendation:** Treat all three services as thin consumers wired around `TenantAwareMessageProcessor`. The hard parts are the notification recipient-resolution chain (Feign to auth-service), audit immutability enforcement (DB-level trigger + revoked DELETE/UPDATE), and quota atomicity in the file service (Redis counter + pre-check). Do not reinvent any of these — the patterns and the DB changeset templates already exist in the spec.

---

## Standard Stack

### Core (all three services)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `spring-boot-starter-web` | 4.0.7 (parent) | REST endpoints | Matches all existing services |
| `spring-boot-starter-data-jpa` | 4.0.7 (parent) | ORM + Hibernate | Matches all existing services |
| `spring-boot-starter-amqp` | 4.0.7 (parent) | RabbitMQ consumers | Required by shared-lib EventPublisher |
| `spring-boot-starter-security` | 4.0.7 (parent) | JWT filter | Inherited pattern from shared-lib |
| `spring-boot-starter-data-redis` | 4.0.7 (parent) | Rate limiting, quota counters | Platform pattern |
| `spring-boot-starter-actuator` | 4.0.7 (parent) | Health/prometheus | Required by CC.2 observability spec |
| `spring-boot-starter-validation` | 4.0.7 (parent) | `@Valid` on DTOs | All existing services |
| `spring-cloud-starter-netflix-eureka-client` | 2025.1.0 BOM | Service discovery | Required for Feign routing |
| `spring-cloud-starter-openfeign` | 2025.1.0 BOM | Internal API calls | `FeignSharedConfig` in shared-lib |
| `spring-boot-liquibase` + `liquibase-core` | parent BOM | DB migrations | Mandatory per spec D1.5 |
| `postgresql` (runtime) | parent BOM | Postgres driver | All services |
| `lombok` (optional) | 1.18.38 | Boilerplate reduction | REQUIRED on JDK 25 — older versions throw `ExceptionInInitializerError` |
| `io.restaurantos:shared-lib` | 1.0.0 | Tenant context, outbox, idempotency, OPA, Feign config | Core contract |

### Notification Service Only

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `spring-boot-starter-mail` | 4.0.7 (parent) | SMTP `JavaMailSender` | Spring-native; avoids third-party mail libs |
| `spring-boot-starter-thymeleaf` | 4.0.7 (parent) | HTML email template rendering | Spring-native; supports ClassPath templates; integrates with `JavaMailSender` |
| `spring-boot-starter-websocket` | 4.0.7 (parent) | In-app real-time notifications (bell) | Spring-native; standard for server-push |

### File Service Only

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `io.minio:minio` | **9.0.0** | MinIO/S3 object operations | Latest GA (released 2026-03-20); Maven Central: `io.minio:minio:9.0.0` |

### Test Dependencies (all services — mirror platform-admin-service)

| Library | Version | Purpose |
|---------|---------|---------|
| `spring-boot-starter-test` | parent | JUnit 5, Mockito |
| `testcontainers:junit-jupiter` | 1.20.3 | Testcontainers lifecycle |
| `testcontainers:postgresql` | 1.20.3 | Real Postgres in tests |
| `testcontainers:rabbitmq` | 1.20.3 | Real RabbitMQ in tests |
| `testcontainers:minio` | 1.20.3 | Real MinIO in tests (file-service) |
| `wiremock-standalone` | 3.12.1 | Feign client stubbing |
| `awaitility` | parent BOM | Async assertion |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Thymeleaf | FreeMarker | Thymeleaf is already on Spring Boot starter path; no added dep |
| `spring-boot-starter-mail` (JavaMailSender) | jakarta.mail directly | Starter auto-config handles retry, TLS, auth |
| `io.minio:minio` | AWS SDK v2 for S3 | MinIO SDK is lighter; project already uses MinIO; MINIO_* env vars already defined |
| WebSocket in-app | SSE (Server-Sent Events) | Both are valid; WebSocket is in spec ("WebSocket bell"); use STOMP/SockJS |
| Postgres partitioning for audit | Separate archive DB | Partitioning keeps single-schema simplicity; archival is a manual `DETACH PARTITION` operation |

### Installation (Maven — add to each service `pom.xml`)

```xml
<!-- notification-service: add spring-boot-starter-mail, thymeleaf, websocket -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-mail</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-thymeleaf</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>

<!-- file-service: add MinIO SDK (version NOT inherited — pin explicitly) -->
<dependency>
    <groupId>io.minio</groupId>
    <artifactId>minio</artifactId>
    <version>9.0.0</version>
</dependency>
```

---

## Architecture Patterns

### Recommended Project Structure (all three services follow this)

```
notification-service/          (or audit-service / file-service)
├── pom.xml
└── src/main/java/io/restaurantos/{service}/
    ├── {Service}Application.java          # @SpringBootApplication + @EnableFeignClients
    ├── controller/                        # REST endpoints (REST APIs + internal endpoints)
    ├── service/                           # Business logic
    ├── repository/                        # JPA repositories
    ├── entity/                            # JPA entities (extend TenantAuditableEntity)
    ├── dto/
    │   ├── request/
    │   └── response/
    ├── event/
    │   └── listener/                      # @RabbitListener consumers (NO publisher needed*)
    ├── client/                            # Feign clients (notification needs AuthClient, UserClient)
    ├── config/                            # Security, RabbitMQ, MinIO (file-service), WebSocket (notification)
    └── exception/                         # Service-specific exceptions
```

*Notification service may optionally publish `NOTIFICATION_SENT` events to `notifications.topic` for tracking; audit service never publishes; file service never publishes.

### Pattern 1: Event Consumer with TenantAwareMessageProcessor (ALL THREE SERVICES)

Every `@RabbitListener` MUST wrap its logic in `TenantAwareMessageProcessor.process(...)`. This is the ONLY sanctioned way per shared-lib spec (Document 3 §3.3). The processor sets TenantContext, enables the Hibernate tenant filter, and sets `app.current_tenant_id` for Postgres RLS in the same transaction.

```java
// Source: Docs/agent-specs/03-shared-lib-specification.md §3.3
@Component
@RequiredArgsConstructor
public class LowStockNotificationConsumer {

    private final TenantAwareMessageProcessor processor;
    private final NotificationDispatchService notificationService;
    private final ProcessedEventRepository processedEventRepository;

    @RabbitListener(queues = "notification.low-stock.queue")
    public void onLowStock(EventEnvelope<LowStockAlertPayload> envelope) {
        processor.process(envelope, env -> {
            // 1. Idempotency check (inside same tx as processor)
            if (processedEventRepository.existsByConsumerAndEventId(
                    "notification.low-stock", env.eventId())) return;

            // 2. Business logic
            notificationService.dispatchForEvent("LOW_STOCK_ALERT", env.tenantId(),
                    env.branchId(), env.payload());

            // 3. Record processed (same tx)
            processedEventRepository.save(new ProcessedEventEntity(
                    "notification.low-stock", env.eventId()));
        });
    }
}
```

### Pattern 2: Consumer Idempotency — `processed_events` Table

All three services MUST create `processed_events` in their v1.0.0 migration (Document 8 §8.9). Processing and recording happen inside the same `@Transactional` boundary provided by `TenantAwareMessageProcessor`.

```xml
<!-- Changeset: notification-1.0.0-000-create-processed-events.xml -->
<changeSet id="notification-1.0.0-000c-create-processed-events" author="restaurantos-agent">
    <createTable tableName="processed_events">
        <column name="consumer" type="TEXT"><constraints nullable="false"/></column>
        <column name="event_id" type="UUID"><constraints nullable="false"/></column>
        <column name="source_type" type="TEXT"/>
        <column name="source_id" type="UUID"/>
        <column name="processed_at" type="TIMESTAMPTZ" defaultValueComputed="NOW()">
            <constraints nullable="false"/>
        </column>
    </createTable>
    <addPrimaryKey tableName="processed_events" columnNames="consumer, event_id"
                   constraintName="pk_processed_events"/>
    <sql>GRANT SELECT, INSERT ON processed_events TO notification_user;</sql>
    <rollback><dropTable tableName="processed_events"/></rollback>
</changeSet>
```

### Pattern 3: Feign Client for Inter-Service Calls (Notification Service)

Notification service resolves recipients via two Feign clients (defined in Document 4 §4.2):

```java
// Source: Docs/agent-specs/04-internal-api-contracts.md §4.2
@FeignClient(name = "auth-service", configuration = FeignSharedConfig.class)
public interface AuthClient {
    // Get users in a branch+role for notification routing
    @GetMapping("/internal/auth/users")
    ApiResponse<List<UserSummary>> getUsersByBranchAndRole(
        @RequestParam UUID branchId, @RequestParam String roleCode);

    record UserSummary(UUID userId, String email, String fullName) {}
}

@FeignClient(name = "user-service", configuration = FeignSharedConfig.class)
public interface UserProfileClient {
    // Get user profile (email, locale) for personalization
    @GetMapping("/internal/users/{userId}/profile")
    ApiResponse<UserProfile> getUserProfile(@PathVariable UUID userId);

    record UserProfile(UUID userId, String fullName, String email,
                       String locale, List<UUID> branchIds) {}
}
```

`FeignSharedConfig` (from `io.restaurantos.shared.config`) automatically propagates JWT, `X-Correlation-Id`, and `X-Internal-Service` header. Reference it by class, not path.

### Pattern 4: Audit Service — Wildcard Consumer + Immutability

Audit service binds to ALL exchanges with routing key `#` via `audit.all-events.queue` (Document 2 §2.2). The event is persisted as a raw audit record without any tenant-scoped entity:

```java
// audit_events is NOT tenant-scoped — it's audit_db global
// Do NOT use TenantAuditableEntity for AuditEventEntity
@Entity
@Table(name = "audit_events")
@Getter
@Setter
public class AuditEventEntity {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(nullable = false) private UUID eventId;
    @Column(nullable = false) private UUID tenantId;
    private UUID branchId;
    private UUID userId;
    private UUID impersonatedBy;
    @Column(nullable = false) private String entityType;
    private UUID entityId;
    @Column(nullable = false) private String action;
    @Column(columnDefinition = "jsonb") private String beforeJson;
    @Column(columnDefinition = "jsonb") private String afterJson;
    @Column(nullable = false) private Instant occurredAt;
    @Column(nullable = false) private String source;
    private UUID traceId;
    @Column(nullable = false) private Instant insertedAt; // server-side insert time
}
```

Immutability DB changeset (already fully specified in Document 8 §8.6):

```xml
<!-- Applies REVOKE UPDATE/DELETE on audit_events + trigger that blocks mutation -->
<changeSet id="audit-1.0.0-005-audit-immutability" author="restaurantos-agent">
    <sql splitStatements="true" endDelimiter=";">
        REVOKE UPDATE, DELETE ON audit_events FROM audit_user;
        GRANT INSERT, SELECT ON audit_events TO audit_user;
        CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $func$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP;
        END;
        $func$ LANGUAGE plpgsql;
        CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_events
            FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();
    </sql>
    <rollback>
        <sql splitStatements="true" endDelimiter=";">
            DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_events;
            DROP FUNCTION IF EXISTS block_audit_mutation();
        </sql>
    </rollback>
</changeSet>
```

### Pattern 5: File Service — MinIO Client Bean + Tenant-Scoped Path

```java
// Source: MinIO Java SDK docs + Spring Boot config pattern
@Configuration
public class MinioConfig {

    @Value("${minio.endpoint}")   // MINIO_ENDPOINT env var
    private String endpoint;
    @Value("${minio.access-key}") // MINIO_ACCESS_KEY
    private String accessKey;
    @Value("${minio.secret-key}") // MINIO_SECRET_KEY
    private String secretKey;

    @Bean
    public MinioClient minioClient() {
        return MinioClient.builder()
            .endpoint(endpoint)
            .credentials(accessKey, secretKey)
            .build();
    }
}
```

Tenant-scoped object key pattern (prefix all objects with tenantId):

```java
// Object key format: {tenantId}/{category}/{uuid}/{filename}
// e.g., "11111111-1111-1111-1111-111111111111/logos/abc123/logo-light.png"
private String buildObjectKey(UUID tenantId, String category, UUID fileId, String filename) {
    return tenantId + "/" + category + "/" + fileId + "/" + filename;
}
```

### Pattern 6: Quota Enforcement (File Service)

Quota check MUST be atomic. Use Redis counter + platform internal API for tracking:

```java
// Check BEFORE upload — read current usage from platform-admin internal API or Redis
// Increment AFTER successful upload via POST /internal/platform/tenants/{id}/usage
// Decrement AFTER deletion via negative delta
@Transactional
public FileUploadResponse upload(UUID tenantId, MultipartFile file) {
    long currentBytes = getUsageBytes(tenantId);
    long limitBytes = getTierLimit(tenantId); // from platform features cache

    if (currentBytes + file.getSize() > limitBytes) {
        throw new QuotaExceededException("STORAGE_BYTES",
            "Storage quota exceeded for tenant " + tenantId);
    }
    // ... upload to MinIO, save metadata to file_db ...
    // ... then call platform usage API to register delta ...
    platformClient.recordUsage(tenantId, "STORAGE_BYTES", file.getSize());
}
```

Storage tier limits (from spec):
- STARTER: 5 GB (5_368_709_120 bytes)
- GROWTH: 25 GB (26_843_545_600 bytes)
- ENTERPRISE: configurable

### Pattern 7: Notification Template + Dispatch Flow

```
Event arrives → @RabbitListener
    ↓ TenantAwareMessageProcessor.process()
    ↓ Idempotency check
    ↓ Look up notification_rule: event_type → (template_code, channels, role_codes)
    ↓ For each role_code: AuthClient.getUsersByBranchAndRole(branchId, roleCode)
    ↓ For each recipient+channel:
         → EMAIL: Thymeleaf render → JavaMailSender.send()
         → IN_APP: INSERT into notification_deliveries (status=DELIVERED)
                   + push via WebSocket STOMP topic
         → WHATSAPP: Feign call to WhatsApp API (GROWTH+ feature-gated)
    ↓ Record in notification_deliveries table
    ↓ Record processed_events
```

### Pattern 8: Notification Service DB Schema (from spec M11.4)

The spec provides partial DDL. Full Liquibase translation:

```xml
<!-- notification_templates — tenant-scoped, with RLS -->
<!-- notification_deliveries — tenant-scoped, with RLS -->
<!-- notification_rules — maps event_type → channel + role_code (system seed rows) -->
```

Key fields from M11.4:
- `notification_templates(id, tenant_id, code, channel, subject, body_file_id, body_text, UNIQUE(tenant_id, code, channel))`
- `notification_deliveries(id, tenant_id, template_code, channel, recipient, status, sent_at, error_message, payload_json, created_at)`

### Pattern 9: In-App Notifications WebSocket

```java
// WebSocket STOMP config
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic");
        config.setApplicationDestinationPrefixes("/app");
    }
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws/notifications").withSockJS();
    }
}

// Push notification after delivery
@Service
public class InAppNotificationPusher {
    private final SimpMessagingTemplate messagingTemplate;

    public void push(UUID userId, NotificationPayload payload) {
        messagingTemplate.convertAndSendToUser(
            userId.toString(),
            "/topic/notifications",
            payload
        );
    }
}
```

### Pattern 10: Audit Service — 7-Year Retention via Postgres Partitioning

```sql
-- audit_events is RANGE-partitioned by occurred_at (annual partitions)
CREATE TABLE audit_events (
    -- columns ...
    occurred_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (occurred_at);

-- Annual partitions created at service startup or via Liquibase:
CREATE TABLE audit_events_2026
    PARTITION OF audit_events
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
```

Archival: after 7 years, `ALTER TABLE audit_events DETACH PARTITION audit_events_2019`, then export to cold storage (S3/MinIO), then drop. This is an operational procedure, not code.

### Anti-Patterns to Avoid

- **Calling services directly from consumer without `TenantAwareMessageProcessor`**: RLS returns 0 rows, Hibernate filter off.
- **Publishing events from audit-service**: Audit is a pure sink. Zero outbox needed.
- **Checking quota without atomicity**: Two concurrent uploads both pass the check → quota exceeded. Use `incrementAndGet()` in Redis before upload, decrement on failure.
- **Storing MinIO blobs in `file_db`**: Only metadata goes in Postgres. The binary blob lives in MinIO.
- **Using `TenantAuditableEntity` for `audit_events`**: Audit events are not soft-deletable; they have their own tenant_id column but no `deleted_at` lifecycle.
- **Sending email synchronously in `@RabbitListener`**: SMTP can time out; send async via `@Async` or enqueue to delivery queue.
- **Extending `SharedAutoConfiguration` in gateway pattern**: Not applicable here — all three services are standard servlet services, not reactive. SharedAutoConfiguration is compatible. Only the gateway excludes it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML email rendering | String concatenation / regex | Thymeleaf `TemplateEngine` | Handles encoding, escaping, i18n, layout inheritance |
| SMTP delivery | Raw javax.mail | `spring-boot-starter-mail` + `JavaMailSender` | Auto-retry, TLS config, Spring event integration |
| MinIO object operations | HTTP to MinIO REST API | `io.minio:minio:9.0.0` SDK | Presigned URLs, streaming, multipart — all in SDK |
| Consumer dedup | Custom locking table | `processed_events` PK `(consumer, event_id)` | Already specified in Document 2 §2.4 + Document 8 §8.9 |
| Tenant context in consumers | Manual ThreadLocal | `TenantAwareMessageProcessor` | Handles TenantContext + Hibernate filter + Postgres RLS in one call |
| Audit immutability | Application-layer reject | Postgres `REVOKE DELETE/UPDATE` + trigger | DB-level guarantee; application bug cannot bypass it |
| Feign inter-service auth | Custom headers | `FeignSharedConfig` from shared-lib | Propagates JWT + `X-Internal-Service` + trace ID |
| WebSocket auth | Custom handshake | Spring Security WebSocket + JWT sub extraction | Already in security chain |
| In-app notification storage | Separate notification DB per user | `notification_deliveries` table (tenant_id + user_id column) | Simpler; existing RLS pattern handles isolation |

**Key insight:** The shared-lib and existing service patterns already solve the cross-cutting complexity. Phase 5 is about wiring — connecting RabbitMQ consumers to the right downstream side-effects — not about inventing infrastructure.

---

## Common Pitfalls

### Pitfall 1: Missing `event_outbox` / `processed_events` in Migration

**What goes wrong:** Service starts, Spring validates JPA entities against DB schema, fails with `SchemaManagementException`. `OutboxEntry` and consumer dedup won't work.
**Why it happens:** `shared-lib` ships NO migrations — it's the responsibility of each consumer service.
**How to avoid:** Always include `000-create-processed-events.xml` as the first changeset in `v1.0.0/`. Notification and audit-service need `processed_events` (they consume). File service also needs it if consuming any events.
**Warning signs:** `Unable to build Hibernate SessionFactory` or `relation "processed_events" does not exist` in startup logs.

### Pitfall 2: Raw `@RabbitListener` Without TenantAwareMessageProcessor

**What goes wrong:** All JPA queries inside the consumer return empty results; the tenant filter is inactive; Postgres RLS blocks all rows.
**Why it happens:** RabbitMQ consumer threads have no ThreadLocal TenantContext set.
**How to avoid:** Wrap every consumer body in `tenantAwareMessageProcessor.process(envelope, handler)`.
**Warning signs:** "0 notifications dispatched" for an event that should have produced results.

### Pitfall 3: Race Condition in File Quota Check

**What goes wrong:** Two simultaneous upload requests both read `currentBytes < limit`, both proceed, both upload, quota is exceeded by up to `2 * maxFileSize`.
**Why it happens:** Read-then-write is not atomic.
**How to avoid:** Use Redis `INCRBY storage:{tenantId} {fileSize}` before uploading. If the result exceeds the limit, issue a `DECRBY` to roll back, then throw `QuotaExceededException`. After successful upload, update `file_db` and push delta to platform usage API.
**Warning signs:** Tenant quota shows 102% or higher.

### Pitfall 4: Audit Consumer Falling Behind Under Load

**What goes wrong:** `audit.all-events.queue` binds to ALL exchanges with `#`. Under high order volume, this queue fills up; DLQ depth alert fires.
**Why it happens:** Audit consumer is slow (disk I/O for each insert) and there's no concurrency.
**How to avoid:** Set `concurrency` on the `@RabbitListener` container (e.g., `concurrency = "3-5"`). The `processed_events` PK prevents duplicates even with parallel consumers. Batch inserts (`saveAll()`) for burst scenarios.
**Warning signs:** `audit.all-events.queue` depth growing continuously; latency > 5s between event occurrence and audit record.

### Pitfall 5: Notification Recipient Resolution Feign Timeout Blocks Consumer Thread

**What goes wrong:** `AuthClient.getUsersByBranchAndRole()` times out (auth-service unavailable); the `@RabbitListener` thread blocks for 10s; the RabbitMQ prefetch pool exhausts; consumer stops processing.
**Why it happens:** Synchronous Feign call inside a consumer; Feign timeout is 10s (Document 4 §4.3).
**How to avoid:** Execute notification dispatch asynchronously via `@Async` after the consumer records the `processed_events` entry. The consumer itself is fast (just enqueue the dispatch). Use circuit breaker on the Feign client (`resilience4j.circuitbreaker` already configured in shared `restaurantos-common.yml`).
**Warning signs:** `notification.low-stock.queue` depth growing; consumer thread count at max.

### Pitfall 6: Thymeleaf Template Not Found at Runtime

**What goes wrong:** `TemplateInputException: Error resolving template [...]`
**Why it happens:** Template file not in `src/main/resources/templates/` or wrong path.
**How to avoid:** Store system default templates in `src/main/resources/templates/notification/{template_code}/{channel}.html`. Tenant-customized templates reference a `body_file_id` UUID pointing to a file in MinIO — fetch at render time.
**Warning signs:** Email dispatch fails with template engine exception.

### Pitfall 7: Audit Service Uses `TenantAuditableEntity` for `audit_events`

**What goes wrong:** `audit_events` would get `deleted_at` and soft-delete semantics, breaking the immutability guarantee. The `tenantFilter` Hibernate filter would also apply, potentially hiding audit records.
**Why it happens:** Developer copies entity from another service.
**How to avoid:** `AuditEventEntity` must NOT extend `TenantAuditableEntity`. It has its own `tenant_id` column but no soft-delete, no `version`, and no JPA `@Filter`.
**Warning signs:** Audit records disappearing from queries after service restart (filter not enabled); or `deleted_at` column created in audit_events migration (wrong).

### Pitfall 8: MinIO SDK Version Conflict

**What goes wrong:** `NoClassDefFoundError` or `MethodNotFoundException` at startup; MinIO 9.x API changed from 8.x.
**Why it happens:** Older blog posts reference `8.5.x`; parent BOM does not manage `io.minio:minio`.
**How to avoid:** Pin `io.minio:minio:9.0.0` explicitly in file-service `pom.xml`. Do NOT add to parent `dependencyManagement` (only file-service needs it).
**Warning signs:** Compilation error on `MinioClient.builder()` or changed method signatures.

---

## Code Examples

### Service Application Class (all three services follow same pattern as platform-admin)

```java
// Source: services/platform-admin-service/src/main/java/io/restaurantos/platform/PlatformAdminApplication.java
// Pattern: @SpringBootApplication + @EnableFeignClients scoped to service's client package
@SpringBootApplication
@EnableFeignClients(basePackages = "io.restaurantos.notification.client")
public class NotificationServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(NotificationServiceApplication.class, args);
    }
}
```

### Application YAML (notification-service example)

```yaml
# src/main/resources/application.yml
spring:
  application:
    name: notification-service
  config:
    import: "configserver:"

server:
  port: ${SERVER_PORT:8091}

# SMTP config (Mailpit dev, SES prod)
spring.mail:
  host: ${SMTP_HOST:mailpit}
  port: ${SMTP_PORT:1025}
  username: ${SMTP_USERNAME:}
  password: ${SMTP_PASSWORD:}
  properties:
    mail.smtp.auth: false
    mail.smtp.starttls.enable: false

notification:
  from: ${SMTP_FROM:noreply@restaurantos.local}
```

### Application YAML (file-service example)

```yaml
spring:
  application:
    name: file-service
  config:
    import: "configserver:"
  servlet:
    multipart:
      max-file-size: 50MB
      max-request-size: 55MB

server:
  port: ${SERVER_PORT:8095}

minio:
  endpoint: ${MINIO_ENDPOINT:http://minio:9000}
  access-key: ${MINIO_ACCESS_KEY:minioadmin}
  secret-key: ${MINIO_SECRET_KEY:}
  bucket: ${MINIO_BUCKET:restaurantos-dev}
```

### Audit Consumer (full wildcard pattern)

```java
// Consumes ALL events; no tenant filter needed — audit_events has no RLS
@Component
@RequiredArgsConstructor
@Slf4j
public class AuditEventConsumer {

    private final AuditEventRepository auditEventRepository;
    private final ProcessedEventRepository processedEventRepository;

    @RabbitListener(queues = "audit.all-events.queue", concurrency = "3-5")
    @Transactional
    public void onAnyEvent(EventEnvelope<Map<String, Object>> envelope) {
        // No TenantAwareMessageProcessor — audit_events is not tenant-filtered
        if (processedEventRepository.existsByConsumerAndEventId(
                "audit.consumer", envelope.eventId())) {
            log.debug("Skipping already-processed audit event {}", envelope.eventId());
            return;
        }

        AuditEventEntity event = new AuditEventEntity();
        event.setEventId(envelope.eventId());
        event.setTenantId(envelope.tenantId());
        event.setBranchId(envelope.branchId());
        event.setAction(envelope.eventType());
        event.setSource(envelope.source());
        event.setOccurredAt(envelope.occurredAt());
        event.setAfterJson(serializePayload(envelope.payload()));
        event.setInsertedAt(Instant.now());

        auditEventRepository.save(event);
        processedEventRepository.save(
            new ProcessedEventEntity("audit.consumer", envelope.eventId()));
    }
}
```

**Note:** Audit consumer does NOT use `TenantAwareMessageProcessor` because `audit_events` is NOT RLS-protected. The processor is for tenant-scoped tables only.

### MinIO Upload with Quota Check

```java
// Source: MinIO Java SDK 9.0.0 + Project quota pattern from Docs/agent-specs/04-internal-api-contracts.md
@Service
@RequiredArgsConstructor
public class FileStorageService {

    private final MinioClient minioClient;
    private final FileMetadataRepository fileRepository;
    private final PlatformInternalClient platformClient;
    private final TenantContext tenantContext;

    @Value("${minio.bucket}")
    private String bucket;

    @Transactional
    public FileUploadResponse upload(String category, MultipartFile file) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID fileId = UUID.randomUUID();
        String objectKey = tenantId + "/" + category + "/" + fileId + "/"
                + file.getOriginalFilename();

        // Quota check via platform internal API
        var usageResult = platformClient.recordUsage(tenantId, "STORAGE_BYTES", file.getSize());
        if (usageResult.newCount() > usageResult.limit()) {
            // Roll back the usage increment
            platformClient.recordUsage(tenantId, "STORAGE_BYTES", -file.getSize());
            throw new QuotaExceededException("STORAGE_BYTES",
                "Storage quota would be exceeded");
        }

        // Upload to MinIO
        try {
            minioClient.putObject(PutObjectArgs.builder()
                .bucket(bucket)
                .object(objectKey)
                .stream(file.getInputStream(), file.getSize(), -1)
                .contentType(file.getContentType())
                .build());
        } catch (Exception e) {
            platformClient.recordUsage(tenantId, "STORAGE_BYTES", -file.getSize());
            throw new RuntimeException("MinIO upload failed", e);
        }

        // Persist metadata
        FileMetadataEntity metadata = new FileMetadataEntity();
        metadata.setTenantId(tenantId);
        metadata.setFileId(fileId);
        metadata.setObjectKey(objectKey);
        metadata.setSizeBytes(file.getSize());
        metadata.setContentType(file.getContentType());
        metadata.setOriginalFilename(file.getOriginalFilename());
        metadata.setCategory(category);
        fileRepository.save(metadata);

        return new FileUploadResponse(fileId, objectKey, file.getSize());
    }

    public String generatePresignedDownloadUrl(UUID fileId, int expirySeconds) {
        FileMetadataEntity meta = fileRepository.findByFileIdAndTenantId(
            fileId, tenantContext.requireTenantId())
            .orElseThrow(() -> new ResourceNotFoundException("File", fileId));

        try {
            return minioClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                .method(Method.GET)
                .bucket(bucket)
                .object(meta.getObjectKey())
                .expiry(expirySeconds, TimeUnit.SECONDS)
                .build());
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate presigned URL", e);
        }
    }
}
```

### Thymeleaf Email Rendering

```java
// Template rendering with Thymeleaf + JavaMailSender
@Service
@RequiredArgsConstructor
public class EmailDispatchService {

    private final JavaMailSender mailSender;
    private final TemplateEngine templateEngine;

    @Value("${notification.from}")
    private String fromAddress;

    @Async
    public void sendHtmlEmail(String to, String subject, String templateCode,
                               Map<String, Object> variables) {
        Context context = new Context();
        context.setVariables(variables);
        String htmlContent = templateEngine.process(
            "notification/" + templateCode + "/email", context);

        MimeMessage message = mailSender.createMimeMessage();
        try {
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(fromAddress);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(htmlContent, true); // true = HTML
            mailSender.send(message);
        } catch (MessagingException e) {
            throw new RuntimeException("Email send failed", e);
        }
    }
}
```

### RabbitMQ Consumer Configuration (DLQ + retry)

```java
// Retry + DLQ config — matches Document 2 §2.5 DLQ Handling Policy
@Configuration
public class RabbitMqConfig {

    @Bean
    public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            ConnectionFactory connectionFactory,
            SimpleRabbitListenerContainerFactoryConfigurer configurer) {

        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);

        // 3 attempts, exponential backoff (2s, 4s, 10s max)
        RetryInterceptorBuilder<?> retryBuilder = RetryInterceptorBuilder.stateless()
            .maxAttempts(3)
            .backOffOptions(2000, 2.0, 10000)
            .recoverer(new RejectAndDontRequeueRecoverer()); // → DLQ on final failure
        factory.setAdviceChain(retryBuilder.build());
        factory.setDefaultRequeueRejected(false); // MUST be false — Document 2 §2.5

        return factory;
    }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct RabbitTemplate.send from business code | Transactional outbox (Document 3 §3.10) | Phase 1 design | At-least-once event delivery; no phantom events |
| `javax.mail` directly | `spring-boot-starter-mail` + `JavaMailSender` | Spring Boot 4 | Auto-config TLS, retry, test support |
| MinIO SDK 8.x | MinIO SDK 9.0.0 | March 2026 | API compatible; `MinioClient.builder()` pattern unchanged |
| Postgres `TIMESTAMP` | `TIMESTAMPTZ` everywhere | Project baseline | UTC-correct; avoids DST bugs |
| Audit events in each service's DB | Centralized `audit_db` via event | Phase 5 design | Single immutable source of truth |
| `NUMERIC(12,2)` for storage size | `BIGINT` bytes | Project baseline | Exact integer arithmetic; no rounding |

**Deprecated/outdated:**
- `spring-boot-starter-mail` javax.mail APIs: replaced with Jakarta Mail in Spring Boot 4 (same `spring-boot-starter-mail` starter, package `jakarta.mail`). Imports change from `javax.mail` → `jakarta.mail`.

---

## Open Questions

1. **In-app notification delivery mechanism: SSE vs WebSocket vs polling**
   - What we know: Spec M11 says "In-app (WebSocket bell)" but frontend implementation detail is unresolved.
   - What's unclear: STOMP over SockJS vs pure WebSocket; requires frontend subscriber
   - Recommendation: Use Spring WebSocket + STOMP (`/ws/notifications` endpoint), store all in-app notifications in `notification_deliveries`, frontend polls on reconnect. Plan 05-01 should decide and doc it.

2. **Does `notification_deliveries` need RLS?**
   - What we know: It has `tenant_id` and holds personal notification data.
   - What's unclear: Users might only see their own; branch managers see branch-scoped.
   - Recommendation: Apply standard RLS pattern (`tenant_isolation` policy) — consistent with all other tenant-scoped tables.

3. **7-year audit retention: who creates annual partitions?**
   - What we know: Must cover 2020–2033 at minimum; partitions must exist before data arrives.
   - What's unclear: Auto-partition creation vs manual Liquibase changesets per year.
   - Recommendation: Create 10 years worth of annual partitions in initial migration (2020–2030), add a yearly cron job for future partitions. Document the archival procedure as a runbook.

4. **Notification service: publish `NOTIFICATION_SENT` events to `notifications.topic`?**
   - What we know: `notifications.topic` exchange exists (Document 2 §2.2). Spec says "all services publish notification-intent events to notifications.topic" but doesn't spec a `NOTIFICATION_SENT` event type.
   - What's unclear: Does notification service need an outbox? Do downstream services consume notification events?
   - Recommendation: Skip outbox for Phase 5. Notification service is a pure consumer. Add `event_outbox` only if a later phase needs to react to notification events.

5. **File service: presigned URL authentication**
   - What we know: MinIO presigned URLs are time-limited and signed.
   - What's unclear: Should the file service validate tenant ownership before generating the URL, and should the URL be behind the gateway?
   - Recommendation: File service REST endpoint validates tenant ownership (JWT tenant_id matches file metadata tenant_id) before generating presigned URL. URL points directly to MinIO (bypasses gateway) — acceptable for private tenant files.

---

## Sources

### Primary (HIGH confidence)
- **Docs/agent-specs/01-project-scaffold.md** — Service scaffold structure, Maven POM pattern, package naming
- **Docs/agent-specs/02-event-schema-registry.md** — RabbitMQ topology, `audit.all-events.queue`, event schemas, DLQ policy
- **Docs/agent-specs/03-shared-lib-specification.md** — TenantAwareMessageProcessor, EventPublisher, processed_events, shared-lib contracts
- **Docs/agent-specs/04-internal-api-contracts.md** — AuthClient, UserProfileClient, FeignSharedConfig, platform usage API
- **Docs/agent-specs/05-environment-variables.md** — SMTP_URL, MINIO_*, SMTP_FROM env vars
- **Docs/agent-specs/08-database-migration-guide.md** — Liquibase patterns, audit immutability changeset, processed_events changeset
- **Docs/RestaurantERP_SaaS_Specification.md M11, M12** — Notification channels/schema, audit architecture, immutability guarantee
- **services/platform-admin-service/pom.xml** — Verified actual dependency list and build plugin configuration
- **deploy/docker-compose.yml** — MinIO version `RELEASE.2024-09-13T20-26-02Z` confirmed present

### Secondary (MEDIUM confidence)
- **GitHub: minio/minio-java** (2026-03-20) — MinIO Java SDK 9.0.0 is latest GA; Maven coordinates `io.minio:minio:9.0.0` confirmed
- **Spring Boot 4.0.7 docs** — `spring-boot-starter-mail`, `spring-boot-starter-thymeleaf`, `spring-boot-starter-websocket` all available; Jakarta Mail (not javax.mail)

### Tertiary (LOW confidence — flagged for validation)
- **In-app notification delivery pattern** — WebSocket STOMP assumption based on spec wording "WebSocket bell"; actual frontend integration pattern not researched
- **Postgres table partitioning for audit retention** — standard Postgres pattern; specific partition management strategy not validated against project ops runbooks

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against existing platform-admin-service pom.xml; MinIO SDK version confirmed via GitHub
- Architecture patterns: HIGH — directly derived from existing spec docs and shared-lib contracts
- Pitfalls: HIGH — derived from explicit spec warnings (DLQ policy, TenantAwareMessageProcessor anti-patterns, quota atomicity)
- File service quota atomicity: MEDIUM — recommended Redis INCRBY pattern is sound but specific Redis key schema not confirmed in existing code
- In-app WebSocket pattern: MEDIUM — spec says "WebSocket bell" but frontend integration details are unresolved

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable stack; MinIO SDK GA; Spring Boot 4 APIs stable)

---

## RESEARCH COMPLETE

**Phase:** 5 — Cross-Cutting Services (Notifications, Audit, Files)
**Confidence:** HIGH

### Key Findings

- **Three services to scaffold from scratch** — `notification-service` (8091), `audit-service` (8093), `file-service` (8095). Maven modules already declared in parent POM; DB credentials already in `.env.example`; MinIO already in docker-compose.
- **All three follow identical Maven structure** as `platform-admin-service` — same starters, same shared-lib, same Liquibase XML pattern, same test stack (Testcontainers + WireMock + Awaitility).
- **Notification service** needs 3 extra starters (`spring-boot-starter-mail`, `thymeleaf`, `websocket`) and 2 Feign clients (AuthClient + UserProfileClient). Dispatch must be `@Async` to avoid blocking consumer threads.
- **Audit service** is intentionally the simplest — pure wildcard consumer on `audit.all-events.queue`, no outbox, no Feign clients. The DB-level immutability trigger changeset is already fully specified in Document 8 §8.6.
- **File service** adds MinIO SDK 9.0.0 (pin version — not in parent BOM) and a Redis-atomic quota check. Tenant objects are prefixed `{tenantId}/` in the single MinIO bucket.

### File Created

`.planning/phases/05-cross-cutting-services-notifications-audit-files/05-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Cross-verified against existing pom.xml + GitHub SDK releases |
| Architecture | HIGH | Directly derived from shared-lib contracts and spec documents |
| Pitfalls | HIGH | Explicit warnings in existing spec docs; known Spring/RabbitMQ patterns |
| In-app WebSocket details | MEDIUM | Spec says "WebSocket bell"; frontend subscriber pattern not yet defined |
| Quota Redis key schema | MEDIUM | Pattern is sound; exact key names not confirmed in existing code |

### Open Questions

1. In-app delivery: SSE vs STOMP WebSocket — needs decision in 05-01 plan
2. Should notification service publish `NOTIFICATION_SENT` events? (Recommend: no, for Phase 5)
3. Postgres annual partitions for audit: auto-creation job vs Liquibase changeset per year

### Ready for Planning

Research complete. Planner can now create `05-01-PLAN.md`, `05-02-PLAN.md`, and `05-03-PLAN.md`.
