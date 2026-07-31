package io.restaurantos.purchasing.dto;

import java.time.Instant;
import java.util.UUID;

public record VendorItemPriceDto(
        UUID id,
        UUID vendorItemId,
        UUID branchId,
        long unitPricePaisa,
        String priceUom,
        Instant effectiveFrom,
        Instant effectiveTo,
        String source,
        boolean contractPrice
) {}
