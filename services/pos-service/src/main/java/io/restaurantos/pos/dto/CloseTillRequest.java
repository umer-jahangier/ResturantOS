package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Min;

public record CloseTillRequest(
        @Min(0) long declaredClosingPaisa
) {}
