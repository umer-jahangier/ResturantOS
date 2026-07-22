package io.restaurantos.inventory.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Response records for the per-branch on-hand stock read model (INV-15) — the first read path
 * over {@code ingredient_branch_stock}, which until now was write-only (receipts/transfers/
 * counts/opening-balance).
 */
public final class StockLevelDtos {

    private StockLevelDtos() {}

    /**
     * {@code categoryId}/{@code categoryName} are nullable in this plan and are populated by
     * plan 08.2-09 once the ingredient DTO exposes {@code item_categories}; the fields are
     * declared now so the frontend schema does not have to change twice.
     *
     * <p>{@code stockValuePaisa} is {@code qtyOnHand} multiplied by {@code avgCostPaisa}, rounded
     * HALF_UP to a whole paisa in the service layer (D-08: round only at the display/GL boundary,
     * never in the browser). {@code belowReorderPoint}/{@code nonPositive} are server-derived so
     * the stock screen's warning/destructive row washes can never drift from backend semantics.
     */
    public record StockLevelDto(
            UUID ingredientId,
            String ingredientName,
            String sku,
            String baseUomCode,
            UUID categoryId,
            String categoryName,
            BigDecimal qtyOnHand,
            BigDecimal reorderPoint,
            long avgCostPaisa,
            long stockValuePaisa,
            Instant lastCountedAt,
            boolean belowReorderPoint,
            boolean nonPositive) {}

    public record StockLevelsResponse(UUID branchId, List<StockLevelDto> items, long totalStockValuePaisa) {}
}
