package io.restaurantos.purchasing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;
import java.util.UUID;

public record RecordVendorItemPriceRequest(
        @NotNull @PositiveOrZero Long unitPricePaisa,
        @NotBlank String priceUom,
        Instant effectiveFrom,
        UUID branchId,
        Boolean contractPrice,
        String source
) {}
