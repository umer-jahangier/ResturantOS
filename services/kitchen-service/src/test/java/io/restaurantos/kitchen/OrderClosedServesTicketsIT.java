package io.restaurantos.kitchen;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.kitchen.consumer.OrderClosedConsumer;
import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards the ORDER_CLOSED consumer's DESERIALIZE→serve path against producer-payload drift
 * (the class of bug that had this consumer silently dropping every message in production).
 *
 * <p>pos publishes the rich {@code PosClosePayloads.OrderClosedPayload} (14 fields — orderNo,
 * totals, payments, items, …) while the kitchen only needs {@code orderId}. The shared ObjectMapper
 * is STRICT ({@code FAIL_ON_UNKNOWN_PROPERTIES=true}), so the kitchen record must carry
 * {@code @JsonIgnoreProperties(ignoreUnknown=true)} or deserialization throws
 * {@code Unrecognized field "orderNo"} and the order's tickets never get marked SERVED.
 *
 * <p>Critically this test builds the envelope bytes from a LOCAL mirror of pos's full 14-field
 * wire shape (field names identical by construction) and feeds them through the real
 * {@link OrderClosedConsumer#onMessage} — the earlier direct-service tests never exercised the
 * deserialize step, which is exactly why the bug shipped. This mirrors the pos-side
 * KitchenItemStatusSyncIT parity-guard approach.
 */
@Transactional
class OrderClosedServesTicketsIT extends KitchenTestBase {

    @Autowired OrderClosedConsumer orderClosedConsumer;
    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;

    UUID tenantId;
    UUID branchId;
    UUID orderId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        orderId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    @Test
    void onMessage_fullPosWireShape_marksTicketsServed() throws Exception {
        // Route a ticket for the order so there is something to serve.
        OrderSentToKdsPayload sent = new OrderSentToKdsPayload(orderId, tenantId, branchId, "ORD-CLOSE-1", List.of(
                new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Burger", 1, "GRILL", List.of(), null)
        ), 1, null, null);
        ticketRoutingService.route(sent, "ORD-CLOSE-1");
        assertThat(ticketRepository.findByOrderId(orderId)).hasSize(1);

        // Build the envelope from the FULL 14-field pos wire shape (this is what actually broke).
        byte[] bytes = objectMapper.writeValueAsBytes(new EventEnvelope<>(
                UUID.randomUUID(), "ORDER_CLOSED", tenantId, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service",
                new PosShapedOrderClosedPayload(
                        orderId, "ORD-CLOSE-1", "DINE_IN", UUID.randomUUID(),
                        90000L, 0L, 0L, 4500L, 94500L,
                        List.of(), List.of(),
                        UUID.randomUUID(), UUID.randomUUID(), Instant.now())));

        orderClosedConsumer.onMessage(MessageBuilder.withBody(bytes).build());

        // Consumer cleared the message-scope context; restore it as a fresh delivery would.
        tenantContext.set(tenantId, branchId, null, null);
        var tickets = ticketRepository.findByOrderId(orderId);
        assertThat(tickets).hasSize(1);
        assertThat(tickets.get(0).getStatus()).isEqualTo(TicketStatus.SERVED);
    }

    /**
     * Local mirror of pos-service {@code PosClosePayloads.OrderClosedPayload} — field names
     * IDENTICAL to the producer by construction (kitchen-service is not a Maven dependency of, and
     * does not import, pos-service). Any real drift in pos's ORDER_CLOSED wire shape that reintroduced
     * a strict-deserialization failure would surface here. payments/items are emitted as empty arrays;
     * they (and every field but orderId) must be tolerated by the kitchen consumer record.
     */
    private record PosShapedOrderClosedPayload(
            UUID orderId,
            String orderNo,
            String type,
            UUID customerId,
            long subtotalPaisa,
            long discountPaisa,
            long serviceChargePaisa,
            long taxPaisa,
            long totalPaisa,
            List<Object> payments,
            List<Object> items,
            UUID tillSessionId,
            UUID cashierId,
            Instant closedAt
    ) {}
}
