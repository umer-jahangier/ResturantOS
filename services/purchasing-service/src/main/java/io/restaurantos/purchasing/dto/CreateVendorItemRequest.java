package io.restaurantos.purchasing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Creating a catalog item may seed its first price in the same call, which is what the UI's
 * "Add catalog item" dialog does. {@code initialUnitPricePaisa} is optional — when present, the
 * service delegates to {@code VendorItemPriceService.recordNewPrice} rather than inserting a
 * price row directly, keeping append-only insertion in exactly one place.
 */
public record CreateVendorItemRequest(
        @NotNull UUID ingredientId,
        @Size(max = 80) String vendorSku,
        String vendorDescription,
        String gtin,
        @NotBlank String orderUom,
        String packDescription,
        @NotNull @Positive BigDecimal packQty,
        @NotBlank String packUom,
        BigDecimal minOrderQty,
        BigDecimal orderMultiple,
        Integer leadTimeDays,
        Boolean preferred,
        Boolean catchWeight,
        @PositiveOrZero Long initialUnitPricePaisa,
        String initialPriceUom,
        Instant initialPriceEffectiveFrom
) {}
