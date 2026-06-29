package io.restaurantos.pos.dto;

import java.math.BigDecimal;
import java.util.UUID;

public record MenuItemDto(
        UUID id,
        UUID categoryId,
        String categoryName,
        String name,
        String description,
        long basePricePaisa,
        BigDecimal taxRatePct,
        String taxRateCode,
        String kdsStation,
        boolean active,
        Long overridePricePaisa
) {}
