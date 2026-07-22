package io.restaurantos.purchasing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** {@code deltaPct} is null when there is no previous price (the first-ever price row). */
public record VendorItemPriceChangeDto(
        UUID vendorItemId,
        String vendorSku,
        String vendorDescription,
        Long previousUnitPricePaisa,
        long newUnitPricePaisa,
        BigDecimal deltaPct,
        Instant effectiveFrom
) {}
