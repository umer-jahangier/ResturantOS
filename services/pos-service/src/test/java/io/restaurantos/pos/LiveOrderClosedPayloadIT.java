package io.restaurantos.pos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 08.1-05 (D-02 / INV-09 self-consistency proof): a menu item created via the REAL
 * {@code MenuServiceImpl.createItem} path (08.1-01) publishes {@code MENU_ITEM_UPSERTED} carrying
 * its menuItemId, and that SAME menu item, added to a real order driven to CLOSED through
 * {@link PosTestBase#closeViaServeAndPay} (the only real close path, mirrors
 * {@link SettlementSemanticsIT}), appears on the real {@code ORDER_CLOSED} payload's
 * {@code items[]} carrying the IDENTICAL menuItemId — the two halves of the catalog-sync contract
 * (what pos syncs vs. what pos sells) are not independently drifting.
 *
 * <p>Uses a plain {@link ObjectMapper} (not the tolerant {@code eventObjectMapper}) — this test
 * only reads a single UUID field back out of each envelope's JSON tree, never deserializes into a
 * strict/tolerant DTO, so no qualifier is needed.
 */
class LiveOrderClosedPayloadIT extends PosTestBase {

    @Autowired MenuService menuService;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    private final ObjectMapper mapper = new ObjectMapper();

    UUID tenantId;
    UUID branchId;
    UUID cashierId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        // TillServiceImpl.openTill requires an authenticated cashier (TenantContext.userId) —
        // mirrors AssignTableIT/OrderSummaryDtoIT's setUp precedent.
        tenantContext.set(tenantId, branchId, cashierId, null);

        // Finance period must be OPEN for recordPayment -> maybeCloseOrder to succeed
        // (mirrors SettlementSemanticsIT's setUp).
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        // createOrder's financial-integrity guard requires an OPEN till for the branch.
        openTillForCashier(branchId);
    }

    @Test
    void menuItemUpsertedAndOrderClosed_referenceTheIdenticalMenuItemId() throws Exception {
        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantId);
        category.setName("Mains-" + UUID.randomUUID());
        category.setSortOrder(1);
        category = menuCategoryRepository.save(category);

        MenuItemDto createdItem = menuService.createItem(new CreateMenuItemRequest(
                category.getId(), "Karahi", null, 20000L, null, null));
        UUID menuItemId = createdItem.id();

        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        closeViaServeAndPay(orderService, paymentService, order, branchId);

        List<OutboxEntry> upsertedEvents = outboxRepository.findAll().stream()
                .filter(e -> "MENU_ITEM_UPSERTED".equals(e.getEventType()))
                .toList();
        assertThat(upsertedEvents).hasSize(1);
        JsonNode upsertedPayload = mapper.readTree(upsertedEvents.get(0).getEnvelopeJson()).get("payload");
        UUID upsertedMenuItemId = UUID.fromString(upsertedPayload.get("menuItemId").asText());

        List<OutboxEntry> closedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .toList();
        assertThat(closedEvents).hasSize(1);
        JsonNode closedPayload = mapper.readTree(closedEvents.get(0).getEnvelopeJson()).get("payload");
        UUID closedItemMenuItemId = UUID.fromString(
                closedPayload.get("items").get(0).get("menuItemId").asText());

        assertThat(upsertedMenuItemId).isEqualTo(menuItemId);
        assertThat(closedItemMenuItemId).isEqualTo(menuItemId);
        assertThat(closedItemMenuItemId).isEqualTo(upsertedMenuItemId);
    }
}
