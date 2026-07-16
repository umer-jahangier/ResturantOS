package io.restaurantos.reporting.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.config.ReportingRabbitConfig;
import io.restaurantos.reporting.etl.SalesFactWriter;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
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
 * Consumes ORDER_CLOSED from pos.topic and lands sales_order_facts + sales_item_facts in
 * ClickHouse. Idempotent via processed_events; tenant-aware via TenantAwareMessageProcessor.
 * The business-day bucket is derived from the payload's own closedAt timestamp — NOT
 * envelope.occurredAt() and definitely not Instant.now() — because the business day of a sale is
 * a property of the sale.
 */
@Component
public class OrderClosedConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderClosedConsumer.class);
    static final String CONSUMER_NAME = "reporting.order-closed";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final BranchTimeZoneResolver branchTimeZoneResolver;
    private final BusinessDay businessDay;
    private final SalesFactWriter salesFactWriter;
    private final ObjectMapper objectMapper;

    public OrderClosedConsumer(ProcessedEventService processedEventService,
                                TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                BranchTimeZoneResolver branchTimeZoneResolver,
                                BusinessDay businessDay,
                                SalesFactWriter salesFactWriter,
                                @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.branchTimeZoneResolver = branchTimeZoneResolver;
        this.businessDay = businessDay;
        this.salesFactWriter = salesFactWriter;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = ReportingRabbitConfig.REPORTING_ORDER_CLOSED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderClosedPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("OrderClosedConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("OrderClosedConsumer: eventId={} orderId={}",
                envelope.eventId(), envelope.payload().orderId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env -> {
                    ZoneId zone = branchTimeZoneResolver.resolve(env.branchId());
                    LocalDate businessDate = businessDay.businessDate(env.payload().closedAt(), zone);
                    salesFactWriter.write(env, businessDate);
                })
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<OrderClosedPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, OrderClosedPayload.class));
        } catch (Exception e) {
            // Poison message — reject WITHOUT requeue so it dead-letters to the DLQ immediately
            // instead of being acked and silently lost.
            log.error("OrderClosedConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }
}
