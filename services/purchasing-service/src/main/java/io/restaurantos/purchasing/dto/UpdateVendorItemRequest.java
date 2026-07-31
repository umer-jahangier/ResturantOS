package io.restaurantos.purchasing.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * Deliberately omits the catalog row's ingredient reference: that reference is immutable once
 * set on a {@code VendorItem} — re-mapping a catalog row to a different ingredient would rewrite
 * the meaning of historical PO/invoice lines, so a re-map creates a new vendor item (RESEARCH
 * §9.4). Also carries no price fields — price changes go exclusively through {@code
 * VendorItemPriceService.recordNewPrice}, never through this update.
 */
public record UpdateVendorItemRequest(
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
        Boolean catchWeight
) {}
