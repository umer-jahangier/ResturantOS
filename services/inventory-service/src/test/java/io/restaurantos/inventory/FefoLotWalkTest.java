package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.service.DepletionService;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plain unit test — {@link DepletionService#walkFefoAndFloor} is a pure static utility over
 * hand-built {@link StockLot} objects, no Spring context / mocked repositories needed (mirrors
 * {@code MacCalculatorTest}'s precedent). Proves D-02 + D-04 composed: FEFO walk order, per-lot
 * floor-at-zero, and NULL-expiry (non-perishable) lots sorting last.
 */
class FefoLotWalkTest {

    @Test
    void demandOfFour_takesOldestLotFirst_thenNextLot() {
        StockLot d1 = lot(BigDecimal.valueOf(2), LocalDate.of(2026, 1, 1));
        StockLot d3 = lot(BigDecimal.valueOf(5), LocalDate.of(2026, 1, 3));
        List<StockLot> lots = new ArrayList<>(List.of(d1, d3));

        DepletionService.walkFefoAndFloor(lots, BigDecimal.valueOf(4));

        assertThat(d1.getQty()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(d3.getQty()).isEqualByComparingTo(BigDecimal.valueOf(3));
    }

    @Test
    void demandExceedsTotalLotQty_everyLotFloorsAtZero_noNegativeLotQty() {
        StockLot d1 = lot(BigDecimal.valueOf(2), LocalDate.of(2026, 1, 1));
        StockLot d3 = lot(BigDecimal.valueOf(5), LocalDate.of(2026, 1, 3));
        List<StockLot> lots = new ArrayList<>(List.of(d1, d3));

        // On-hand lots total 7; demand is 10 (oversell). Every lot floors at zero — the AGGREGATE
        // qty_on_hand (not this method's concern) is what drives negative by the FULL demand of 10.
        DepletionService.walkFefoAndFloor(lots, BigDecimal.valueOf(10));

        assertThat(d1.getQty()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(d3.getQty()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(d1.getQty().signum()).isZero();
        assertThat(d3.getQty().signum()).isZero();
    }

    @Test
    void nullExpiryLot_isWalkedAfterAllDatedLots() {
        StockLot nonPerishable = lot(BigDecimal.valueOf(3), null);
        StockLot dated = lot(BigDecimal.valueOf(2), LocalDate.of(2026, 1, 1));
        // Deliberately shuffled input order — walkFefoAndFloor must sort internally, not trust
        // caller order.
        List<StockLot> lots = new ArrayList<>(List.of(nonPerishable, dated));

        // Demand of 2 should be fully satisfied by the DATED lot alone; the null-expiry lot must
        // be untouched, proving it was walked after (not before/instead-of) the dated lot.
        DepletionService.walkFefoAndFloor(lots, BigDecimal.valueOf(2));

        assertThat(dated.getQty()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(nonPerishable.getQty()).isEqualByComparingTo(BigDecimal.valueOf(3));
    }

    private static StockLot lot(BigDecimal qty, LocalDate expiryDate) {
        StockLot lot = new StockLot();
        lot.setQty(qty);
        lot.setExpiryDate(expiryDate);
        lot.setReceiptUnitCostPaisa(999L); // deliberately distinct from any avg_cost_paisa used in
                                            // DepletionCogsTest — proves the FEFO walk never reads it.
        return lot;
    }
}
