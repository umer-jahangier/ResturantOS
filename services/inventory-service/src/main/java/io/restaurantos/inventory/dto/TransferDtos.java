package io.restaurantos.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Request/response records for inter-branch stock transfers (INV-05). {@code tenantId} is
 * intentionally absent from every request — resolved from TenantContext/JWT only, mirrors
 * {@code ReceiveStockRequest}'s precedent from 08-06.
 */
public final class TransferDtos {

    private TransferDtos() {}

    public record CreateTransferRequest(
            @NotNull UUID fromBranchId,
            @NotNull UUID toBranchId,
            @NotEmpty @Valid List<TransferLineRequest> lines) {}

    public record TransferLineRequest(
            @NotNull UUID ingredientId,
            @NotNull @Positive BigDecimal qty) {}

    public record ReceiveTransferRequest(
            @NotNull UUID transferId,
            @NotEmpty @Valid List<ReceiveLineRequest> lines) {}

    public record ReceiveLineRequest(
            @NotNull UUID ingredientId,
            @NotNull @PositiveOrZero BigDecimal qtyReceived) {}

    public record TransferDto(
            UUID transferId,
            UUID fromBranchId,
            UUID toBranchId,
            String status,
            List<TransferLineDto> lines) {}

    public record TransferLineDto(
            UUID ingredientId,
            BigDecimal qtyShipped,
            BigDecimal qtyReceived,
            BigDecimal varianceQty,
            long unitCostPaisa) {}
}
