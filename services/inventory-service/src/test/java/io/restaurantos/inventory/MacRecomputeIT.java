package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiptResultDto;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiveStockRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.service.ReceiptService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * INV-04: receiving stock recomputes {@code avg_cost_paisa} via {@link
 * io.restaurantos.inventory.service.MacCalculator} (HALF_UP, D-02 oversell-reset policy), creates
 * a FEFO {@code StockLot} (expiry + receipt cost), and writes a {@code RECEIPT} movement whose
 * {@code total_cost_paisa = qty x receipt unit cost}. Drives {@link ReceiptService} directly
 * (bean-level) against a live Testcontainers Postgres — no HTTP/OPA involved, mirrors
 * {@code DepletionConsumerIT} calling its consumer bean directly rather than through MockMvc.
 */
class MacRecomputeIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired ReceiptService receiptService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired StockLotRepository lotRepository;
    @Autowired InventoryMovementRepository movementRepository;

    UUID tenantId;
    UUID branchId;
    UUID ingredientId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Flour", "SKU-MAC-001", "KG", BigDecimal.ZERO).getId();
    }

    @Test
    void receivingOntoExistingStock_recomputesWeightedAverageCost() {
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId, BigDecimal.TEN, 500L);

        ReceiptResultDto result = receiptService.receive(
                new ReceiveStockRequest(ingredientId, branchId, BigDecimal.TEN, 700L, null));

        assertThat(result.newQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(20));
        assertThat(result.newAvgCostPaisa()).isEqualTo(600L);

        Optional<IngredientBranchStock> stock =
                stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId);
        assertThat(stock).isPresent();
        assertThat(stock.get().getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(20));
        assertThat(stock.get().getAvgCostPaisa()).isEqualTo(600L);
    }

    @Test
    void receivingOntoZeroStock_resetsAvgCostToReceiptUnitCost() {
        ReceiptResultDto result = receiptService.receive(
                new ReceiveStockRequest(ingredientId, branchId, BigDecimal.TEN, 700L, null));

        assertThat(result.newAvgCostPaisa()).isEqualTo(700L);
        assertThat(result.newQtyOnHand()).isEqualByComparingTo(BigDecimal.TEN);
    }

    @Test
    void receipt_createsStockLotAndReceiptMovement() {
        LocalDate expiry = LocalDate.of(2026, 12, 31);

        ReceiptResultDto result = receiptService.receive(
                new ReceiveStockRequest(ingredientId, branchId, BigDecimal.valueOf(5), 300L, expiry));

        UUID stockId = stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow().getId();
        List<StockLot> lots = lotRepository.findByStockIdOrderByExpiryDateAsc(stockId);
        assertThat(lots).hasSize(1);
        assertThat(lots.get(0).getId()).isEqualTo(result.lotId());
        assertThat(lots.get(0).getExpiryDate()).isEqualTo(expiry);
        assertThat(lots.get(0).getReceiptUnitCostPaisa()).isEqualTo(300L);

        List<InventoryMovement> movements = movementRepository.findAll().stream()
                .filter(m -> m.getIngredientId().equals(ingredientId) && "RECEIPT".equals(m.getMovementType()))
                .toList();
        assertThat(movements).hasSize(1);
        assertThat(movements.get(0).getQty()).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(movements.get(0).getTotalCostPaisa()).isEqualTo(1500L);
        assertThat(movements.get(0).getReferenceId()).isEqualTo(result.lotId());
    }
}
