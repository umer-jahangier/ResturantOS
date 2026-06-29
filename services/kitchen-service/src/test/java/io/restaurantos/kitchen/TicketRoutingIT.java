package io.restaurantos.kitchen;

import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies ORDER_SENT_TO_KDS routing:
 * - Items grouped by station (null → DEFAULT), one ticket per (order, station)
 * - Re-delivery of same payload is idempotent (no duplicate tickets)
 */
@Transactional
class TicketRoutingIT extends KitchenTestBase {

    @Autowired TicketRoutingService ticketRoutingService;
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
    void route_createsOneTicketPerStation() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId,
                List.of(
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Burger",  1, "GRILL",  List.of("Extra Cheese"), null),
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Fries",   1, "GRILL",  List.of(), null),
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Cola",    2, "DRINKS", List.of(), null),
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Sauce",   1, null,     List.of(), "extra hot")
                )
        );

        ticketRoutingService.route(payload, "ORD-001");

        var tickets = ticketRepository.findByOrderId(orderId);
        assertThat(tickets).hasSize(3);

        var stationCodes = tickets.stream().map(t -> t.getStationCode()).toList();
        assertThat(stationCodes).containsExactlyInAnyOrder("GRILL", "DRINKS", "DEFAULT");

        var grillTicket = tickets.stream().filter(t -> "GRILL".equals(t.getStationCode())).findFirst().orElseThrow();
        assertThat(grillTicket.getItems()).hasSize(2);

        var defaultTicket = tickets.stream().filter(t -> "DEFAULT".equals(t.getStationCode())).findFirst().orElseThrow();
        assertThat(defaultTicket.getItems()).hasSize(1);
        assertThat(defaultTicket.getItems().get(0).getNotes()).isEqualTo("extra hot");
    }

    @Test
    void route_isIdempotent_onRedelivery() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId,
                List.of(
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Pizza", 1, "OVEN", List.of(), null),
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Water", 1, null,   List.of(), null)
                )
        );

        ticketRoutingService.route(payload, "ORD-002");
        ticketRoutingService.route(payload, "ORD-002"); // second delivery — idempotent

        var tickets = ticketRepository.findByOrderId(orderId);
        assertThat(tickets).hasSize(2); // still only 2 stations
    }
}
