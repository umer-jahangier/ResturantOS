package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.dto.StockCountDtos.CountLineRequest;
import io.restaurantos.inventory.dto.StockCountDtos.CreateStockCountRequest;
import io.restaurantos.inventory.dto.StockCountDtos.StockCountDto;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
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
 * INV-06 count-variance posting: posting a count with {@code countedQty > systemQty} raises
 * {@code qty_on_hand} by the variance, writes a {@code COUNT_VARIANCE} movement with
 * {@code varianceCostPaisa = round(varianceQty x avg_cost_paisa)}, sets the count POSTED, and
 * publishes {@code COUNT_VARIANCE_POSTED}; {@code countedQty < systemQty} lowers {@code qty_on_hand}
 * (shrinkage) and records a negative variance. Drives {@link StockCountService} directly
 * (bean-level, no HTTP/OPA) against a live Testcontainers Postgres — mirrors
 * {@code TransferLifecycleIT}'s precedent.
 */
class StockCountIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired StockCountService stockCountService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired OutboxRepository outboxRepository;

    UUID tenantId;
    UUID branchId;
    UUID ingredientId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Flour", "SKU-COUNT-001", "KG", BigDecimal.ZERO).getId();
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId,
                BigDecimal.valueOf(50), 400L);
    }

    @Test
    void countedQtyGreaterThanSystemQty_raisesQtyOnHand_writesPositiveCountVarianceMovement_postsCount() {
        StockCountDto posted = stockCountService.postCount(new CreateStockCountRequest(
                branchId, List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(60)))));

        assertThat(posted.status()).isEqualTo("POSTED");
        assertThat(posted.lines()).hasSize(1);
        assertThat(posted.lines().get(0).systemQty()).isEqualByComparingTo(BigDecimal.valueOf(50));
        assertThat(posted.lines().get(0).countedQty()).isEqualByComparingTo(BigDecimal.valueOf(60));
        assertThat(posted.lines().get(0).varianceQty()).isEqualByComparingTo(BigDecimal.valueOf(10)); // 60 - 50
        assertThat(posted.lines().get(0).varianceCostPaisa()).isEqualTo(4000L); // 10 * 400

        IngredientBranchStock stock = stockRepository
                .findByBranchIdAndIngredientId(branchId, ingredientId).orElseThrow();
        assertThat(stock.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(60));

        List<InventoryMovement> movements = movementRepository.findByReferenceId(posted.countId());
        assertThat(movements).hasSize(1);
        assertThat(movements.get(0).getMovementType()).isEqualTo("COUNT_VARIANCE");
        assertThat(movements.get(0).getQty()).isEqualByComparingTo(BigDecimal.valueOf(10));
        assertThat(movements.get(0).getTotalCostPaisa()).isEqualTo(4000L);

        List<OutboxEntry> countPostedEntries = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "COUNT_VARIANCE_POSTED".equals(e.getEventType()))
                .toList();
        assertThat(countPostedEntries).hasSize(1);
    }

    @Test
    void countedQtyLessThanSystemQty_lowersQtyOnHand_recordsNegativeVariance() {
        StockCountDto posted = stockCountService.postCount(new CreateStockCountRequest(
                branchId, List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(35)))));

        assertThat(posted.lines().get(0).varianceQty()).isEqualByComparingTo(BigDecimal.valueOf(-15)); // 35 - 50
        assertThat(posted.lines().get(0).varianceCostPaisa()).isEqualTo(-6000L); // -15 * 400

        IngredientBranchStock stock = stockRepository
                .findByBranchIdAndIngredientId(branchId, ingredientId).orElseThrow();
        assertThat(stock.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(35));

        List<InventoryMovement> movements = movementRepository.findByReferenceId(posted.countId());
        assertThat(movements).hasSize(1);
        assertThat(movements.get(0).getQty()).isEqualByComparingTo(BigDecimal.valueOf(-15));
    }
}
