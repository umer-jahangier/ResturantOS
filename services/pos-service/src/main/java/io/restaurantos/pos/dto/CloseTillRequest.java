package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record CloseTillRequest(
        @Min(0) long declaredClosingPaisa,
        @Size(max = 500) String note
) {}
