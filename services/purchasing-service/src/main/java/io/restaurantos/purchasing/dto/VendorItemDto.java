package io.restaurantos.purchasing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record VendorItemDto(
        UUID id,
        UUID vendorId,
        UUID ingredientId,
        String vendorSku,
        String vendorDescription,
        String orderUom,
        String packDescription,
        BigDecimal packQty,
        String packUom,
        BigDecimal minOrderQty,
        BigDecimal orderMultiple,
        Integer leadTimeDays,
        boolean preferred,
        boolean catchWeight,
        Instant archivedAt,
        Long currentUnitPricePaisa,
        String currentPriceUom,
        Instant currentPriceEffectiveFrom
) {}
