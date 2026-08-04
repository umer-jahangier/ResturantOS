package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.service.DepletionService;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plain unit test — {@link DepletionService#computeCogsPaisa} is a pure static utility, no Spring
 * context needed (mirrors {@code MacCalculatorTest}'s precedent). Proves D-04 / Pitfall 9: COGS is
 * valued at the aggregate moving-average cost ({@code avg_cost_paisa}), never a touched lot's own
 * {@code receipt_unit_cost_paisa}.
 */
class DepletionCogsTest {

    @Test
    void cogs_equalsEffectiveBaseQtyTimesAvgCost_regardlessOfTouchedLotsReceiptCost() {
        // Lots deliberately carry a receipt cost (900, 1200) far from avg_cost_paisa=600 — if COGS
        // were ever mistakenly re-derived from lot cost instead of MAC, this assertion would fail.
        StockLot lot1 = lot(BigDecimal.valueOf(2), LocalDate.of(2026, 1, 1), 900L);
        StockLot lot2 = lot(BigDecimal.valueOf(5), LocalDate.of(2026, 1, 3), 1200L);
        List<StockLot> lots = new java.util.ArrayList<>(List.of(lot1, lot2));

        BigDecimal effectiveBaseQty = BigDecimal.valueOf(3);
        DepletionService.walkFefoAndFloor(lots, effectiveBaseQty);

        long cogsPaisa = DepletionService.computeCogsPaisa(effectiveBaseQty, 600L);

        assertThat(cogsPaisa).isEqualTo(1800L);
    }

    @Test
    void cogs_fractionalProduct_roundsHalfUp() {
        // 2.5 * 333 = 832.5 -> HALF_UP -> 833 (never floored to 832).
        long cogsPaisa = DepletionService.computeCogsPaisa(new BigDecimal("2.5"), 333L);

        assertThat(cogsPaisa).isEqualTo(833L);
    }

    private static StockLot lot(BigDecimal qty, LocalDate expiryDate, long receiptUnitCostPaisa) {
        StockLot lot = new StockLot();
        lot.setQty(qty);
        lot.setExpiryDate(expiryDate);
        lot.setReceiptUnitCostPaisa(receiptUnitCostPaisa);
        return lot;
    }
}
