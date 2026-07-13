package io.restaurantos.kitchen;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.kitchen.service.TicketServiceImpl;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies PENDING -> COOKING -> READY lifecycle for KDS tickets.
 * Asserts that ORDER_READY is published to outbox only when ALL tickets are READY.
 */
@Transactional
class TicketLifecycleIT extends KitchenTestBase {

    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired TicketServiceImpl ticketService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID orderId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        orderId  = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    @Test
    void progressAllItems_allTicketsReady_publishesOrderReady() {
        UUID orderItem1 = UUID.randomUUID();
        UUID orderItem2 = UUID.randomUUID();

        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(orderId, tenantId, branchId, "ORD-TEST", List.of(
                new OrderSentToKdsItem(orderItem1, UUID.randomUUID(), "Burger", 1, "GRILL",  List.of(), null),
                new OrderSentToKdsItem(orderItem2, UUID.randomUUID(), "Cola",   1, "DRINKS", List.of(), null)
        ), 1, null, null);
        ticketRoutingService.route(payload, "ORD-100");

        var tickets = ticketRepository.findByOrderId(orderId);
        assertThat(tickets).hasSize(2);

        // Progress GRILL ticket fully to READY
        var grillTicket = tickets.stream().filter(t -> "GRILL".equals(t.getStationCode())).findFirst().orElseThrow();
        var grillItem = grillTicket.getItems().get(0);
        ticketService.markItemStatus(grillTicket.getId(), grillItem.getId(), TicketItemStatus.COOKING);
        ticketService.markItemStatus(grillTicket.getId(), grillItem.getId(), TicketItemStatus.READY);

        // After only GRILL is READY — DRINKS still PENDING — no ORDER_READY yet
        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_READY".equals(e.getEventType()))
                .count()).isZero();

        // Progress DRINKS ticket fully to READY
        var drinksTicket = tickets.stream().filter(t -> "DRINKS".equals(t.getStationCode())).findFirst().orElseThrow();
        var drinksItem = drinksTicket.getItems().get(0);
        ticketService.markItemStatus(drinksTicket.getId(), drinksItem.getId(), TicketItemStatus.COOKING);
        ticketService.markItemStatus(drinksTicket.getId(), drinksItem.getId(), TicketItemStatus.READY);

        // Now all tickets READY — exactly one ORDER_READY event in outbox
        List<OutboxEntry> orderReadyEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_READY".equals(e.getEventType()))
                .toList();
        assertThat(orderReadyEvents).hasSize(1);
        assertThat(orderReadyEvents.get(0).getRoutingKey()).isEqualTo("kitchen.order.ready");
    }

    @Test
    void serveTicketItem_marksLineServed_andNoLongerBlocksTicket() {
        // A single GRILL ticket with two lines; only the first is READY, the ticket stays COOKING.
        UUID readyItem = UUID.randomUUID();
        UUID otherItem = UUID.randomUUID();
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(orderId, tenantId, branchId, "ORD-TEST", List.of(
                new OrderSentToKdsItem(readyItem, UUID.randomUUID(), "Karahi", 1, "GRILL", List.of(), null),
                new OrderSentToKdsItem(otherItem, UUID.randomUUID(), "Naan",   1, "GRILL", List.of(), null)
        ), 1, null, null);
        ticketRoutingService.route(payload, "ORD-102");

        var ticket = ticketRepository.findByOrderId(orderId).get(0);
        var line1 = ticket.getItems().stream().filter(i -> i.getOrderItemId().equals(readyItem)).findFirst().orElseThrow();
        ticketService.markItemStatus(ticket.getId(), line1.getId(), TicketItemStatus.COOKING);
        ticketService.markItemStatus(ticket.getId(), line1.getId(), TicketItemStatus.READY);
        assertThat(ticketRepository.findById(ticket.getId()).get().getStatus()).isEqualTo(TicketStatus.COOKING);

        // POS serves the READY line while the order is still open (the other line never fired-served).
        ticketService.serveTicketItem(readyItem);

        var reloaded = ticketRepository.findById(ticket.getId()).orElseThrow();
        var servedLine = reloaded.getItems().stream().filter(i -> i.getOrderItemId().equals(readyItem)).findFirst().orElseThrow();
        // The served line leaves the board (SERVED maps to no column) and no longer blocks the ticket.
        assertThat(servedLine.getStatus()).isEqualTo(TicketItemStatus.SERVED);

        // Idempotent: replaying the same serve is a no-op.
        ticketService.serveTicketItem(readyItem);
        assertThat(ticketRepository.findById(ticket.getId()).orElseThrow().getItems().stream()
                .filter(i -> i.getOrderItemId().equals(readyItem)).findFirst().orElseThrow()
                .getStatus()).isEqualTo(TicketItemStatus.SERVED);
    }

    @Test
    void progressOnlyOneTicket_noOrderReady() {
        UUID orderItem1 = UUID.randomUUID();
        UUID orderItem2 = UUID.randomUUID();

        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(orderId, tenantId, branchId, "ORD-TEST", List.of(
                new OrderSentToKdsItem(orderItem1, UUID.randomUUID(), "Steak", 1, "GRILL", List.of(), null),
                new OrderSentToKdsItem(orderItem2, UUID.randomUUID(), "Wine",  1, "BAR",   List.of(), null)
        ), 1, null, null);
        ticketRoutingService.route(payload, "ORD-101");

        var tickets = ticketRepository.findByOrderId(orderId);
        var grillTicket = tickets.stream().filter(t -> "GRILL".equals(t.getStationCode())).findFirst().orElseThrow();
        var grillItem = grillTicket.getItems().get(0);

        ticketService.markItemStatus(grillTicket.getId(), grillItem.getId(), TicketItemStatus.COOKING);
        ticketService.markItemStatus(grillTicket.getId(), grillItem.getId(), TicketItemStatus.READY);

        assertThat(ticketRepository.findById(grillTicket.getId()).get().getStatus()).isEqualTo(TicketStatus.READY);
        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_READY".equals(e.getEventType()))
                .count()).isZero();
    }
}
