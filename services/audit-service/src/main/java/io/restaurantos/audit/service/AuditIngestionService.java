package io.restaurantos.audit.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.shared.event.EventEnvelope;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

/**
 * Ingests domain events into the append-only audit_events table.
 * Filters events to only auditable types; maps EventEnvelope fields to the entity.
 * Uses INSERT (saveAndFlush) — the runtime user has no UPDATE/DELETE grants.
 */
@Service
@Slf4j
public class AuditIngestionService {

    /**
     * Auditable event types that must always produce an audit row.
     * Events from auth.topic and platform.topic are always audited (security-sensitive).
     */
    private static final Set<String> EXPLICITLY_AUDITABLE = Set.of(
            "USER_LOGIN_SUCCEEDED",
            "USER_LOGIN_FAILED",
            "IMPERSONATION_STARTED",
            "TENANT_PROVISIONED",
            "RBAC_CHANGED",
            "VOID_CREATED",
            "REFUND_CREATED"
    );

    /** Topic-based auditing: ALL events from these sources are audited regardless of type. */
    private static final Set<String> ALWAYS_AUDIT_SOURCES = Set.of(
            "auth-service",
            "platform-admin-service"
    );

    private final AuditEventRepository auditEventRepository;
    private final ObjectMapper objectMapper;

    public AuditIngestionService(AuditEventRepository auditEventRepository, ObjectMapper objectMapper) {
        this.auditEventRepository = auditEventRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Ingests the event envelope into audit_events if the event is auditable.
     * Non-auditable events are silently skipped.
     *
     * @param envelope the event envelope received from the all-events queue
     */
    @Transactional
    public void ingest(EventEnvelope<?> envelope) {
        if (!isAuditable(envelope)) {
            log.debug("Skipping non-auditable event: type={} source={}", envelope.eventType(), envelope.source());
            return;
        }

        String afterStateJson = serializePayload(envelope.payload());
        Instant occurredAt = envelope.occurredAt() != null ? envelope.occurredAt() : Instant.now();

        AuditEventEntity entity = AuditEventEntity.builder()
                .occurredAt(occurredAt)
                .tenantId(envelope.tenantId())
                .branchId(envelope.branchId())
                .userId(extractUserId(envelope.payload()))
                .action(envelope.eventType())
                .afterState(afterStateJson)
                .build();

        // saveAndFlush ensures INSERT is flushed within transaction — catches DataIntegrityViolationException
        auditEventRepository.saveAndFlush(entity);
        log.debug("Audit row persisted: action={} tenantId={}", envelope.eventType(), envelope.tenantId());
    }

    /**
     * Returns true if this event should produce an audit row.
     * Auditable if: event type is in EXPLICITLY_AUDITABLE set,
     * OR the source is from an always-audited service.
     */
    public boolean isAuditable(EventEnvelope<?> envelope) {
        if (EXPLICITLY_AUDITABLE.contains(envelope.eventType())) {
            return true;
        }
        if (envelope.source() != null && ALWAYS_AUDIT_SOURCES.contains(envelope.source())) {
            return true;
        }
        return false;
    }

    private String serializePayload(Object payload) {
        if (payload == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize payload to JSON, storing as string: {}", e.getMessage());
            return String.valueOf(payload);
        }
    }

    @SuppressWarnings("unchecked")
    private java.util.UUID extractUserId(Object payload) {
        if (payload instanceof Map<?, ?> map) {
            Object userId = map.get("userId");
            if (userId instanceof String s) {
                try {
                    return java.util.UUID.fromString(s);
                } catch (IllegalArgumentException e) {
                    return null;
                }
            }
        }
        return null;
    }
}
