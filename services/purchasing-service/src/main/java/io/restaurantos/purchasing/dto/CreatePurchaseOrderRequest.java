package io.restaurantos.purchasing.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record CreatePurchaseOrderRequest(
        @NotNull UUID vendorId,
        @NotNull UUID branchId,
        LocalDate expectedDeliveryDate,
        String notes,
        @NotEmpty @Valid List<Line> lines
) {
    /**
     * Either {@code vendorItemId} (catalog-driven: {@code PurchaseOrderService} derives
     * ingredientId/uom/unitPricePaisa from the vendor's catalog) or {@code ingredientId} (legacy,
     * hand-typed) must be supplied — never both, never neither. When {@code vendorItemId} is
     * present, {@code uom} and {@code unitPricePaisa} are optional: the server fills them from the
     * catalog entry when absent, and a caller-supplied {@code unitPricePaisa} overrides the catalog
     * price for that line (surfaced on the response as {@code priceOverridden}). Legacy callers
     * that still post {@code ingredientId} + {@code uom} + {@code unitPricePaisa} keep working
     * unchanged.
     */
    public record Line(
            UUID vendorItemId,
            UUID ingredientId,
            @NotNull @Positive BigDecimal qty,
            String uom,
            Long unitPricePaisa
    ) {
        /**
         * Legacy 4-arg constructor (pre-catalog shape) kept for source/binary compatibility with
         * existing Java call sites (e.g. {@code PurchaseOrderApprovalIT}, {@code
         * PurchaseOrderCloseIT}) that construct this record directly rather than through JSON —
         * {@code vendorItemId} defaults to null, i.e. the legacy ingredient-typed path.
         */
        public Line(UUID ingredientId, BigDecimal qty, String uom, long unitPricePaisa) {
            this(null, ingredientId, qty, uom, unitPricePaisa);
        }

        @AssertTrue(message = "Exactly one of vendorItemId or ingredientId must be supplied")
        public boolean isCatalogOrIngredientReferenceValid() {
            return (vendorItemId != null) ^ (ingredientId != null);
        }
    }
}
