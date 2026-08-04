package io.restaurantos.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Request/response records for stock counts (INV-06). {@code tenantId} is intentionally absent
 * from the request — resolved from TenantContext/JWT only, mirrors {@code CreateTransferRequest}'s
 * precedent from 08-07. {@code countedQty} is {@code @PositiveOrZero} (T-8-NEGQTY) — a count can
 * legitimately record zero on-hand (shrinkage to nothing), but never a negative quantity.
 */
public final class StockCountDtos {

    private StockCountDtos() {}

    public record CreateStockCountRequest(
            @NotNull UUID branchId,
            @NotEmpty @Valid List<CountLineRequest> lines) {}

    /**
     * {@code overrideReason} is required ONLY when the line's variance exceeds its category's
     * variance cap; {@code StockCountService} rejects such a line with 422
     * {@code COUNT_VARIANCE_OVER_CAP} when it is absent. Supplying one on a within-cap line is
     * harmless but pointless — it is not persisted, so the presence of a stored reason always
     * means "this line really did breach its cap".
     */
    public record CountLineRequest(
            @NotNull UUID ingredientId,
            @NotNull @PositiveOrZero BigDecimal countedQty,
            @Size(max = 500) String overrideReason) {}

    public record StockCountDto(
            UUID countId,
            UUID branchId,
            String status,
            List<CountLineDto> lines,
            long totalVarianceCostPaisa) {}

    /**
     * {@code variancePct} is null when system qty was zero — a percentage needs a base, and the
     * first count of an item legitimately has none. {@code capPct} is null when neither the
     * ingredient's category nor any ancestor sets a cap. {@code overrideReason} is non-null exactly
     * for the lines that breached their cap and were posted anyway.
     */
    public record CountLineDto(
            UUID ingredientId,
            BigDecimal systemQty,
            BigDecimal countedQty,
            BigDecimal varianceQty,
            long varianceCostPaisa,
            BigDecimal variancePct,
            BigDecimal capPct,
            String overrideReason) {}
}
