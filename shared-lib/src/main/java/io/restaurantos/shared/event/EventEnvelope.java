package io.restaurantos.shared.event;

import java.time.Instant;
import java.util.UUID;

/**
 * Canonical event envelope transmitted on every RabbitMQ exchange.
 * Matches agent-spec 02 §2.1 and agent-spec 03 §3.10.
 *
 * <h2>{@link #actorId} and {@link #impersonatedBy} (15-01)</h2>
 *
 * <p>Both were added because the audit trail could not say <b>who</b> did anything.
 * {@code AuditIngestionService} used to recover the actor by fishing a {@code "userId"} key out of
 * the payload map, so a payload that named it {@code actorId}, {@code approvedBy}, {@code closedBy}
 * or {@code createdBy} — which is most of them — produced an audit row with a NULL actor. An audit
 * row that cannot name the person is not an audit row. The actor now travels in the envelope, is
 * populated once by {@link DomainEventPublisher} from the verified {@code TenantContext}, and is
 * therefore present on every event whatever shape its payload happens to have.
 *
 * <p>{@code impersonatedBy} is the REAL platform administrator behind an impersonated session. It
 * is taken from the {@code impersonated_by} JWT claim (via {@code TenantContext}), <b>never</b> from
 * the {@code X-Impersonated-By} request header. The gateway does emit that header, but the header is
 * a transport convenience and the claim is signature-verified end to end; reading the header would
 * make the field only as trustworthy as the weakest hop that could set it. When an action is taken
 * under impersonation, {@code actorId} is the account that was acted AS and {@code impersonatedBy}
 * is the human who did it — the trail needs both, and attributing the action solely to the
 * impersonated user is the D-34 defect class in a different table.
 *
 * <h2>Adding fields here is safe; renaming one is not</h2>
 *
 * <p>Consumers parse with {@code eventObjectMapper}, whose {@code FAIL_ON_UNKNOWN_PROPERTIES} is
 * disabled ({@code EventEnvelopeReader}), so a producer adding a component does not break a
 * consumer that has not been redeployed. The nine-argument constructor below is retained for the
 * same reason in the other direction: ~30 existing call sites (all tests) construct envelopes
 * positionally, and an envelope built without an actor is a legitimate thing for a test to do.
 * Both new components are therefore nullable by construction.
 */
public record EventEnvelope<T>(
        UUID eventId,
        String eventType,
        UUID tenantId,
        UUID branchId,
        Instant occurredAt,
        UUID correlationId,
        int schemaVersion,
        String source,
        T payload,
        UUID actorId,
        UUID impersonatedBy) {

    /**
     * The pre-15-01 shape, with no actor and no impersonator.
     *
     * <p>Retained so that existing positional call sites keep compiling and so that a message
     * produced before this phase deserializes into a well-formed envelope with null actor fields
     * rather than failing. Production code publishes through {@link DomainEventPublisher}, which
     * always uses the canonical constructor.
     */
    public EventEnvelope(UUID eventId, String eventType, UUID tenantId, UUID branchId,
                         Instant occurredAt, UUID correlationId, int schemaVersion,
                         String source, T payload) {
        this(eventId, eventType, tenantId, branchId, occurredAt, correlationId, schemaVersion,
             source, payload, null, null);
    }
}
