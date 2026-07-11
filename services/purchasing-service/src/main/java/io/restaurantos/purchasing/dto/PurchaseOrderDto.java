package io.restaurantos.purchasing.dto;

import io.restaurantos.purchasing.domain.enums.PoStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record PurchaseOrderDto(
        UUID id,
        UUID vendorId,
        UUID branchId,
        PoStatus status,
        LocalDate expectedDeliveryDate,
        long totalPaisa,
        String notes,
        UUID requesterId,
        Instant submittedAt,
        int requiredTiers,
        int tiersApproved,
        List<LineDto> lines
) {
    public record LineDto(
            UUID id,
            UUID ingredientId,
            java.math.BigDecimal qty,
            String uom,
            long unitPricePaisa,
            long lineTotalPaisa
    ) {}
}
