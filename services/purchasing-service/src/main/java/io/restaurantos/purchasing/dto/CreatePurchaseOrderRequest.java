package io.restaurantos.purchasing.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record CreatePurchaseOrderRequest(
        @NotNull UUID vendorId,
        @NotNull UUID branchId,
        LocalDate expectedDeliveryDate,
        String notes,
        @NotEmpty @Valid List<Line> lines
) {
    public record Line(
            @NotNull UUID ingredientId,
            @NotNull BigDecimal qty,
            @NotBlank String uom,
            long unitPricePaisa
    ) {}
}
