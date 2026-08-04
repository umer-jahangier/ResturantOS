package io.restaurantos.inventory.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** Response records for the reorder-shortfall read model. */
public final class ReorderDtos {

    private ReorderDtos() {}

    /**
     * One item that has fallen to or below its reorder point at a branch, with how much it would
     * take to bring it back to par.
     *
     * <p>{@code suggestedQty} is {@code parLevel - qtyOnHand}, in the item's STOCK unit. It is null
     * exactly when {@code blockedReason} is non-null — a row that cannot produce a number still
     * appears, carrying the reason, rather than being dropped. Silently omitting it would show a
     * manager a short list and let them conclude nothing else needs ordering.
     */
    public record ReorderShortfallDto(
            UUID ingredientId,
            String ingredientName,
            String sku,
            String baseUomCode,
            UUID categoryId,
            String categoryName,
            BigDecimal qtyOnHand,
            BigDecimal reorderPoint,
            BigDecimal parLevel,
            BigDecimal suggestedQty,
            String blockedReason) {}

    /**
     * {@code blockedCount} is how many rows carry a {@code blockedReason}. Surfaced separately so
     * the UI can say "3 items need a par level before they can be suggested" without recounting a
     * list it may have filtered.
     */
    public record ReorderShortfallsResponse(
            UUID branchId,
            List<ReorderShortfallDto> items,
            int blockedCount) {}
}
