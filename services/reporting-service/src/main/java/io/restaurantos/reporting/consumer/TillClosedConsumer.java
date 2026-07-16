package io.restaurantos.reporting.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.config.ReportingRabbitConfig;
import io.restaurantos.reporting.etl.TillSessionFactWriter;
import io.restaurantos.reporting.event.ReportingEventPayloads.TillClosedPayload;
import io.restaurantos.reporting.service.ProcessedEventService;
import io.restaurantos.reporting.support.BranchTimeZoneResolver;
import io.restaurantos.reporting.support.BusinessDay;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Consumes TILL_CLOSED from pos.topic and lands till_session_facts in ClickHouse. The real
 * published payload carries no closed-timestamp field, so the business-day bucket (and
 * closed_at column) are derived from envelope.occurredAt() — the closest available approximation
 * to "when the till actually closed" (see ReportingEventPayloads.TillClosedPayload).
 */
@Component
public class TillClosedConsumer {

    private static final Logger log = LoggerFactory.getLogger(TillClosedConsumer.class);
    static final String CONSUMER_NAME = "reporting.till-closed";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final BranchTimeZoneResolver branchTimeZoneResolver;
    private final BusinessDay businessDay;
    private final TillSessionFactWriter tillSessionFactWriter;
    private final ObjectMapper objectMapper;

    public TillClosedConsumer(ProcessedEventService processedEventService,
                               TenantAwareMessageProcessor tenantAwareMessageProcessor,
                               BranchTimeZoneResolver branchTimeZoneResolver,
                               BusinessDay businessDay,
                               TillSessionFactWriter tillSessionFactWriter,
                               @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.branchTimeZoneResolver = branchTimeZoneResolver;
        this.businessDay = businessDay;
        this.tillSessionFactWriter = tillSessionFactWriter;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = ReportingRabbitConfig.REPORTING_TILL_CLOSED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<TillClosedPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("TillClosedConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("TillClosedConsumer: eventId={} tillSessionId={}",
                envelope.eventId(), envelope.payload().tillSessionId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env -> {
                    ZoneId zone = branchTimeZoneResolver.resolve(env.branchId());
                    LocalDate businessDate = businessDay.businessDate(env.occurredAt(), zone);
                    tillSessionFactWriter.write(env, businessDate);
                })
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<TillClosedPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, TillClosedPayload.class));
        } catch (Exception e) {
            log.error("TillClosedConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }
}
