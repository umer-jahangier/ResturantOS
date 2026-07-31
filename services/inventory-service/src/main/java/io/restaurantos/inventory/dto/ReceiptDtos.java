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
    public record ReceiveStockRequest(
            @NotNull UUID ingredientId,
            @NotNull UUID branchId,
            @NotNull @Positive BigDecimal qty,
            @NotNull @Positive Long unitCostPaisa,
            LocalDate expiryDate) {}

    public record ReceiptResultDto(UUID lotId, BigDecimal newQtyOnHand, long newAvgCostPaisa) {}
}
