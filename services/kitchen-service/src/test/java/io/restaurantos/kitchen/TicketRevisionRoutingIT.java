package io.restaurantos.kitchen;

import io.restaurantos.kitchen.dto.KdsTicketDto;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.ProcessedEventService;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.kitchen.service.TicketServiceImpl;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the core POS-12/KDS-03 fix (RESEARCH.md Pattern 2): a second ORDER_SENT_TO_KDS fire
 * for an order that already has a ticket at a station APPENDS the new items to the existing
 * ticket instead of being silently skipped — while true event-redelivery dedup (via
 * ProcessedEventService one layer up in the real consumer) is untouched by this service —
 * proven here by wrapping route() in ProcessedEventService.tryProcess exactly as
 * OrderSentToKdsConsumer does, with a fixed eventId replayed twice.
 */
@Transactional
class TicketRevisionRoutingIT extends KitchenTestBase {

    private static final String CONSUMER_NAME = "kitchen.order-sent";

    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired TicketServiceImpl ticketService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired ProcessedEventService processedEventService;
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
    void secondFire_appendsToSameTicket_stampsRevisionNoAndFiredAt_noDuplicateTicket() {
        // Rev 1: 2 items to GRILL — routed via ProcessedEventService, same as the real
        // consumer, so this test also proves redelivery of the SAME eventId is a no-op.
        UUID rev1EventId = UUID.randomUUID();
        OrderSentToKdsPayload rev1 = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-REV-001",
                List.of(
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Burger", 1, "GRILL", List.of(), null),
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Fries",  1, "GRILL", List.of(), null)
                ),
                1,
                "no onions",
                null
        );
        boolean firstProcessed = processedEventService.tryProcess(CONSUMER_NAME, rev1EventId,
                () -> ticketRoutingService.route(rev1, "ORD-REV-001"));
        assertThat(firstProcessed).isTrue();

        var afterRev1 = ticketRepository.findByOrderId(orderId);
        assertThat(afterRev1).hasSize(1);
        var ticketId = afterRev1.get(0).getId();
        assertThat(afterRev1.get(0).getItems()).hasSize(2);
        assertThat(afterRev1.get(0).getItems()).allMatch(i -> i.getRevisionNo() == 1);

        // Rev 2: 1 new item, SAME orderId + station
        OrderSentToKdsPayload rev2 = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-REV-001",
                List.of(
                        new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Cheesecake", 1, "GRILL", List.of(), null)
                ),
                2,
                "no onions",
                null
        );
        ticketRoutingService.route(rev2, "ORD-REV-001");

        var afterRev2 = ticketRepository.findByOrderId(orderId);
        assertThat(afterRev2).hasSize(1); // still one ticket — no duplicate row
        assertThat(afterRev2.get(0).getId()).isEqualTo(ticketId); // same ticket

        var items = afterRev2.get(0).getItems();
        assertThat(items).hasSize(3); // 2 (Rev 1) + 1 (Rev 2) appended

        var appendedItem = items.stream()
                .filter(i -> "Cheesecake".equals(i.getName()))
                .findFirst().orElseThrow();
        assertThat(appendedItem.getRevisionNo()).isEqualTo(2);
        assertThat(appendedItem.getFiredAt()).isNotNull();

        // Redelivery guard: re-processing the identical Rev 1 envelope (same eventId) via
        // ProcessedEventService is a no-op — action is never re-run, so no items are added.
        boolean redeliveryProcessed = processedEventService.tryProcess(CONSUMER_NAME, rev1EventId,
                () -> ticketRoutingService.route(rev1, "ORD-REV-001"));
        assertThat(redeliveryProcessed).isFalse();

        var afterRedelivery = ticketRepository.findByOrderId(orderId);
        assertThat(afterRedelivery).hasSize(1);
        assertThat(afterRedelivery.get(0).getItems()).hasSize(3); // unchanged — still 3, not 5
    }

    @Test
    void ticketDetail_returnsAllItemsWithRevisionNo() {
        OrderSentToKdsPayload rev1 = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-REV-002",
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Coffee", 1, "DRINKS", List.of(), null)),
                1,
                null,
                null
        );
        ticketRoutingService.route(rev1, "ORD-REV-002");

        var ticketId = ticketRepository.findByOrderId(orderId).get(0).getId();

        OrderSentToKdsPayload rev2 = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-REV-002",
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Tea", 1, "DRINKS", List.of(), null)),
                2,
                null,
                null
        );
        ticketRoutingService.route(rev2, "ORD-REV-002");

        KdsTicketDto detail = ticketService.getTicketDetail(ticketId);

        assertThat(detail.items()).hasSize(2);
        var revisionNumbers = detail.items().stream().map(KdsTicketDto.ItemDto::revisionNo).toList();
        assertThat(revisionNumbers).containsExactlyInAnyOrder(1, 2);
    }
}
