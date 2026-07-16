package io.restaurantos.reporting.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.config.ReportingRabbitConfig;
import io.restaurantos.reporting.etl.PurchaseTaxFactWriter;
import io.restaurantos.reporting.event.ReportingEventPayloads.VendorInvoiceMatchedPayload;
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
 * Consumes VENDOR_INVOICE_MATCHED from purchasing.topic and lands purchase_tax_facts in
 * ClickHouse — the FBR INPUT TAX source for the Tax Summary report (12-05). The real published
 * payload carries no match timestamp field, so the business-day bucket (and matched_at column)
 * are derived from envelope.occurredAt() (see ReportingEventPayloads.VendorInvoiceMatchedPayload).
 */
@Component
public class VendorInvoiceMatchedConsumer {

    private static final Logger log = LoggerFactory.getLogger(VendorInvoiceMatchedConsumer.class);
    static final String CONSUMER_NAME = "reporting.invoice-matched";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final BranchTimeZoneResolver branchTimeZoneResolver;
    private final BusinessDay businessDay;
    private final PurchaseTaxFactWriter purchaseTaxFactWriter;
    private final ObjectMapper objectMapper;

    public VendorInvoiceMatchedConsumer(ProcessedEventService processedEventService,
                                         TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                         BranchTimeZoneResolver branchTimeZoneResolver,
                                         BusinessDay businessDay,
                                         PurchaseTaxFactWriter purchaseTaxFactWriter,
                                         @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.branchTimeZoneResolver = branchTimeZoneResolver;
        this.businessDay = businessDay;
        this.purchaseTaxFactWriter = purchaseTaxFactWriter;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = ReportingRabbitConfig.REPORTING_INVOICE_MATCHED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<VendorInvoiceMatchedPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("VendorInvoiceMatchedConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("VendorInvoiceMatchedConsumer: eventId={} invoiceId={}",
                envelope.eventId(), envelope.payload().invoiceId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env -> {
                    ZoneId zone = branchTimeZoneResolver.resolve(env.branchId());
                    LocalDate businessDate = businessDay.businessDate(env.occurredAt(), zone);
                    purchaseTaxFactWriter.write(env, businessDate);
                })
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<VendorInvoiceMatchedPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, VendorInvoiceMatchedPayload.class));
        } catch (Exception e) {
            log.error("VendorInvoiceMatchedConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }
}
