package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.*;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class TillReconciliationIT extends PosTestBase {

    @Autowired TillService tillService;
    @Autowired OrderService orderService;
    @Autowired TenantContext tenantContext;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Test Item");
        item.setBasePricePaisa(10000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();
    }

    @Test
    void openTill_createsOpenSession_and_TILL_OPENED_event() {
        OpenTillRequest req = new OpenTillRequest(branchId, 50000L);
        TillSessionDto dto = tillService.openTill(req);

        assertThat(dto.status().name()).isEqualTo("OPEN");
        assertThat(dto.openingFloatPaisa()).isEqualTo(50000L);
        assertThat(dto.cashierId()).isEqualTo(cashierId);

        long tillOpenedCount = outboxRepository.findAll().stream()
                .filter(e -> "TILL_OPENED".equals(e.getEventType()))
                .count();
        assertThat(tillOpenedCount).isEqualTo(1);
    }

    @Test
    void openTill_secondOpenForSameCashier_returns409() {
        tillService.openTill(new OpenTillRequest(branchId, 10000L));

        assertThatThrownBy(() -> tillService.openTill(new OpenTillRequest(branchId, 5000L)))
                .isInstanceOf(PosExceptions.TillAlreadyOpenException.class);
    }

    @Test
    void closeTill_withNonClosedOrder_throws409() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 10000L));

        // Create an OPEN order linked to this till session
        Order order = new Order();
        order.setTenantId(tenantId);
        order.setBranchId(branchId);
        order.setClientOrderId(UUID.randomUUID());
        order.setStatus(OrderStatus.OPEN);
        order.setTillSessionId(till.id());
        order.setOrderNo("TEST-001");
        order.setOpenedAt(Instant.now());
        orderRepository.save(order);

        assertThatThrownBy(() -> tillService.closeTill(till.id(), new CloseTillRequest(10000L)))
                .isInstanceOf(PosExceptions.TillHasOpenOrdersException.class);
    }

    @Test
    void closeTill_withAllOrdersTerminal_computesVariance_and_TILL_CLOSED_event() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 50000L));

        // Create a CLOSED order linked to this till
        Order order = new Order();
        order.setTenantId(tenantId);
        order.setBranchId(branchId);
        order.setClientOrderId(UUID.randomUUID());
        order.setStatus(OrderStatus.CLOSED);
        order.setTillSessionId(till.id());
        order.setOrderNo("TEST-002");
        order.setOpenedAt(Instant.now());
        orderRepository.save(order);

        // Close with declared cash = 60000 (no cash payments on order, so expected = float only = 50000)
        // Variance = 60000 - 50000 = 10000
        CloseTillRequest closeReq = new CloseTillRequest(60000L);
        TillSessionDto closed = tillService.closeTill(till.id(), closeReq);

        assertThat(closed.status().name()).isEqualTo("CLOSED");
        assertThat(closed.expectedClosingPaisa()).isEqualTo(50000L);
        assertThat(closed.declaredClosingPaisa()).isEqualTo(60000L);

        long tillClosedCount = outboxRepository.findAll().stream()
                .filter(e -> "TILL_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(tillClosedCount).isEqualTo(1);
    }
}
