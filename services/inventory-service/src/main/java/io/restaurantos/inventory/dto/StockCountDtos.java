package io.restaurantos.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

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

    public record CountLineRequest(
            @NotNull UUID ingredientId,
            @NotNull @PositiveOrZero BigDecimal countedQty) {}

    public record StockCountDto(
            UUID countId,
            UUID branchId,
            String status,
            List<CountLineDto> lines,
            long totalVarianceCostPaisa) {}

    public record CountLineDto(
            UUID ingredientId,
            BigDecimal systemQty,
            BigDecimal countedQty,
            BigDecimal varianceQty,
            long varianceCostPaisa) {}
}
