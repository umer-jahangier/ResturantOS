package io.restaurantos.audit.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.audit.service.AuditIngestionService;
import io.restaurantos.audit.service.ProcessedEventService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Consumes ALL domain events from audit.all-events.queue.
 * The queue is already bound to all 9 topic exchanges with '#' in rabbitmq-definitions.json.
 *
 * Idempotent: duplicate events with the same eventId are skipped via processed_events dedup.
 * Tenant-aware: TenantAwareMessageProcessor sets TenantContext + RLS GUC before ingestion.
 */
@Component
@Slf4j
public class AllEventsConsumer {

    static final String CONSUMER_NAME = "audit.all-events";
    static final String QUEUE_NAME = "audit.all-events.queue";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final AuditIngestionService auditIngestionService;
    private final ObjectMapper objectMapper;

    public AllEventsConsumer(ProcessedEventService processedEventService,
                             TenantAwareMessageProcessor tenantAwareMessageProcessor,
                             AuditIngestionService auditIngestionService,
                             ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.auditIngestionService = auditIngestionService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = QUEUE_NAME)
    public void onMessage(Message message) {
        EventEnvelope<Map<String, Object>> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("AllEventsConsumer: could not deserialize message, skipping");
            return;
        }

        log.debug("AllEventsConsumer: received eventId={} type={}", envelope.eventId(), envelope.eventType());

        processedEventService.tryProcess(
                CONSUMER_NAME,
                envelope.eventId(),
                () -> tenantAwareMessageProcessor.process(
                        envelope,
                        env -> auditIngestionService.ingest(env)
                )
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<Map<String, Object>> deserialize(Message message) {
        try {
            byte[] body = message.getBody();
            return objectMapper.readValue(body,
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, Map.class));
        } catch (Exception e) {
            log.error("AllEventsConsumer: failed to deserialize message: {}", e.getMessage());
            return null;
        }
    }
}
