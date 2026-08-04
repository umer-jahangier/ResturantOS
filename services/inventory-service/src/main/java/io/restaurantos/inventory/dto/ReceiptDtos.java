package io.restaurantos.inventory.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Request/response records for stock receipts (INV-04). {@code unitCostPaisa} is boxed
 * {@code Long} (not primitive {@code long}) so {@code @NotNull} can actually reject a missing
 * value instead of a Jackson-defaulted {@code 0} — mirrors {@code RecordOpeningBalanceRequest}'s
 * precedent from 08-03.
 */
public final class ReceiptDtos {

    private ReceiptDtos() {}

    /**
     * Records a stock receipt. {@code tenantId} is intentionally absent — resolved from
     * TenantContext/JWT only, never the request body (mirrors RecordOpeningBalanceRequest).
     */
    /**
     * {@code referenceType}/{@code referenceId} record WHY the stock arrived. Both are null for a
     * manual receipt typed into the stock screen, which is the only writer that existed before
     * purchasing-service's GRN consumer: the movement then falls back to
     * {@code referenceType='RECEIPT'} keyed on the lot, exactly as it always has. A GRN-driven
     * receipt stamps {@code 'GRN'} + the grnId instead, which is what makes a goods receipt
     * traceable from the ledger back to the purchase order that caused it.
     */
    public record ReceiveStockRequest(
            @NotNull UUID ingredientId,
            @NotNull UUID branchId,
            @NotNull @Positive BigDecimal qty,
            @NotNull @Positive Long unitCostPaisa,
            LocalDate expiryDate,
            String referenceType,
            UUID referenceId) {

        /** Manual-receipt convenience: the shape every existing caller and IT already uses. */
        public ReceiveStockRequest(UUID ingredientId, UUID branchId, BigDecimal qty,
                                   Long unitCostPaisa, LocalDate expiryDate) {
            this(ingredientId, branchId, qty, unitCostPaisa, expiryDate, null, null);
        }
    }

    public record ReceiptResultDto(UUID lotId, BigDecimal newQtyOnHand, long newAvgCostPaisa) {}
}
