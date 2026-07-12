package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record RefundRequest(
        @NotNull @Min(1) Long refundPaisa,
        @NotBlank @Size(max = 500) String reason,
        @NotNull String scope
) {
    public boolean isFull() {
        return "FULL".equalsIgnoreCase(scope);
    }
}
