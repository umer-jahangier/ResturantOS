package io.restaurantos.shared.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;

/**
 * The one sanctioned way to turn a RabbitMQ {@link Message} into a typed {@link EventEnvelope}.
 *
 * <p><b>Why this exists.</b> Nine consumers across finance-service and crm-service each carried
 * their own copy of:
 *
 * <pre>
 *   try { return objectMapper.readValue(...); }
 *   catch (Exception e) { log.error(...); return null; }   // caller then returns
 * </pre>
 *
 * <p>Returning normally from a {@code @RabbitListener} ACKs the message. So an event that could
 * not be parsed was <b>acknowledged and destroyed</b> — no retry, no dead-letter, no alert, one
 * log line. For financial events that is silent data loss. reporting-service, written later, had
 * already worked out the right shape; this class is that shape, extracted so the decision is made
 * once instead of nine times.
 *
 * <p>Two deliberate choices:
 * <ul>
 *   <li><b>Tolerant reader.</b> Parses with {@code eventObjectMapper}
 *       ({@code FAIL_ON_UNKNOWN_PROPERTIES} disabled), so a producer ADDING a field does not break
 *       consumers that have not been redeployed. Renames and type changes still fail loudly —
 *       which is the point, and is exactly what the shared payload contracts in
 *       {@code io.restaurantos.shared.event.payload} now make a compile error instead.</li>
 *   <li><b>Poison messages dead-letter.</b> A parse failure throws
 *       {@link AmqpRejectAndDontRequeueException}, so the broker routes the message to the queue's
 *       DLQ immediately rather than either dropping it or spinning on redelivery.</li>
 * </ul>
 */
public class EventEnvelopeReader {

    private static final Logger log = LoggerFactory.getLogger(EventEnvelopeReader.class);

    private final ObjectMapper eventObjectMapper;

    public EventEnvelopeReader(ObjectMapper eventObjectMapper) {
        this.eventObjectMapper = eventObjectMapper;
    }

    /**
     * @throws AmqpRejectAndDontRequeueException if the body cannot be parsed as an envelope of
     *         {@code payloadType} — the message dead-letters instead of being silently discarded
     */
    public <T> EventEnvelope<T> read(Message message, Class<T> payloadType) {
        try {
            return eventObjectMapper.readValue(
                    message.getBody(),
                    eventObjectMapper.getTypeFactory()
                            .constructParametricType(EventEnvelope.class, payloadType));
        } catch (Exception e) {
            log.error("Undeserializable {} message, routing to DLQ: {}",
                    payloadType.getSimpleName(), e.getMessage());
            throw new AmqpRejectAndDontRequeueException(
                    "Could not deserialize envelope of " + payloadType.getName(), e);
        }
    }
}
