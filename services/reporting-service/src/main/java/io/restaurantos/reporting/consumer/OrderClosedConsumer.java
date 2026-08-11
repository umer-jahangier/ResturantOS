package io.restaurantos.reporting.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.config.ReportingRabbitConfig;
import io.restaurantos.reporting.etl.SalesFactWriter;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
import io.restaurantos.reporting.service.DashboardTileService;
import io.restaurantos.reporting.service.ProcessedEventService;
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

/**
 * Consumes ORDER_CLOSED from pos.topic and lands sales_order_facts + sales_item_facts in
 * ClickHouse. Idempotent via processed_events; tenant-aware via TenantAwareMessageProcessor.
 * The business-day bucket is READ from the payload's businessDate field — the value pos-service
 * resolved once, checked the accounting period against, and that finance dates the journal entry
 * from. It is deliberately NOT re-derived here: this consumer used to recompute it from closedAt
 * against the branch timezone, which disagreed with pos for anything closed between 23:00Z and
 * 04:00Z at a UTC+5 branch, and put 26 real orders on a different day from their own journal
 * entries. BranchTimeZoneResolver and BusinessDay are intentionally absent from this class; the
 * till consumer still needs them, because its payload genuinely carries no date.
 */
@Component
public class OrderClosedConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderClosedConsumer.class);
    static final String CONSUMER_NAME = "reporting.order-closed";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final SalesFactWriter salesFactWriter;
    private final DashboardTileService dashboardTileService;
    private final ObjectMapper objectMapper;

    public OrderClosedConsumer(ProcessedEventService processedEventService,
                                TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                SalesFactWriter salesFactWriter,
                                DashboardTileService dashboardTileService,
                                @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.salesFactWriter = salesFactWriter;
        this.dashboardTileService = dashboardTileService;
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

        // Read, never re-derive. See the field's javadoc on OrderClosedPayload for the divergence
        // this closes. Checked BEFORE tryProcess so a payload missing the field does not burn its
        // idempotency slot on a message that was never landed.
        LocalDate businessDate = envelope.payload().businessDate();
        if (businessDate == null) {
            // Deliberately NOT a fallback to recomputation. A silent fallback would reintroduce
            // exactly the ledger/report divergence being fixed, and would do it invisibly — which
            // is worse than the original defect, because the original at least produced a stable
            // wrong answer that an audit could find. Dead-letter it and name the field.
            log.error("OrderClosedConsumer: ORDER_CLOSED payload has no businessDate — orderId={} eventId={}. "
                            + "Routing to DLQ rather than re-deriving the trading day.",
                    envelope.payload().orderId(), envelope.eventId());
            throw new AmqpRejectAndDontRequeueException(
                    "ORDER_CLOSED payload is missing the required 'businessDate' field for orderId="
                            + envelope.payload().orderId());
        }

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env -> {
                    salesFactWriter.write(env, businessDate);

                    // A dashboard-push failure must NEVER poison the ETL: this call is wrapped and
                    // swallowed. The fact row above is the durable truth; the WS push is cosmetic.
                    // If an exception escaped here, it would roll back this tenantAwareMessageProcessor
                    // block, undo the processed_events guard, and the event would be redelivered
                    // forever — a broken dashboard would take out the ETL. DO NOT remove this catch.
                    try {
                        dashboardTileService.recomputeAndPush(env.tenantId(), env.branchId(), businessDate);
                    } catch (Exception e) {
                        log.warn("OrderClosedConsumer: dashboard tile push failed for branchId={}: {}",
                                env.branchId(), e.getMessage());
                    }
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
