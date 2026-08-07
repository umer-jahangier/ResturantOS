package io.restaurantos.shared.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

/**
 * Transactional outbox publisher (resolves MAJOR-12).
 * Serializes the payload as an EventEnvelope JSON String and INSERTs an OutboxEntry
 * inside the CALLER's @Transactional business transaction.
 * The OutboxRelay polls and delivers to RabbitMQ at-least-once after commit.
 *
 * Payload is stored as a JSON String column (not bytes) so the relay can
 * publish the raw bytes directly without re-serialization (no double-encode — SC5 gotcha).
 *
 * <h2>{@code source} is this service's own name, and cannot be forgotten (15-01)</h2>
 *
 * <p>Every event this class produced used to carry the literal string {@code "shared-lib"}, because
 * that is what was hardcoded here and on {@link OutboxEntry#setSource}. Measured on 2026-08-07:
 * every row of {@code event_outbox} in every database read {@code shared-lib} — 1,390 of them in
 * {@code auth_db} alone. audit-service's {@code ALWAYS_AUDIT_SOURCES = {auth-service,
 * platform-admin-service}} rule therefore matched nothing that had ever been published, and the
 * "all security-sensitive events are audited" guarantee was inert from the day it was written.
 * A library naming itself as the origin of every event in the system is never the useful answer:
 * the question the trail has to answer is <em>which service did this</em>.
 *
 * <p>The name is a <b>constructor argument bound once from {@code spring.application.name}</b>,
 * deliberately rather than a per-call parameter. There are 43 publish call sites across 10 services;
 * a per-call argument is 43 chances to pass the wrong string and no way to notice, which is the same
 * failure mode one indirection further out. Being a constructor argument also means the value is
 * validated at context startup — {@link #requireServiceName} rejects blank and rejects
 * {@code "shared-lib"} itself, so a service that loses its application name fails to start instead
 * of quietly publishing anonymous events for a month.
 *
 * <h2>Why a failure here is allowed to roll back the business transaction</h2>
 *
 * <p>This method runs inside the caller's transaction on purpose: the outbox row and the sale commit
 * or fail together, which is the entire reason the outbox pattern exists. That is not in tension
 * with "a failure to audit must not roll back a completed sale", because nothing that can fail at
 * this point is an audit failure. The only failure mode here is payload serialization, which is a
 * programming error in a payload record — deterministic, caught by the contract tests, and never a
 * transient runtime condition. Everything that genuinely can fail transiently — broker delivery,
 * audit ingestion, the audit database — happens after commit, in {@link OutboxRelay} and in
 * audit-service, where a failure retries and then dead-letters and the sale is long since durable.
 * See {@code 15-CONTEXT.md} D-3.
 */
public class DomainEventPublisher implements EventPublisher {

    private final OutboxRepository outboxRepository;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    /** This service's own identity, e.g. {@code auth-service}. Never {@code shared-lib}. */
    private final String serviceName;

    public DomainEventPublisher(OutboxRepository outboxRepository,
                                TenantContext tenantContext,
                                ObjectMapper objectMapper,
                                String serviceName) {
        this.outboxRepository = outboxRepository;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
        this.serviceName = requireServiceName(serviceName);
    }

    @Override
    @Transactional
    public void publish(String exchange, String routingKey, String eventType, UUID branchId, Object payload) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID eventId = UUID.randomUUID();
        UUID correlationId = UUID.randomUUID();

        // The actor and the real human behind an impersonated session, captured once here so that
        // every event carries them regardless of what its payload happens to be shaped like.
        // Both come from the verified JWT via TenantContext and from nothing else.
        UUID actorId = tenantContext.getUserId().orElse(null);
        UUID impersonatedBy = tenantContext.getImpersonatedBy().orElse(null);

        EventEnvelope<Object> envelope = new EventEnvelope<>(
            eventId, eventType, tenantId, branchId,
            Instant.now(), correlationId, 1, serviceName, payload,
            actorId, impersonatedBy);

        String envelopeJson;
        try {
            envelopeJson = objectMapper.writeValueAsString(envelope);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize EventEnvelope for eventType=" + eventType, e);
        }

        OutboxEntry entry = new OutboxEntry();
        entry.setEventId(eventId);
        entry.setExchange(exchange);
        entry.setRoutingKey(routingKey);
        entry.setEventType(eventType);
        entry.setTenantId(tenantId);
        entry.setBranchId(branchId);
        entry.setCorrelationId(correlationId);
        entry.setSource(serviceName);
        entry.setEnvelopeJson(envelopeJson);
        entry.setStatus("PENDING");
        entry.setCreatedAt(Instant.now());

        outboxRepository.save(entry);
    }

    /**
     * Fail at startup rather than publish anonymous events.
     *
     * <p>{@code "shared-lib"} is rejected explicitly and by name: it is the exact value this class
     * used to hardcode, so it is the one string that would silently reinstate the defect if it were
     * ever wired back in through configuration.
     */
    private static String requireServiceName(String serviceName) {
        String trimmed = serviceName == null ? "" : serviceName.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalStateException(
                "spring.application.name is not set. Every domain event records the service that "
                    + "produced it, and audit routing keys off that name — an unnamed publisher "
                    + "produces events no auditor can attribute.");
        }
        if (trimmed.toLowerCase(Locale.ROOT).equals("shared-lib")) {
            throw new IllegalStateException(
                "spring.application.name is 'shared-lib', which is a library and not a service. "
                    + "This is the exact value that made ALWAYS_AUDIT_SOURCES inert for the whole "
                    + "of phases 1-14; set the owning service's own name.");
        }
        return trimmed;
    }
}
