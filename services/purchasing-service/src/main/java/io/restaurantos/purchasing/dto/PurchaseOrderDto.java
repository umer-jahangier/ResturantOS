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
        Instant closedAt,
        String closeReason,
        List<LineDto> lines
) {
    /**
     * {@code vendorSku}/{@code packDescription} are denormalized from the catalog row so the PO
     * detail page renders the catalog context without a second call; both are null for legacy
     * lines (no {@code vendorItemId}). {@code priceOverridden} is true when a caller-supplied
     * price differs from the vendor item's currently effective catalog price — a manager can
     * still book a one-off deal, and this makes that visible rather than indistinguishable from
     * the catalog price.
     */
    public record LineDto(
            UUID id,
            UUID ingredientId,
            java.math.BigDecimal qty,
            String uom,
            long unitPricePaisa,
            long lineTotalPaisa,
            UUID vendorItemId,
            String vendorSku,
            String packDescription,
            boolean priceOverridden
    ) {}
}
