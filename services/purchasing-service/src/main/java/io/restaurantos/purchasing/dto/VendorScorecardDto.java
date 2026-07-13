package io.restaurantos.purchasing.dto;

import java.util.UUID;

public record VendorScorecardDto(
        UUID vendorId,
        UUID branchId,
        double onTimeDeliveryPct,
        double fillRatePct,
        double priceVariancePct,
        long totalSpendPaisa,
        int purchaseOrderCount
) {}
