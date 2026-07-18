package io.restaurantos.inventory;

import io.restaurantos.inventory.dto.StockCountDtos.CountLineRequest;
import io.restaurantos.inventory.dto.StockCountDtos.CreateStockCountRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.service.StockCountService;
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

/**
 * INV-06 low-stock alert on reorder-point breach: a count adjustment driving {@code qty_on_hand}
 * to or below the ingredient's {@code reorder_point} publishes {@code LOW_STOCK_ALERT}; an
 * adjustment leaving {@code qty_on_hand} above the reorder point does not. Drives
 * {@link StockCountService} directly (bean-level) against a live Testcontainers Postgres.
 */
class LowStockAlertIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired StockCountService stockCountService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired OutboxRepository outboxRepository;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    @Test
    void countAdjustment_drivingQtyToOrBelowReorderPoint_publishesLowStockAlert() {
        UUID ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Basmati Rice", "SKU-LOW-001", "KG", BigDecimal.valueOf(10)).getId();
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId,
                BigDecimal.valueOf(50), 300L);

        // Count down to exactly the reorder point (10) -> breach (<=).
        stockCountService.postCount(new CreateStockCountRequest(
                branchId, List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(10)))));

        List<OutboxEntry> lowStockEntries = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "LOW_STOCK_ALERT".equals(e.getEventType()))
                .toList();
        assertThat(lowStockEntries).hasSize(1);
    }

    @Test
    void countAdjustment_leavingQtyAboveReorderPoint_publishesNoLowStockAlert() {
        UUID ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Basmati Rice", "SKU-LOW-002", "KG", BigDecimal.valueOf(10)).getId();
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId,
                BigDecimal.valueOf(50), 300L);

        // Count to well above the reorder point (10) -> no breach.
        stockCountService.postCount(new CreateStockCountRequest(
                branchId, List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(40)))));

        long lowStockCount = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "LOW_STOCK_ALERT".equals(e.getEventType()))
                .count();
        assertThat(lowStockCount).isZero();
    }
}
