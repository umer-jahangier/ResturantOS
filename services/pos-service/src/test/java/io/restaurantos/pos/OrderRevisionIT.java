package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Proves POS-12: sendToKds fires only newly-PENDING lines as an incrementing revision;
 * previously-fired lines are never re-sent. See RESEARCH.md Pattern 1 / Pitfall 1.
 */
class OrderRevisionIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID burgerId;
    UUID friesId;
    UUID cokeId;
    UUID cheesecakeId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        burgerId = seedMenuItem(cat, "Burger", 55000L);
        friesId = seedMenuItem(cat, "Fries", 25000L);
        cokeId = seedMenuItem(cat, "Coke", 15000L);
        cheesecakeId = seedMenuItem(cat, "Cheesecake", 45000L);

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    private UUID seedMenuItem(MenuCategory cat, String name, long pricePaisa) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName(name);
        item.setBasePricePaisa(pricePaisa);
        item.setTaxRatePct(new BigDecimal("0.00"));
        return menuItemRepository.save(item).getId();
    }

    private OrderDto createOrderWith(UUID... menuItemIds) {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        for (UUID menuItemId : menuItemIds) {
            orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        }
        return orderService.getOrder(order.id(), branchId);
    }

    @Test
    void secondFire_sendsOnlyNewlyAddedItem_asIncrementingRevision_priorLinesUntouched() {
        OrderDto order = createOrderWith(burgerId, friesId, cokeId);

        // Rev 1: fire all 3 PENDING lines.
        OrderDto afterRev1 = orderService.sendToKds(order.id(), null);
        assertThat(afterRev1.status()).isEqualTo(OrderStatus.SENT_TO_KDS);

        List<OutboxEntry> sentEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .toList();
        assertThat(sentEvents).hasSize(1);
        String rev1Payload = sentEvents.get(0).getEnvelopeJson();
        assertThat(rev1Payload).contains("\"revisionNo\":1");
        assertThat(countOccurrences(rev1Payload, "orderItemId")).isEqualTo(3);

        // All 3 lines are now SENT with revisionNo=1.
        Order afterRev1Entity = orderRepository.findByIdAndBranchId(order.id(), branchId).orElseThrow();
        assertThat(afterRev1Entity.getItems()).hasSize(3);
        afterRev1Entity.getItems().forEach(item -> {
            assertThat(item.getItemStatus()).isEqualTo(OrderItemStatus.SENT);
            assertThat(item.getRevisionNo()).isEqualTo(1);
            assertThat(item.getFiredAt()).isNotNull();
        });

        // Add Cheesecake — a new PENDING line — then fire Rev 2.
        orderService.addItem(order.id(), new AddOrderItemRequest(cheesecakeId, branchId, 1, null, null));
        OrderDto afterRev2 = orderService.sendToKds(order.id(), null);
        assertThat(afterRev2.status()).isEqualTo(OrderStatus.SENT_TO_KDS);

        List<OutboxEntry> sentEventsAfterRev2 = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .toList();
        assertThat(sentEventsAfterRev2).hasSize(2);
        String rev2Payload = sentEventsAfterRev2.get(1).getEnvelopeJson();
        assertThat(rev2Payload).contains("\"revisionNo\":2");
        assertThat(rev2Payload).contains("Cheesecake");
        // Only the new line — not Burger/Fries/Coke — appears in the Rev 2 payload.
        assertThat(countOccurrences(rev2Payload, "orderItemId")).isEqualTo(1);
        assertThat(rev2Payload).doesNotContain("Burger");
        assertThat(rev2Payload).doesNotContain("Fries");

        // Burger/Fries/Coke retained revisionNo=1/SENT (never re-fired); Cheesecake is
        // revisionNo=2/SENT.
        Order finalOrderEntity = orderRepository.findByIdAndBranchId(order.id(), branchId).orElseThrow();
        assertThat(finalOrderEntity.getItems()).hasSize(4);
        for (OrderItem item : finalOrderEntity.getItems()) {
            assertThat(item.getItemStatus()).isEqualTo(OrderItemStatus.SENT);
            if ("Cheesecake".equals(item.getItemNameSnapshot())) {
                assertThat(item.getRevisionNo()).isEqualTo(2);
            } else {
                assertThat(item.getRevisionNo()).isEqualTo(1);
            }
        }
    }

    @Test
    void addItem_permittedOn_sentToKdsOrder_thenReFiresSuccessfully() {
        OrderDto order = createOrderWith(burgerId);
        orderService.sendToKds(order.id(), null);

        // addItem on a SENT_TO_KDS order must succeed (loosened Task 1 guard) — not blocked.
        OrderDto withNewItem = orderService.addItem(order.id(), new AddOrderItemRequest(friesId, branchId, 1, null, null));
        assertThat(withNewItem.items()).hasSize(2);

        // And the subsequent fire must succeed too (symmetric guard, Pitfall 6) — no dead end.
        OrderDto rev2 = orderService.sendToKds(order.id(), null);
        assertThat(rev2.status()).isEqualTo(OrderStatus.SENT_TO_KDS);
    }

    @Test
    void addItem_rejectedOn_closedOrder() {
        OrderDto order = createOrderWith(burgerId);
        orderService.sendToKds(order.id(), null);

        var payments = List.of(new io.restaurantos.pos.service.SplitTenderCalculator.PaymentEntry(
                "CASH", orderService.getOrder(order.id(), branchId).totalPaisa(), null));
        OrderDto closed = orderService.closeOrder(order.id(), new CloseOrderRequest(payments), UUID.randomUUID().toString());
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        assertThatThrownBy(() ->
                orderService.addItem(order.id(), new AddOrderItemRequest(friesId, branchId, 1, null, null)))
                .isInstanceOf(io.restaurantos.shared.exception.StateInvalidException.class);
    }

    @Test
    void sendToKds_withNoNewPendingItems_throwsZeroValueOrderException() {
        OrderDto order = createOrderWith(burgerId);
        orderService.sendToKds(order.id(), null);

        assertThatThrownBy(() -> orderService.sendToKds(order.id(), null))
                .isInstanceOf(PosExceptions.ZeroValueOrderException.class);
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int idx = 0;
        while ((idx = haystack.indexOf(needle, idx)) != -1) {
            count++;
            idx += needle.length();
        }
        return count;
    }
}
