package io.restaurantos.kitchen;

import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.kitchen.service.TicketService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies ORDER_VOIDED handling:
 * - All tickets for the order are cancelled
 * - Re-processing the same void is idempotent (no error, still CANCELLED)
 */
@Transactional
class OrderVoidedCancelsTicketsIT extends KitchenTestBase {

    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired TicketService ticketService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID orderId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        orderId  = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    @Test
    void cancelTicketsForOrder_setsAllToCancelled() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(orderId, tenantId, branchId, "ORD-TEST", List.of(
                new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Burger", 1, "GRILL",  List.of(), null),
                new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Cola",   1, "DRINKS", List.of(), null)
        ), 1, null);
        ticketRoutingService.route(payload, "ORD-200");

        assertThat(ticketRepository.findByOrderId(orderId)).hasSize(2);

        ticketService.cancelTicketsForOrder(orderId);

        var tickets = ticketRepository.findByOrderId(orderId);
        assertThat(tickets).allMatch(t -> t.getStatus() == TicketStatus.CANCELLED);
    }

    @Test
    void cancelTicketsForOrder_isIdempotent() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(orderId, tenantId, branchId, "ORD-TEST", List.of(
                new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Pizza", 1, "OVEN", List.of(), null)
        ), 1, null);
        ticketRoutingService.route(payload, "ORD-201");

        ticketService.cancelTicketsForOrder(orderId);
        ticketService.cancelTicketsForOrder(orderId); // replay — idempotent

        var tickets = ticketRepository.findByOrderId(orderId);
        assertThat(tickets).hasSize(1);
        assertThat(tickets.get(0).getStatus()).isEqualTo(TicketStatus.CANCELLED);
    }
}
