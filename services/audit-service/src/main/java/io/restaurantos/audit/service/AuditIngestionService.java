package io.restaurantos.audit.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.shared.event.AuditEventCatalog;
import io.restaurantos.shared.event.EventEnvelope;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ingests domain events into the append-only audit_events table.
 *
 * <p>Writes with {@code EntityManager.persist()} — a plain INSERT, which is the only write statement
 * the runtime user (audit_writer) is granted on this append-only table.
 *
 * <h2>What 15-01 changed, and why the table held zero rows</h2>
 *
 * <p>Three independent defects, each sufficient on its own to keep the log empty or near-empty:
 *
 * <ol>
 *   <li><b>The allow-list named events nobody published.</b> Four of its eight entries had no
 *       publisher anywhere: {@code VOID_CREATED} and {@code REFUND_CREATED} (pos-service publishes
 *       {@code ORDER_VOIDED} / {@code ORDER_REFUNDED}), {@code RBAC_CHANGED} and
 *       {@code IMPERSONATION_STARTED} (nothing published either). Voids and refunds — the two
 *       operations an auditor looks at first — were unaudited because of a string mismatch. The
 *       list now lives in {@link AuditEventCatalog} and {@code AuditAllowListClosureTest} fails
 *       the build if any entry loses its publisher or any security-relevant published type is
 *       missing from it.</li>
 *   <li><b>The source rule could never match.</b> {@code ALWAYS_AUDIT_SOURCES} tested for
 *       {@code auth-service} / {@code platform-admin-service} while {@code DomainEventPublisher}
 *       stamped {@code "shared-lib"} on every event ever published. Fixed at the publisher.</li>
 *   <li><b>The actor was usually null.</b> The user id was recovered by fishing for a
 *       {@code "userId"} key in the payload map, so any payload naming it {@code actorId},
 *       {@code approvedBy}, {@code closedBy} or {@code createdBy} produced a row that could not say
 *       who did it. The actor now travels in the envelope and the payload is only a fallback for
 *       messages published before this phase.</li>
 * </ol>
 *
 * <h2>An audit failure is loud, and never rolls back a sale</h2>
 *
 * <p>These two requirements look opposed and are not, because they are separated in time by a
 * commit. The business transaction commits together with an {@code event_outbox} row — that is what
 * the outbox pattern buys, and it means a sale is durable before this class has heard of it.
 * Everything from that point on is asynchronous: {@code OutboxRelay} delivers, this consumer
 * ingests. So a failure here cannot reach the sale; there is no transaction left to roll back.
 *
 * <p>Which frees the failure to be as loud as it should be. {@link #ingest} does <b>not</b> catch:
 * it throws, the listener does not acknowledge, the broker redelivers, and after retries the message
 * lands in {@code audit.all-events.queue.dlq}. A non-empty DLQ and a climbing queue depth are the
 * alarm. Swallowing the exception would ACK the message and destroy it — the audit event would be
 * gone with one log line, which is the failure mode {@code EventEnvelopeReader} was extracted to
 * stop nine consumers from having. See {@code 15-CONTEXT.md} D-3.
 */
@Service
@Slf4j
public class AuditIngestionService {

    /** Payload keys that name the actor on events published before the envelope carried one. */
    private static final List<String> LEGACY_ACTOR_KEYS =
            List.of("userId", "actorId", "actingUserId", "actingAdministratorId",
                    "approvedBy", "closedBy", "createdBy", "adminUserId");

    /** Payload keys that name the thing acted upon, most specific first. */
    private static final List<String> RESOURCE_ID_KEYS =
            List.of("targetUserId", "orderId", "tillId", "employeeId", "payrollRunId",
                    "poId", "purchaseOrderId", "invoiceId", "paymentId", "journalEntryId",
                    "periodId", "tenantId", "resourceId", "id");

    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    public AuditIngestionService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Ingests the event envelope into audit_events if the event is auditable.
     * Non-auditable events are skipped.
     *
     * @param envelope the event envelope received from the all-events queue
     * @throws RuntimeException if the row cannot be written — deliberately uncaught, see the class
     *                          javadoc
     */
    @Transactional
    public void ingest(EventEnvelope<?> envelope) {
        if (!isAuditable(envelope)) {
            log.debug("Skipping non-auditable event: type={} source={}",
                    envelope.eventType(), envelope.source());
            return;
        }

        Instant occurredAt = envelope.occurredAt() != null ? envelope.occurredAt() : Instant.now();

        AuditEventEntity entity = AuditEventEntity.builder()
                .occurredAt(occurredAt)
                .tenantId(envelope.tenantId())
                .branchId(envelope.branchId())
                .userId(resolveActor(envelope))
                .impersonatedBy(envelope.impersonatedBy())
                .action(envelope.eventType())
                .resourceType(resolveResourceType(envelope))
                .resourceId(resolveResourceId(envelope.payload()))
                .afterState(serializePayload(envelope.payload()))
                .metadata(buildMetadata(envelope))
                .build();

        // persist(), NOT repository.save(): audit_events has a composite @IdClass whose occurredAt
        // half is assigned above, so Spring Data's isNew() reports false and save() routes to
        // em.merge() — which SELECTs the row before writing it. audit_writer was INSERT-only, so
        // that SELECT returned "permission denied for table audit_events" and every event was
        // rejected. persist() is an unconditional INSERT, which is also the only write this
        // append-only table permits. (audit_writer now holds SELECT too, for the read API — but
        // persist() remains correct and remains the cheaper statement.)
        // flush() keeps the write inside this transaction so a duplicate still surfaces here as a
        // DataIntegrityViolationException rather than at commit.
        entityManager.persist(entity);
        entityManager.flush();
        log.debug("Audit row persisted: action={} tenantId={} actor={}",
                envelope.eventType(), envelope.tenantId(), entity.getUserId());
    }

    /**
     * Returns true if this event should produce an audit row.
     *
     * <p>Auditable if the type is in {@link AuditEventCatalog#MUST_AUDIT}, or the publishing service
     * is one whose every event is audited. The second rule is the safety net: an auth-service event
     * type somebody forgets to register is still captured.
     */
    public boolean isAuditable(EventEnvelope<?> envelope) {
        if (AuditEventCatalog.MUST_AUDIT.contains(envelope.eventType())) {
            return true;
        }
        return envelope.source() != null
                && AuditEventCatalog.ALWAYS_AUDIT_SOURCES.contains(envelope.source());
    }

    /**
     * WHO. The envelope first, the payload only for messages published before 15-01.
     *
     * <p>The envelope value is authoritative because {@code DomainEventPublisher} takes it from the
     * verified JWT rather than from whatever the payload author happened to call the field. The
     * fallback exists because the queue held a backlog of pre-15-01 messages when this shipped, and
     * a null actor recovered from a payload is strictly better than a null actor not looked for.
     */
    private UUID resolveActor(EventEnvelope<?> envelope) {
        if (envelope.actorId() != null) {
            return envelope.actorId();
        }
        if (envelope.payload() instanceof Map<?, ?> map) {
            for (String key : LEGACY_ACTOR_KEYS) {
                UUID candidate = asUuid(map.get(key));
                if (candidate != null) {
                    return candidate;
                }
            }
        }
        return null;
    }

    /**
     * WHAT KIND of thing was acted upon, derived from the event type's leading noun.
     *
     * <p>{@code ORDER_VOIDED} to {@code ORDER}, {@code ROLE_GRANTED} to {@code ROLE},
     * {@code USER_LOGIN_SUCCEEDED} to {@code USER}. Derived rather than mapped: a lookup table would
     * be one more vocabulary to drift out of step with the event types, and this column exists to
     * make {@code WHERE resource_type = 'ORDER'} possible, not to be authoritative.
     */
    private String resolveResourceType(EventEnvelope<?> envelope) {
        String type = envelope.eventType();
        if (type == null || type.isBlank()) {
            return null;
        }
        int underscore = type.indexOf('_');
        return underscore > 0 ? type.substring(0, underscore) : type;
    }

    /** WHICH one, by the first recognised identifier in the payload. */
    private String resolveResourceId(Object payload) {
        if (payload instanceof Map<?, ?> map) {
            for (String key : RESOURCE_ID_KEYS) {
                Object value = map.get(key);
                if (value != null && !String.valueOf(value).isBlank()) {
                    return truncate(String.valueOf(value));
                }
            }
        }
        return null;
    }

    /**
     * Provenance: which service said so, and under which envelope.
     *
     * <p>Kept out of {@code after_state} so that the payload column stays exactly what the producer
     * sent. {@code eventId} is what ties an audit row back to its {@code event_outbox} row and its
     * broker message when someone is reconstructing a sequence.
     */
    private String buildMetadata(EventEnvelope<?> envelope) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("source", envelope.source());
        metadata.put("eventId", envelope.eventId() != null ? envelope.eventId().toString() : null);
        metadata.put("correlationId",
                envelope.correlationId() != null ? envelope.correlationId().toString() : null);
        metadata.put("schemaVersion", envelope.schemaVersion());
        return serializePayload(metadata);
    }

    private String serializePayload(Object payload) {
        if (payload == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize payload to JSON, storing as string: {}", e.getMessage());
            return objectMapper.valueToTree(String.valueOf(payload)).toString();
        }
    }

    private static UUID asUuid(Object value) {
        if (value instanceof UUID uuid) {
            return uuid;
        }
        if (value instanceof String s && !s.isBlank()) {
            try {
                return UUID.fromString(s);
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        return null;
    }

    /** resource_id is VARCHAR(255); a longer value is truncated rather than failing the insert. */
    private static String truncate(String value) {
        return value.length() <= 255 ? value : value.substring(0, 255);
    }
}
